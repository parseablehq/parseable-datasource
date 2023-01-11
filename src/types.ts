import { DataQuery, DataSourceJsonData, SelectableValue } from '@grafana/data';
import { TemplateSrv as GrafanaTemplateSrv } from '@grafana/runtime';

declare module '@grafana/runtime' {
  export interface TemplateSrv extends GrafanaTemplateSrv {
    getAdhocFilters(datasourceName: string): any;
  }
}

export interface MyQuery extends DataQuery {
  queryText: string;
  editorMode?: QueryEditorMode;
  alias?: string;
  target?: string;
  payload: string | { [key: string]: any };
}

/**
 * These are options configured for each DataSource instance
 */
export interface MyDataSourceOptions extends DataSourceJsonData {
  url: string;
  path?: string;
  username: string;
  defaultEditorMode?: QueryEditorMode;
}

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface MySecureJsonData {
  password?: string;
}
export interface StreamPayloadConfig {
  width?: number;
  placeholder?: string;
  name: string;
  label?: string;
  type?: "input" | "select" | "multi-select" | "textarea";
  reloadMetric?: boolean;
  options?: Array<SelectableValue<string | number>>;
}

export interface StreamConfig {
  value: string;
  label?: string;
  text?: string;
  payloads?: StreamPayloadConfig[];
}

export interface StreamName {
  label: String | Number;
  value: String | Number;
}

export interface StreamSchemaResponse {
  fields?: [] | undefined;
  status?: string;
  message?: string;
}

export interface StreamStatsResponse {
  ingestion?: Ingestion;
  storage?: Storage;
  time?: string;
  stream?: string;
  status?: string;
  message?: string;
}

export interface SchemaFields {
  name?: string;
  data_type?: "Utf8";
  nullable?: boolean;
  dict_id?: number;
  dict_is_ordered?: boolean;
}

export interface Ingestion {
  count?: number;
  format?: string;
  size?: string;
}

export interface Storage {
  format?: string;
  size?: string;
}

export interface Schema {
  schema?: string[];
}
export interface StreamList {
  name?: string;
}

export type QueryEditorMode = "code" | "builder";
