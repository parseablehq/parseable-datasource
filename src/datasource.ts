import {
  getBackendSrv,
  getTemplateSrv,
  BackendSrvRequest,
  FetchResponse,
  DataSourceWithBackend,
} from '@grafana/runtime';
import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  DataFrame,
  FieldType,
  guessFieldTypeFromValue,
  MetricFindValue,
} from '@grafana/data';
import { lastValueFrom, of, Observable } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { isArray, isNull } from 'lodash';

import {
  MyQuery,
  MyDataSourceOptions,
  QueryEditorMode,
  Dataset,
  HomeResponse,
  StreamSchemaResponse,
  StreamInfoResponse,
  SchemaFields,
  MetricInfo,
  PromMetadataEntry,
  PromVariableQuery,
} from './types';
import { parseType } from './utils/fieldTypes';
import { sanitizeSql } from './utils/sqlNormalize';
import { recordPromqlQuery } from './utils/promqlHistory';

export class DataSource extends DataSourceWithBackend<MyQuery, MyDataSourceOptions> {
  url: string;
  withCredentials: boolean;
  headers: any;
  defaultEditorMode: QueryEditorMode;
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.url = instanceSettings.url === undefined ? '' : instanceSettings.url;
    this.withCredentials = instanceSettings.withCredentials !== undefined;
    this.defaultEditorMode = instanceSettings.jsonData?.defaultEditorMode ?? 'builder';
  }

  async doRequest(query: MyQuery) {
    const routePath = '/api/v1';
    const result = await lastValueFrom(
      getBackendSrv().fetch({
        method: 'GET',
        url: this.url + routePath + '/readiness',
        params: query,
      })
    );
    return result;
  }

  extractStreamName = (sqlQuery: string): string | null => {
    const tableRegex = /from\s+([\w\.]+)/i;
    const match = sqlQuery.match(tableRegex);
    if (match) {
      return match[1];
    }

    return null;
  };

  query(options: DataQueryRequest<MyQuery>): Observable<DataQueryResponse> {
    return new Observable<DataQueryResponse>((observer) => {
      options.targets = options.targets.filter((t) => !t.hide);
      if (options.targets.length === 0) {
        observer.next({ data: [] });
        observer.complete();
        return;
      }

      const { range } = options;
      if (!range) {
        observer.next({ data: [] });
        observer.complete();
        return;
      }
      const start = range!.from;
      const end = range!.to;

      const validTargets = options.targets.filter((target) => target.queryText && target.queryText.trim());
      if (validTargets.length === 0) {
        observer.next({ data: [] });
        observer.complete();
        return;
      }

      const calls: Array<Promise<DataFrame | DataFrame[]>> = validTargets.map((target) => {
        if (target.queryLanguage === 'promql') {
          // Record the raw (pre-interpolation) query for history completions.
          recordPromqlQuery(this.uid, target.queryText || '');
          return this.executePromQLQuery(target, start, end, options);
        }

        const rawQuery = getTemplateSrv().replace(target.queryText, options.scopedVars, this.formatter);
        const query = sanitizeSql(rawQuery);

        const request = {
          query,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          send_null: true,
        };

        const streamName = this.extractStreamName(query);
        return lastValueFrom(
          this.doFetch<any[]>({
            url: this.url + '/api/v1/query',
            data: request,
            method: 'POST',
          }).pipe(
            mergeMap(async (response) => {
              return this.arrayToDataFrame(response.data, streamName, request.query);
            }),
            catchError((err) => {
              const msg = err?.data?.message || err?.statusText || err?.message || 'Query failed';
              throw new Error(msg);
            })
          )
        );
      });

      Promise.all(calls)
        .then((results) => {
          const data: DataFrame[] = [];
          results.forEach((r) => {
            if (Array.isArray(r)) {
              data.push(...r);
            } else {
              data.push(r);
            }
          });
          observer.next({ data });
          observer.complete();
        })
        .catch((error) => {
          observer.error(error);
        });
    });
  }

  private formatter(value: string | string[], options: any): string {
    if (options.multi && Array.isArray(value)) {
      return (value as string[]).map((v) => `'${v}'`).join(',');
    } else if (options.multi) {
      return `'${value}'`;
    }
    return value as string;
  }

  async metricFindQuery(query: string | PromVariableQuery, options?: any): Promise<MetricFindValue[]> {
    // Typed PromQL variable query (Phase 4)
    if (query && typeof query === 'object' && 'qryType' in query) {
      return this.promVariableFindQuery(query, options);
    }
    const queryStr = typeof query === 'string' ? query : '';

    const to = new Date();
    const from = new Date();
    from.setFullYear(to.getFullYear() - 1);

    options = options || {};
    options.range = options.range || {
      from: from,
      to: to,
    };

    options.targets = [];
    options.targets.push({ queryText: queryStr, scopedVars: {} });

    return new Promise<MetricFindValue[]>((resolve, reject) => {
      this.query(options).subscribe({
        next: (response: DataQueryResponse) => {
          const values: MetricFindValue[] = response.data
            .map((dataFrame: DataFrame) => dataFrame.fields[0].values)
            .flat()
            .map((value: any) => ({ text: value }));

          resolve(values);
        },
        error: (error: any) => {
          reject(error);
        },
      });
    });
  }

  /**
   * Maps a simplified parseType result to a Grafana FieldType.
   */
  private parsedTypeToGrafana(pt: string): FieldType {
    switch (pt) {
      case 'number':
        return FieldType.number;
      case 'timestamp':
        return FieldType.time;
      case 'boolean':
        return FieldType.boolean;
      case 'text':
        return FieldType.string;
      default:
        return FieldType.other;
    }
  }

  async arrayToDataFrame(array: any[], streamName?: string | null, query?: string): Promise<DataFrame> {
    let fieldDefs: Array<{ name: string; type: FieldType }> = [];

    const setHeadersFromData = () => {
      if (array.length > 0) {
        fieldDefs = Object.keys(array[0]).map((field) => {
          let fieldType = guessFieldTypeFromValue(array[0][field]);
          // p_timestamp is always a time field present in the log
          // stream as parseable adds it to the log event
          if (field.toLowerCase() === 'p_timestamp') {
            fieldType = FieldType.time;
          }
          return { name: field, type: fieldType };
        });
      }
    };

    const selectAllRegex = /^SELECT\s+\*/i;
    const containsSelectAll = selectAllRegex.test(query || '');
    if (streamName && containsSelectAll) {
      const streamSchema = await this.getStreamSchema(streamName);
      const schemaFields: SchemaFields[] | undefined = streamSchema.fields;
      if (schemaFields && schemaFields.length > 0) {
        fieldDefs = schemaFields.map((field) => {
          if (field.name === 'p_timestamp') {
            return { name: field.name, type: FieldType.time };
          }
          return { name: field.name, type: this.parsedTypeToGrafana(parseType(field.data_type)) };
        });
      } else {
        setHeadersFromData();
      }
    } else {
      setHeadersFromData();
    }

    // Build value arrays for each field
    const values: Record<string, any[]> = {};
    fieldDefs.forEach((f) => {
      values[f.name] = [];
    });

    array.forEach((row) => {
      fieldDefs.forEach((f) => {
        values[f.name].push(row[f.name] ?? null);
      });
    });

    return {
      fields: fieldDefs.map((f) => ({
        name: f.name,
        type: f.type,
        values: values[f.name] || [],
        config: {},
      })),
      length: array.length,
    };
  }

  // ---------------------------------------------------------------------------
  // PromQL query execution and response handling
  // ---------------------------------------------------------------------------

  private async executePromQLQuery(
    target: MyQuery,
    start: any,
    end: any,
    options: DataQueryRequest<MyQuery>
  ): Promise<DataFrame[]> {
    const rawQuery = getTemplateSrv().replace(target.queryText, options.scopedVars, this.formatter);
    const streamName = target.stream || '';

    // Default: range=true, instant=false when both are absent (preserves prior behavior).
    const wantInstant = target.instant === true;
    const wantRange = target.range === true || (!wantInstant && target.range !== false);

    const calls: Array<Promise<DataFrame>> = [];
    if (wantRange) {
      calls.push(this.executePromQLRange(rawQuery, streamName, start, end));
    }
    if (wantInstant) {
      calls.push(this.executePromQLInstant(rawQuery, streamName, end));
    }
    return Promise.all(calls);
  }

  private executePromQLRange(rawQuery: string, streamName: string, start: any, end: any): Promise<DataFrame> {
    const startSec = Math.floor(start.valueOf() / 1000);
    const endSec = Math.floor(end.valueOf() / 1000);
    const step = this.calculateStep(endSec - startSec);

    const params = new URLSearchParams({
      query: rawQuery,
      stream: streamName,
      start: String(startSec),
      end: String(endSec),
      step: step,
      timestamp_format: 'unix',
    });

    return lastValueFrom(
      this.doFetch<any>({
        url: this.url + '/prometheus/api/v1/query_range?' + params.toString(),
        method: 'GET',
      }).pipe(
        map((response) => this.promqlResponseToDataFrame(response.data)),
        catchError((err) => {
          const msg =
            err?.data?.error || err?.data?.message || err?.statusText || err?.message || 'PromQL range query failed';
          throw new Error(msg);
        })
      )
    );
  }

  private executePromQLInstant(rawQuery: string, streamName: string, end: any): Promise<DataFrame> {
    const timeSec = Math.floor(end.valueOf() / 1000);
    const params = new URLSearchParams({
      query: rawQuery,
      stream: streamName,
      time: String(timeSec),
      timestamp_format: 'unix',
    });

    return lastValueFrom(
      this.doFetch<any>({
        url: this.url + '/prometheus/api/v1/query?' + params.toString(),
        method: 'GET',
      }).pipe(
        map((response) => this.promqlResponseToDataFrame(response.data)),
        catchError((err) => {
          const msg =
            err?.data?.error || err?.data?.message || err?.statusText || err?.message || 'PromQL instant query failed';
          throw new Error(msg);
        })
      )
    );
  }

  private calculateStep(durationSec: number): string {
    if (durationSec <= 3600) {
      return '15s';
    }
    if (durationSec <= 21600) {
      return '60s';
    }
    if (durationSec <= 86400) {
      return '5m';
    }
    if (durationSec <= 604800) {
      return '15m';
    }
    return '1h';
  }

  private promqlResponseToDataFrame(response: any): DataFrame {
    if (response?.status !== 'success' || !response?.data) {
      return { fields: [], length: 0 };
    }

    const { resultType, result } = response.data;

    if (resultType === 'matrix' && isArray(result)) {
      return this.matrixToDataFrame(result);
    }

    if (resultType === 'vector' && isArray(result)) {
      return this.vectorToDataFrame(result);
    }

    if (resultType === 'scalar' && isArray(result)) {
      return this.scalarToDataFrame(result);
    }

    return { fields: [], length: 0 };
  }

  private scalarToDataFrame(sample: any[]): DataFrame {
    const ms = this.parsePromSampleTs(sample?.[0]);
    if (!Number.isFinite(ms)) {
      return { fields: [], length: 0 };
    }
    const value = parseFloat(sample?.[1]);
    return {
      fields: [
        { name: 'Time', type: FieldType.time, values: [ms], config: {} },
        { name: 'Value', type: FieldType.number, values: [value], config: {} },
      ],
      length: 1,
    };
  }

  // Parseable's PromQL sample tuple is [timestamp, stringified float]. The
  // timestamp is unix seconds by default but becomes an ISO-8601 string when
  // timestamp_format=rfc3339 is negotiated. Return ms-since-epoch, or NaN if
  // the value can't be interpreted.
  private parsePromSampleTs(ts: any): number {
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      return ts * 1000;
    }
    if (typeof ts === 'string') {
      const asNum = Number(ts);
      if (Number.isFinite(asNum)) {
        return asNum * 1000;
      }
      const parsed = Date.parse(ts);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  }

  private matrixToDataFrame(result: any[]): DataFrame {
    if (result.length === 0) {
      return { fields: [], length: 0 };
    }

    // Collect unique ms timestamps across all series.
    const timestampSet = new Set<number>();
    result.forEach((series) => {
      (series.values || []).forEach((sample: any) => {
        const ms = this.parsePromSampleTs(sample?.[0]);
        if (Number.isFinite(ms)) {
          timestampSet.add(ms);
        }
      });
    });
    const timestamps = Array.from(timestampSet).sort((a, b) => a - b);

    const fields: any[] = [
      { name: 'Time', type: FieldType.time, values: timestamps, config: {} },
    ];

    result.forEach((series) => {
      const metric = series.metric || {};
      const name = this.buildSeriesName(metric);

      const valueMap = new Map<number, number>();
      (series.values || []).forEach((sample: any) => {
        const ms = this.parsePromSampleTs(sample?.[0]);
        if (Number.isFinite(ms)) {
          valueMap.set(ms, parseFloat(sample?.[1]));
        }
      });

      const values = timestamps.map((ts) => valueMap.get(ts) ?? null);
      fields.push({ name, type: FieldType.number, values, config: {} });
    });

    return { fields, length: timestamps.length };
  }

  private vectorToDataFrame(result: any[]): DataFrame {
    if (result.length === 0) {
      return { fields: [], length: 0 };
    }

    const names: string[] = [];
    const values: number[] = [];
    const timestamps: number[] = [];

    result.forEach((item) => {
      const metric = item.metric || {};
      const sample = item.value || [0, '0'];
      const ms = this.parsePromSampleTs(sample[0]);
      if (!Number.isFinite(ms)) {
        return;
      }
      names.push(this.buildSeriesName(metric));
      timestamps.push(ms);
      values.push(parseFloat(sample[1]));
    });

    return {
      fields: [
        { name: 'Time', type: FieldType.time, values: timestamps, config: {} },
        { name: 'Value', type: FieldType.number, values, config: {} },
        { name: 'Metric', type: FieldType.string, values: names, config: {} },
      ],
      length: names.length,
    };
  }

  private buildSeriesName(metric: Record<string, string>): string {
    const name = metric.__name__ || '';
    const labels = Object.entries(metric)
      .filter(([k]) => k !== '__name__')
      .map(([k, v]) => `${k}="${v}"`)
      .join(', ');
    return labels ? `${name}{${labels}}` : name || 'value';
  }

  // ---------------------------------------------------------------------------
  // PromQL metadata endpoints (for autocomplete)
  // ---------------------------------------------------------------------------

  async getPromLabels(
    streamName: string,
    opts?: { match?: string[]; start?: number; end?: number; limit?: number }
  ): Promise<string[]> {
    if (!streamName) {
      return [];
    }
    const parts: string[] = ['stream=' + encodeURIComponent(streamName)];
    (opts?.match ?? []).forEach((m) => parts.push('match[]=' + encodeURIComponent(m)));
    if (opts?.start !== undefined) {
      parts.push('start=' + opts.start);
    }
    if (opts?.end !== undefined) {
      parts.push('end=' + opts.end);
    }
    if (opts?.limit !== undefined) {
      parts.push('limit=' + opts.limit);
    }
    try {
      return await lastValueFrom(
        this.doFetch<any>({
          url: this.url + '/prometheus/api/v1/labels?' + parts.join('&'),
          method: 'GET',
        }).pipe(
          map((res) => {
            if (res.data?.status === 'success' && isArray(res.data?.data)) {
              return res.data.data as string[];
            }
            return [];
          }),
          catchError(() => of([]))
        )
      );
    } catch {
      return [];
    }
  }

  async getPromMetricNames(
    streamName: string,
    opts?: { start?: number; end?: number; limit?: number }
  ): Promise<string[]> {
    return this.getPromLabelValues(streamName, '__name__', opts);
  }

  /**
   * Resolve a typed PromQL variable query into MetricFindValue[].
   * Mirrors the native Prometheus plugin: label_names, label_values,
   * label_values(metric, label), metrics(regex), query_result(expr).
   */
  private async promVariableFindQuery(q: PromVariableQuery, options?: any): Promise<MetricFindValue[]> {
    const stream = q.stream || '';
    if (!stream) {
      return [];
    }
    const tpl = getTemplateSrv();
    const scopedVars = options?.scopedVars;
    const interpolate = (s?: string) => (s ? tpl.replace(s, scopedVars) : '');

    switch (q.qryType) {
      case 'label_names': {
        const labels = await this.getPromLabels(stream);
        return labels.filter((l) => l !== '__name__').map((l) => ({ text: l }));
      }
      case 'label_values': {
        const label = interpolate(q.label);
        if (!label) {
          return [];
        }
        const metric = interpolate(q.metric);
        // Use /label/{label}/values with match[]={__name__="<metric>"} — same
        // endpoint the native plugin uses and the completion provider uses.
        // Works for UTF-8 metric names without needing to build full /series
        // responses client-side. A 6-hour lookback window keeps the query
        // fast on Parseable (match[] without a time range hangs).
        const lookbackEnd = Math.floor(Date.now() / 1000);
        const lookbackStart = lookbackEnd - 6 * 60 * 60;
        const opts: { match?: string[]; start?: number; end?: number } = {
          start: lookbackStart,
          end: lookbackEnd,
        };
        if (metric) {
          const escaped = metric.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          opts.match = [`{__name__="${escaped}"}`];
        }
        const values = await this.getPromLabelValues(stream, label, opts);
        return values.sort().map((v) => ({ text: v }));
      }
      case 'metrics': {
        const names = await this.getPromMetricNames(stream);
        const rx = interpolate(q.regex);
        let re: RegExp | null = null;
        if (rx) {
          try {
            re = new RegExp(rx);
          } catch {
            re = null;
          }
        }
        return names.filter((n) => (re ? re.test(n) : true)).map((n) => ({ text: n }));
      }
      case 'query_result': {
        const expr = interpolate(q.expr);
        if (!expr) {
          return [];
        }
        const timeSec = Math.floor(Date.now() / 1000);
        const params = new URLSearchParams({
          query: expr,
          stream,
          time: String(timeSec),
          timestamp_format: 'unix',
        });
        try {
          const res = await lastValueFrom(
            this.doFetch<any>({
              url: this.url + '/prometheus/api/v1/query?' + params.toString(),
              method: 'GET',
            })
          );
          const data = res.data?.data;
          if (res.data?.status !== 'success' || !data || !isArray(data.result)) {
            return [];
          }
          return data.result.map((item: any) => ({
            text: this.buildSeriesName(item.metric || {}),
          }));
        } catch {
          return [];
        }
      }
      default:
        return [];
    }
  }

  /**
   * Fetch type/help/unit per metric from /prometheus/api/v1/metadata.
   * Returns the first entry per metric (Prometheus may return multiple).
   * Returns an empty map when the server has no metadata populated.
   */
  async getPromMetadata(
    streamName: string,
    options?: { metric?: string; limit?: number; limitPerMetric?: number }
  ): Promise<Record<string, PromMetadataEntry>> {
    if (!streamName) {
      return {};
    }
    const parts = ['stream=' + encodeURIComponent(streamName)];
    if (options?.metric) {
      parts.push('metric=' + encodeURIComponent(options.metric));
    }
    if (options?.limit !== undefined) {
      parts.push('limit=' + options.limit);
    }
    if (options?.limitPerMetric !== undefined) {
      parts.push('limit_per_metric=' + options.limitPerMetric);
    }
    try {
      return await lastValueFrom(
        this.doFetch<any>({
          url: this.url + '/prometheus/api/v1/metadata?' + parts.join('&'),
          method: 'GET',
        }).pipe(
          map((res) => {
            const data = res.data?.data;
            if (res.data?.status !== 'success' || !data || typeof data !== 'object') {
              return {};
            }
            const out: Record<string, PromMetadataEntry> = {};
            Object.keys(data).forEach((name) => {
              const entries = data[name];
              if (isArray(entries) && entries.length > 0) {
                out[name] = {
                  type: entries[0]?.type,
                  help: entries[0]?.help,
                  unit: entries[0]?.unit,
                };
              }
            });
            return out;
          }),
          catchError(() => of({} as Record<string, PromMetadataEntry>))
        )
      );
    } catch {
      return {};
    }
  }

  async getPromSeries(
    streamName: string,
    matches: string[],
    start?: number,
    end?: number
  ): Promise<Array<Record<string, string>>> {
    if (!streamName || !matches || matches.length === 0) {
      return [];
    }
    const parts = matches.map((m) => 'match[]=' + encodeURIComponent(m));
    parts.push('stream=' + encodeURIComponent(streamName));
    if (start !== undefined) {
      parts.push('start=' + start);
    }
    if (end !== undefined) {
      parts.push('end=' + end);
    }
    try {
      return await lastValueFrom(
        this.doFetch<any>({
          url: this.url + '/prometheus/api/v1/series?' + parts.join('&'),
          method: 'GET',
        }).pipe(
          map((res) => {
            if (res.data?.status === 'success' && isArray(res.data?.data)) {
              return res.data.data as Array<Record<string, string>>;
            }
            return [];
          }),
          catchError(() => of([]))
        )
      );
    } catch {
      return [];
    }
  }

  async getPromLabelValues(
    streamName: string,
    labelName: string,
    opts?: { match?: string[]; start?: number; end?: number; limit?: number }
  ): Promise<string[]> {
    if (!streamName || !labelName) {
      return [];
    }
    const parts: string[] = ['stream=' + encodeURIComponent(streamName)];
    (opts?.match ?? []).forEach((m) => parts.push('match[]=' + encodeURIComponent(m)));
    if (opts?.start !== undefined) {
      parts.push('start=' + opts.start);
    }
    if (opts?.end !== undefined) {
      parts.push('end=' + opts.end);
    }
    if (opts?.limit !== undefined) {
      parts.push('limit=' + opts.limit);
    }
    try {
      return await lastValueFrom(
        this.doFetch<any>({
          url:
            this.url +
            '/prometheus/api/v1/label/' +
            encodeURIComponent(labelName) +
            '/values?' +
            parts.join('&'),
          method: 'GET',
        }).pipe(
          map((res) => {
            if (res.data?.status === 'success' && isArray(res.data?.data)) {
              return res.data.data as string[];
            }
            return [];
          }),
          catchError(() => of([]))
        )
      );
    } catch {
      return [];
    }
  }

  doFetch<T>(options: BackendSrvRequest) {
    options.withCredentials = this.withCredentials;
    options.headers = this.headers;

    return getBackendSrv().fetch<T>(options);
  }

  async listDatasets(): Promise<Dataset[]> {
    return lastValueFrom(
      this.doFetch<HomeResponse>({
        url: this.url + '/api/prism/v1/home',
        method: 'GET',
      }).pipe(
        map((response) => (isArray(response.data?.datasets) ? response.data.datasets! : [])),
        catchError(() => of([] as Dataset[]))
      )
    );
  }

  async getStreamInfo(streamName: string): Promise<StreamInfoResponse> {
    if (streamName) {
      return lastValueFrom(
        this.doFetch({
          url: this.url + '/api/prism/v1/logstream/' + streamName + '/info',
          method: 'GET',
        }).pipe(
          map((response) => (typeof response.data === 'object' && !isNull(response.data) ? response.data : {})),
          catchError((err) => {
            return of({
              status: 'error',
              message: err.statusText,
            });
          })
        )
      );
    }
    return {};
  }

  async getStreamSchema(streamName: string): Promise<StreamSchemaResponse> {
    const info = await this.getStreamInfo(streamName);
    return info.schema ?? { fields: [] };
  }

  async getMetricNames(streamName: string): Promise<MetricInfo[]> {
    const sql = `SELECT COUNT(*) AS count, "metric_name", "metric_description", "metric_type" FROM "${streamName}" WHERE "metric_type" IN ('sum', 'gauge', 'summary', 'histogram', 'exponential_histogram') GROUP BY "metric_name", "metric_description", "metric_type" ORDER BY count DESC, "metric_name"`;
    const now = new Date();
    const from = new Date();
    from.setDate(now.getDate() - 7);

    try {
      return await lastValueFrom(
        this.doFetch<any[]>({
          url: this.url + '/api/v1/query',
          data: {
            query: sql,
            startTime: from.toISOString(),
            endTime: now.toISOString(),
            send_null: true,
          },
          method: 'POST',
        }).pipe(
          map((res) => {
            if (isArray(res.data)) {
              return res.data.map((row) => ({
                metric_name: row.metric_name || '',
                metric_description: row.metric_description || '',
                metric_type: row.metric_type || '',
                count: row.count || 0,
              }));
            }
            return [];
          }),
          catchError(() => of([]))
        )
      );
    } catch {
      return [];
    }
  }

  async getDistinctValues(streamName: string, columnName: string, limit = 50): Promise<string[]> {
    const query = `SELECT DISTINCT "${columnName}" FROM ${streamName} LIMIT ${limit}`;
    const now = new Date();
    const from = new Date();
    from.setDate(now.getDate() - 7);

    try {
      return await lastValueFrom(
        this.doFetch<any[]>({
          url: this.url + '/api/v1/query',
          data: {
            query,
            startTime: from.toISOString(),
            endTime: now.toISOString(),
            send_null: true,
          },
          method: 'POST',
        }).pipe(
          map((res) => {
            if (isArray(res.data)) {
              return res.data
                .map((row) => {
                  const val = row[columnName];
                  return val != null ? String(val) : '';
                })
                .filter(Boolean);
            }
            return [];
          }),
          catchError(() => of([]))
        )
      );
    } catch {
      return [];
    }
  }

  async testDatasource() {
    const errorMessageBase =
      'Parseable server is not reachable. Verify that your basic authentication credentials are accurate.';
    try {
      const response = await lastValueFrom(
        this.doFetch({
          url: this.url + '/api/prism/v1/home',
          method: 'GET',
        }).pipe(map((response) => response))
      );

      if (response.status === 200) {
        return { status: 'success', message: 'Parseable server is reachable', title: 'Success' };
      }

      return {
        message: response.status === 400 || !response.statusText ? errorMessageBase : response.statusText,
        status: 'error',
        title: 'Error',
      };
    } catch (err) {
      if (typeof err === 'string') {
        return {
          status: 'error',
          message: err,
        };
      }

      let error = err as FetchResponse;
      let message = error.statusText ?? errorMessageBase;
      if (error.data?.error?.code !== undefined) {
        message += `: ${error.data.error.code}. ${error.data.error.message}`;
      }

      return { status: 'error', message, title: 'Error' };
    }
  }
}
