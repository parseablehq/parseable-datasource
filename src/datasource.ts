import { getBackendSrv,BackendSrvRequest,FetchResponse } from "@grafana/runtime";

import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  MutableDataFrame,
  DataFrame,
  FieldType,
  guessFieldTypeFromValue,
} from '@grafana/data';
import { lastValueFrom, of } from 'rxjs';
import { MyQuery, MyDataSourceOptions } from './types';
import { catchError, map } from 'rxjs/operators';

export class DataSource extends DataSourceApi<MyQuery, MyDataSourceOptions> {
  url: string;
  withCredentials: boolean;
  headers: any;
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions> ) {
    super(instanceSettings);
    this.url = instanceSettings.url === undefined ? '' : instanceSettings.url;
    this.withCredentials = instanceSettings.withCredentials !== undefined;
    console.log("this", instanceSettings)
  }

  async doRequest(query: MyQuery) {
    const routePath = '/api/v1'
    const result = await getBackendSrv().datasourceRequest({
      method: "GET",
      url: this.url + routePath+ '/readiness',
      params: query,
    })
    return result;
  }

  async query(options: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    options.targets = options.targets.filter((t) => !t.hide);
    if (options.targets.length === 0) {
      return Promise.resolve({ data: [] });
    }

    const { range } = options;
    if (!range) {
      return Promise.resolve({ data: [] });
    }
    const start = range!.from;
    const end = range!.to;

    const calls = options.targets.map(target => { 
      const request = { 
        "query":target.queryText, 
        "startTime":start.toISOString(),
        "endTime":end.toISOString() 
      };
      return lastValueFrom(
        this.doFetch<any[]>({
          url: this.url+'/api/v1/query',
          data: request,
          method: 'POST',
        }).pipe(
          map((response) => {
            return this.arrayToDataFrame(response.data);
          }),
          catchError((err) => {
            console.error(err);
            return of({ data: [] });
          })
        )
      );
    });

    const data = await Promise.all(calls);
    return {
      data,
    };
  }  

  doFetch<T>(options: BackendSrvRequest) {
    options.withCredentials = this.withCredentials;
    options.headers = this.headers;

    return getBackendSrv().fetch<T>(options);
  }

    arrayToDataFrame(array: any[]): DataFrame {
    let dataFrame: MutableDataFrame = new MutableDataFrame();
    if (array.length > 0) {
      const fields = Object.keys(array[0]).map(field => {
        return { name: field, type: guessFieldTypeFromValue(array[0][field]) };
      });

      let timeFieldFound = false;
      for (const field of fields) {
        // Check for p_timestamp first
        // because if it is present we want to use this field
        // as we know the format (ISO8601)
        if (field.name.toLowerCase() === 'p_timestamp') {
          field.type = FieldType.time;
          timeFieldFound = true;
          break;
        } 
      }
      // fallback to other possible time fields
      // if p_timestamp is not present
      if (!timeFieldFound) {  
        for (const field of fields) {
          if (field.name.toLowerCase() === 'time' || 'datetime' || 'timestamp' || 'date') {
            field.type = FieldType.time;
            break;
          }
        }
      }

      dataFrame = new MutableDataFrame({ fields });
      array.forEach((row, index) => {
        dataFrame.appendRow(Object.values(row));
      });
    }
    return dataFrame;
  }

  async testDatasource() {
    const errorMessageBase = 'Parseable server is not reachable';
    try {
      const response = await lastValueFrom(
        this.doFetch({
          url: this.url+'/api/v1/readiness',
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
