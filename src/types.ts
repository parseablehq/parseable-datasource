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
  stream?: string;
  filters?: FilterCondition[];
  selectedColumns?: string[];
  /** Field to monitor in alert/monitor mode (empty string = "All rows (*)") */
  monitorField?: string;
  /** Aggregate function for monitor mode: COUNT, SUM, AVG, MIN, MAX */
  monitorAggregate?: string;
  /** Selected metric name for metrics stream alerting */
  monitorMetric?: string;
  /** Type of the selected metric (gauge, sum, histogram, summary) */
  monitorMetricType?: string;
  alias?: string;
  target?: string;
  payload: string | { [key: string]: any };
}

export interface MetricInfo {
  metric_name: string;
  metric_description: string;
  metric_type: string;
  count: number;
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

export interface StreamInfoData {
  createdAt?: string;
  firstEventAt?: string;
  latestEventAt?: string;
  streamType?: string;
  logSource?: Array<{
    log_source_format?: string;
    fields?: string[];
  }>;
  telemetryType?: string;
  hotTierEnabled?: boolean;
}

export interface StreamInfoResponse {
  info?: StreamInfoData;
  schema?: StreamSchemaResponse;
  stats?: StreamStatsResponse;
  retention?: any[];
  status?: string;
  message?: string;
}

/**
 * A single field from the Parseable schema response.
 * `data_type` can be a plain string ("Utf8") or an object ({"Timestamp": ["Nanosecond", null]}).
 * Always use `parseType()` from utils/fieldTypes to normalize it.
 */
export interface SchemaFields {
  name: string;
  data_type: any;
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

export type QueryEditorMode = "code" | "builder" | "monitor";

/**
 * A single filter condition — matches Prism's FilterType structure.
 * `type` is the simplified field type from parseType().
 */
export interface FilterCondition {
  column: string;
  operator: string;
  value: string | number | boolean | null;
  type: string;
}
