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
  StreamList,
  StreamSchemaResponse,
  StreamStatsResponse,
  SchemaFields,
} from './types';
import { parseType } from './utils/fieldTypes';
import { sanitizeSql } from './utils/sqlNormalize';

export class DataSource extends DataSourceWithBackend<MyQuery, MyDataSourceOptions> {
  url: string;
  withCredentials: boolean;
  headers: any;
  defaultEditorMode: QueryEditorMode;
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.url = instanceSettings.url === undefined ? '' : instanceSettings.url;
    this.withCredentials = instanceSettings.withCredentials !== undefined;
    this.defaultEditorMode = instanceSettings.jsonData?.defaultEditorMode ?? 'code';
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

      const calls = validTargets.map((target) => {
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
        .then((data) => {
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

  async metricFindQuery(query: string, options?: any): Promise<MetricFindValue[]> {
    const to = new Date();
    const from = new Date();
    from.setFullYear(to.getFullYear() - 1);

    options = options || {};
    options.range = options.range || {
      from: from,
      to: to,
    };

    options.targets = [];
    options.targets.push({ queryText: query, scopedVars: {} });

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

  doFetch<T>(options: BackendSrvRequest) {
    options.withCredentials = this.withCredentials;
    options.headers = this.headers;

    return getBackendSrv().fetch<T>(options);
  }

  async listStreams(): Promise<StreamList[]> {
    return lastValueFrom(
      this.doFetch({
        url: this.url + '/api/v1/logstream',
        method: 'GET',
      }).pipe(
        map((response) => (isArray(response.data) ? response.data : [])),
        catchError((err) => {
          return of([]);
        })
      )
    );
  }

  async getStreamStats(streamName: string): Promise<StreamStatsResponse> {
    if (streamName) {
      return lastValueFrom(
        this.doFetch({
          url: this.url + '/api/v1/logstream/' + streamName + '/stats',
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
    if (streamName) {
      return lastValueFrom(
        this.doFetch({
          url: this.url + '/api/v1/logstream/' + streamName + '/schema',
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
    return { fields: [] };
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
          url: this.url + '/api/v1/logstream',
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
