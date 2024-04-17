import { getBackendSrv, getTemplateSrv, BackendSrvRequest, FetchResponse, DataSourceWithBackend } from "@grafana/runtime";
import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  MutableDataFrame,
  DataFrame,
  FieldType,
  guessFieldTypeFromValue,
  MetricFindValue
} from '@grafana/data';
import { lastValueFrom, of, Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { isArray, isNull } from "lodash";

import {
  MyQuery,
  MyDataSourceOptions,
  QueryEditorMode,
  StreamName,
  StreamList,
  StreamSchemaResponse,
  StreamStatsResponse
} from './types';
export class DataSource extends DataSourceWithBackend<MyQuery, MyDataSourceOptions> {
  url: string;
  withCredentials: boolean;
  headers: any;
  defaultEditorMode: QueryEditorMode;
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.url = instanceSettings.url === undefined ? '' : instanceSettings.url;
    this.withCredentials = instanceSettings.withCredentials !== undefined;
    this.defaultEditorMode = instanceSettings.jsonData?.defaultEditorMode ?? "code"
  }

  async doRequest(query: MyQuery) {
    const routePath = '/api/v1'
    const result = await getBackendSrv().datasourceRequest({
      method: "GET",
      url: this.url + routePath + '/readiness',
      params: query,
    })
    return result;
  }

  query(options: DataQueryRequest<MyQuery>): Observable<DataQueryResponse>{
    return new Observable<DataQueryResponse>(observer => {
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

      const calls = options.targets.map(target => {
        const query = getTemplateSrv().replace(target.queryText, options.scopedVars, this.formatter);

        const request = {
          "query": query,
          "startTime": start.toISOString(),
          "endTime": end.toISOString(),
          "send_null": true
        };

        return lastValueFrom(
          this.doFetch<any[]>({
            url: this.url + '/api/v1/query',
            data: request,
            method: 'POST',
          }).pipe(
            map((response) => {
              return this.arrayToDataFrame(response.data);
            }),
            catchError((err) => {
              throw new Error(err.data.message);
            })
          )
        );
      });

      Promise.all(calls).then(data => {
        observer.next({ data });
        observer.complete();
      }).catch(error => {
        observer.error(error);
      });
    });
  }

  private formatter(value: string | string[], options: any): string {
    if (options.multi && Array.isArray(value)) {
      return (value as string[]).map(v => `'${v}'`).join(',');
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
      to: to
    }

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
    })
  }

  arrayToDataFrame(array: any[]): DataFrame {
    let dataFrame: MutableDataFrame = new MutableDataFrame();

    if (array.length > 0) {
      const fields = Object.keys(array[0]).map(field => {
        let fieldType = guessFieldTypeFromValue(array[0][field])
        // p_timestamp is always a time field present in the log
        // stream as parseable adds it to the log event
        if (field.toLowerCase() === 'p_timestamp') {
          fieldType = FieldType.time;
        }
        return { name: field, type: fieldType};
      });
      dataFrame = new MutableDataFrame({ fields });
    }

    array.forEach((row) => {
      dataFrame.appendRow(Object.values(row));
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
        map((response) =>
          isArray(response.data)
            ? response.data
            : []
        ),
        catchError((err) => {
          return of([]);
        }))
    );
  }

  async streamStats(streamname: StreamName): Promise<StreamStatsResponse> {
    if (streamname) {
      return lastValueFrom(
        this.doFetch({
          url: this.url + '/api/v1/logstream/' + streamname.value + '/stats',
          method: 'GET',
        }).pipe(
          map((response) =>
            (typeof response.data === 'object' && !isNull(response.data))
              ? response.data
              : {}
          ),
          catchError((err) => {
            return of({
              status: 'error',
              message: err.statusText
            })

          }))
      )
    }
    return {}
  }

  async streamSchema(streamname: StreamName): Promise<StreamSchemaResponse> {
    if (streamname) {
      return lastValueFrom(
        this.doFetch({
          url: this.url + '/api/v1/logstream/' + streamname.value + '/schema',
          method: 'GET',
        }).pipe(
          map((response) =>
            (typeof response.data === 'object' && !isNull(response.data))
              ? response.data
              : {}
          ),
          catchError((err) => {
            return of({
              status: 'error',
              message: err.statusText
            })

          }))
      )
    }
    return { fields: [] }
  }

  async testDatasource() {
    const errorMessageBase = 'Parseable server is not reachable. Verify that your basic authentication credentials are accurate.';
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
        message: response.statusText ? response.statusText : errorMessageBase,
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
