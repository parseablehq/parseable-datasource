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
  MutableDataFrame,
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

const numberType = [
  'Int8',
  'Int16',
  'Int32',
  'Int64',
  'UInt8',
  'UInt16',
  'UInt32',
  'UInt64',
  'Float16',
  'Float32',
  'Float64',
];
const stringType = ['Utf8', 'LargeUtf8'];
const timeType = ['Date32', 'Date64', 'Timestamp', 'Time32', 'Time64'];

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
    const result = await getBackendSrv().datasourceRequest({
      method: 'GET',
      url: this.url + routePath + '/readiness',
      params: query,
    });
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

      const calls = options.targets.map((target) => {
        const query = getTemplateSrv().replace(target.queryText, options.scopedVars, this.formatter);

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
              throw new Error(err.data.message);
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
            .map((dataFrame: DataFrame) => dataFrame.fields[0].values.toArray())
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

  async arrayToDataFrame(array: any[], streamName?: string | null, query?: string): Promise<DataFrame> {
    let dataFrame: MutableDataFrame = new MutableDataFrame();
    let isHeadersMadeFromData = false;

    const setHeadersFromData = () => {
      if (array.length > 0) {
        const fields = Object.keys(array[0]).map((field) => {
          let fieldType = guessFieldTypeFromValue(array[0][field]);
          // p_timestamp is always a time field present in the log
          // stream as parseable adds it to the log event
          if (field.toLowerCase() === 'p_timestamp') {
            fieldType = FieldType.time;
          }
          return { name: field, type: fieldType };
        });
        dataFrame = new MutableDataFrame({ fields });
        isHeadersMadeFromData = true;
      }
    };

    const selectAllRegex = /^SELECT\s+\*/i;
    const containsSelectAll = selectAllRegex.test(query || '');
    if (streamName && containsSelectAll) {
      const streamSchema = await this.getStreamSchema(streamName);
      const schemaFields: SchemaFields[] | undefined = streamSchema.fields;
      if (schemaFields && schemaFields.length > 0) {
        const headers = schemaFields.map((field) => {
          const grafanaDatatype = (() => {
            if (field.name === 'p_timestamp') {
              return FieldType.time;
            } else if (!field?.data_type) {
              return FieldType.other;
            } else if (field.data_type === 'Boolean') {
              return FieldType.boolean;
            } else if (numberType.indexOf(field.data_type) !== -1) {
              return FieldType.number;
            } else if (stringType.indexOf(field.data_type) !== -1) {
              return FieldType.string;
            } else if (timeType.indexOf(field.data_type) !== -1) {
              return FieldType.time;
            } else {
              return FieldType.other;
            }
          })();
          return { name: field.name, type: grafanaDatatype };
        });
        dataFrame = new MutableDataFrame({ fields: headers });
      } else {
        setHeadersFromData();
      }
    } else {
      setHeadersFromData();
    }

    array.forEach((row) => {
      if (isHeadersMadeFromData) {
        dataFrame.appendRow(Object.values(row));
      } else {
        const keys = dataFrame.fields.map((field) => field.name);
        const defaultObj = keys.reduce((obj, key) => ({ ...obj, [key]: null }), {});
        const sanitizedObj = { ...defaultObj, ...row };
        dataFrame.appendRow(Object.values(sanitizedObj));
      }
    });

    return dataFrame;
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
