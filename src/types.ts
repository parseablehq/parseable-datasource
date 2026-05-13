import { DataQuery, DataSourceJsonData, SelectableValue } from '@grafana/data';
import { TemplateSrv as GrafanaTemplateSrv } from '@grafana/runtime';

declare module '@grafana/runtime' {
  export interface TemplateSrv extends GrafanaTemplateSrv {
    getAdhocFilters(datasourceName: string): any;
  }
}

export type QueryLanguage = 'sql' | 'promql';

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
  /** Alerting sub-mode for metrics datasets: 'builder' (field/aggregate/filters → SQL)
   * or 'code' (PromQL). Defaults to 'code' when unset. */
  monitorMetricsMode?: 'builder' | 'code';
  /** Query language — sql (default) or promql */
  queryLanguage?: QueryLanguage;
  /** PromQL: run a range query (time series). Defaults to true when both flags are absent. */
  range?: boolean;
  /** PromQL: run an instant query (single-value at `to`). Used by Stat/Gauge/Table. */
  instant?: boolean;
  alias?: string;
  target?: string;
  payload: string | { [key: string]: any };
  /** PromQL Builder mode state — selected metric + label matcher rows.
   * The composed selector is also stored in queryText so PromQL/Builder
   * toggles stay in sync. */
  promBuilderMetric?: string;
  promBuilderMatchers?: PromLabelMatcher[];
}

export interface PromLabelMatcher {
  label: string;
  operator: '=' | '!=' | '=~' | '!~';
  value: string;
}

export interface MetricInfo {
  metric_name: string;
  metric_description: string;
  metric_type: string;
  count: number;
}

/** One entry from /prometheus/api/v1/metadata — type/help/unit per metric. */
export interface PromMetadataEntry {
  type?: string;
  help?: string;
  unit?: string;
}

export type PromVariableQueryType = 'label_names' | 'label_values' | 'metrics' | 'query_result';

/** Typed variable query for dashboards. Legacy string queries (SQL) are still
 * accepted by DataSource.metricFindQuery for backwards compatibility. */
export interface PromVariableQuery {
  qryType: PromVariableQueryType;
  stream: string;
  /** label_values: the label whose values to list. */
  label?: string;
  /** label_values: optional metric; when set, values are scoped to series of this metric. */
  metric?: string;
  /** metrics: regex to filter metric names (client-side). */
  regex?: string;
  /** query_result: arbitrary PromQL expression evaluated via instant query. */
  expr?: string;
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
  // Parseable returns raw bytes as a number; older builds emitted a string
  // like "12345 Bytes". Accept either so the panel renders both shapes.
  size?: number | string;
}

export interface Storage {
  format?: string;
  size?: number | string;
}

export interface Schema {
  schema?: string[];
}
/** Entry returned by /api/prism/v1/home → `datasets[]`. */
export interface Dataset {
  title: string;
  datasetType?: string; // 'logs' | 'metrics' | 'traces'
  datasetFormat?: string;
  ingestion?: boolean;
  timePartition?: string;
}

export interface HomeResponse {
  datasets?: Dataset[];
}

export type QueryEditorMode = "code" | "builder" | "monitor" | "promql";

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
