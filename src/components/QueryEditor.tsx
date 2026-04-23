import React, { ComponentType, useState, useCallback, useEffect, useMemo } from 'react';
import { css } from '@emotion/css';
import { CoreApp, GrafanaTheme2, QueryEditorProps, SelectableValue } from '@grafana/data';
import {
  AsyncSelect,
  Button,
  CodeEditor,
  InlineField,
  RadioButtonGroup,
  Select,
  useStyles2,
  MultiSelect,
} from '@grafana/ui';
import type { Monaco } from '@grafana/ui/dist/types/components/Monaco/types';
import { DataSource } from '../datasource';
import {
  SchemaFields,
  MyDataSourceOptions,
  MyQuery,
  FilterCondition,
  QueryEditorMode,
  StreamStatsResponse,
  MetricInfo,
} from '../types';
import { buildFieldTypeMap, FieldTypeMap, typeDisplayName, getAggregateOptions } from '../utils/fieldTypes';
import { buildSqlFromFilters, buildMonitorSql } from '../utils/queryBuilder';
import {
  ensurePromqlCompletionProvider,
  ensurePromqlSignatureHelpProvider,
  setPromqlCompletionContext,
  clearPromqlCompletionCaches,
} from '../utils/promqlCompletions';
import { ensurePromqlHoverProvider } from '../utils/promqlHover';
import { attachPromqlErrorMarkers } from '../utils/promqlParser';
import { getPromqlHistory } from '../utils/promqlHistory';
import { FilterBuilder } from './FilterBuilder';
import { StreamInfoPanel } from './StreamInfoPanel';

const ALL_ROWS_VALUE = '';

// Register PromQL as a custom Monaco language (syntax highlighting + bracket matching)
let promqlRegistered = false;
function ensurePromQLLanguage(monaco: Monaco) {
  if (promqlRegistered) {
    return;
  }
  promqlRegistered = true;

  monaco.languages.register({ id: 'promql' });

  monaco.languages.setMonarchTokensProvider('promql', {
    defaultToken: '',
    keywords: [
      'by',
      'without',
      'on',
      'ignoring',
      'group_left',
      'group_right',
      'bool',
      'offset',
      'and',
      'or',
      'unless',
      'start',
      'end',
    ],
    aggregations: [
      'sum',
      'avg',
      'min',
      'max',
      'count',
      'stddev',
      'stdvar',
      'topk',
      'bottomk',
      'quantile',
      'count_values',
      'group',
    ],
    functions: [
      'rate',
      'irate',
      'increase',
      'delta',
      'idelta',
      'avg_over_time',
      'sum_over_time',
      'min_over_time',
      'max_over_time',
      'count_over_time',
      'last_over_time',
      'stddev_over_time',
      'stdvar_over_time',
      'quantile_over_time',
      'present_over_time',
      'resets',
      'changes',
      'deriv',
      'predict_linear',
      'holt_winters',
      'sort',
      'sort_desc',
      'sort_by_label',
      'sort_by_label_desc',
      'abs',
      'ceil',
      'floor',
      'round',
      'ln',
      'log2',
      'log10',
      'exp',
      'sqrt',
      'sgn',
      'clamp',
      'clamp_min',
      'clamp_max',
      'scalar',
      'vector',
      'time',
      'timestamp',
      'day_of_month',
      'day_of_week',
      'day_of_year',
      'days_in_month',
      'hour',
      'minute',
      'month',
      'year',
      'label_replace',
      'label_join',
      'histogram_quantile',
      'histogram_avg',
      'histogram_count',
      'histogram_sum',
      'histogram_fraction',
      'histogram_stddev',
      'histogram_stdvar',
      'absent',
      'absent_over_time',
      'double_exponential_smoothing',
      'info',
    ],
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\b\d+(\.\d+)?([eE][+-]?\d+)?[smhdwy]?\b/, 'number'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/`[^`]*`/, 'string'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@aggregations': 'keyword',
              '@functions': 'type.identifier',
              '@default': 'identifier',
            },
          },
        ],
        [/[{}()\[\]]/, '@brackets'],
        [/[=!<>~]+/, 'operator'],
        [/@/, 'operator'],
        [/,/, 'delimiter'],
      ],
    },
  } as any);

  monaco.languages.setLanguageConfiguration('promql', {
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    // Parseable metrics allow OTel-style dotted names (process.cpu.time).
    // Tell Monaco those dots are part of a single word so completion filtering
    // and word-range detection treat `process.cpu.time` as one token.
    wordPattern: /[a-zA-Z_:][a-zA-Z0-9_:.]*/,
  });
}

// Bootstraps the tokenizer, the completion provider, the signature-help
// provider, and the hover provider for the shared Monaco instance. All are
// idempotent.
function setupPromqlEditor(monaco: Monaco) {
  ensurePromQLLanguage(monaco);
  ensurePromqlCompletionProvider(monaco);
  ensurePromqlSignatureHelpProvider(monaco);
  ensurePromqlHoverProvider(monaco);
}

interface Props extends QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions> {
  payload?: string;
}

const EXPLORE_MODE_OPTIONS = [
  { label: 'Builder', value: 'builder' as QueryEditorMode },
  { label: 'PromQL', value: 'promql' as QueryEditorMode },
];

export const QueryEditor: ComponentType<Props> = ({ datasource, onChange, onRunQuery, query, app }) => {
  const styles = useStyles2(getStyles);

  const isAlerting = app === CoreApp.UnifiedAlerting || app === CoreApp.CloudAlerting;
  // Dashboard panel (including the edit view) is where we surface our own
  // Run queries button. Explore already has Grafana's top-level Run button,
  // and Alerting uses its own preview / evaluate controls.
  const isDashboard = app === CoreApp.Dashboard || app === CoreApp.PanelEditor;
  const rawEditorMode = query.editorMode || datasource.defaultEditorMode || 'builder';
  const editorMode: QueryEditorMode = isAlerting ? 'monitor' : rawEditorMode === 'promql' ? 'promql' : 'builder';
  const filters = query.filters || [];
  const selectedColumns = query.selectedColumns || [];

  const [selectedStream, setSelectedStream] = useState<SelectableValue<string>>(
    query.stream ? { label: query.stream, value: query.stream } : ({} as SelectableValue<string>)
  );
  const [schemaFields, setSchemaFields] = useState<SchemaFields[]>([]);
  const [stats, setStats] = useState<StreamStatsResponse>({});
  const [telemetryType, setTelemetryType] = useState<string | undefined>();
  const [metricsList, setMetricsList] = useState<MetricInfo[]>([]);
  const [promLabels, setPromLabels] = useState<string[]>([]);
  const [promMetricNames, setPromMetricNames] = useState<string[]>([]);
  const [promMetadata, setPromMetadata] = useState<Record<string, { type?: string; help?: string; unit?: string }>>({});

  // Build fieldTypeMap and fieldNames from schema (like Prism's setStreamSchema)
  const fieldTypeMap: FieldTypeMap = useMemo(() => buildFieldTypeMap(schemaFields), [schemaFields]);
  const fieldNames: string[] = useMemo(() => schemaFields.map((f) => f.name), [schemaFields]);

  // Load datasets for dropdown (from /api/prism/v1/home). Sort matches Prism's
  // `getStreamName` in AppSideBar.tsx: actively-ingesting datasets first, then
  // the rest, alphabetical within each group. In PromQL mode, restrict to
  // metrics-type datasets since PromQL only makes sense against those.
  const loadAsyncOptions = useCallback(() => {
    return datasource.listDatasets().then(
      (result) =>
        result
          .filter((d) => (editorMode === 'promql' ? d.datasetType === 'metrics' : true))
          .sort((a, b) => {
            if (a.ingestion && !b.ingestion) {
              return -1;
            }
            if (!a.ingestion && b.ingestion) {
              return 1;
            }
            return a.title.localeCompare(b.title);
          })
          .map((d) => ({
            label: d.title,
            value: d.title,
            description: d.datasetType,
          })),
      (response) => {
        throw new Error(response.statusText);
      }
    );
  }, [datasource, editorMode]);

  // Load stream info (schema + stats + info) when stream changes
  useEffect(() => {
    const streamName = selectedStream?.value;
    if (streamName) {
      datasource
        .getStreamInfo(streamName)
        .then((result) => {
          if (result.schema?.fields) {
            setSchemaFields(result.schema.fields as SchemaFields[]);
          } else {
            setSchemaFields([]);
          }
          setStats(result.stats ?? {});
          const tType = result.info?.telemetryType;
          setTelemetryType(tType);

          // Fetch metric names and PromQL metadata for metrics streams
          if (tType === 'metrics') {
            datasource
              .getMetricNames(streamName)
              .then(setMetricsList)
              .catch(() => setMetricsList([]));
            datasource
              .getPromLabels(streamName)
              .then(setPromLabels)
              .catch(() => setPromLabels([]));
            datasource
              .getPromMetricNames(streamName)
              .then(setPromMetricNames)
              .catch(() => setPromMetricNames([]));
            datasource
              .getPromMetadata(streamName)
              .then(setPromMetadata)
              .catch(() => setPromMetadata({}));
          } else {
            setMetricsList([]);
            setPromLabels([]);
            setPromMetricNames([]);
            setPromMetadata({});
          }
        })
        .catch(() => {
          setSchemaFields([]);
          setStats({});
          setTelemetryType(undefined);
          setMetricsList([]);
          setPromLabels([]);
          setPromMetricNames([]);
          setPromMetadata({});
        });
    } else {
      setSchemaFields([]);
      setStats({});
      setTelemetryType(undefined);
      setMetricsList([]);
      setPromLabels([]);
      setPromMetricNames([]);
      setPromMetadata({});
    }
  }, [datasource, selectedStream?.value]);

  // Clear completion caches when stream changes so scoped labels/values
  // fetched via /series don't leak across datasets.
  useEffect(() => {
    clearPromqlCompletionCaches();
  }, [selectedStream?.value]);

  // Handle stream change
  const onStreamChange = useCallback(
    (v: SelectableValue<string>) => {
      setSelectedStream(v);
      const streamName = v.value || '';
      const newQuery: MyQuery = { ...query, stream: streamName };

      if (editorMode === 'builder') {
        newQuery.filters = [];
        newQuery.selectedColumns = [];
        newQuery.queryText = buildSqlFromFilters(streamName, [], [], fieldTypeMap);
        newQuery.queryLanguage = 'sql';
      } else if (editorMode === 'promql') {
        newQuery.queryLanguage = 'promql';
      } else if (editorMode === 'monitor') {
        newQuery.filters = [];
        newQuery.monitorField = ALL_ROWS_VALUE;
        newQuery.monitorAggregate = 'COUNT';
        newQuery.monitorMetric = undefined;
        newQuery.monitorMetricType = undefined;
        // Clear text + language; the stream-info effect will decide whether
        // this is a metrics (PromQL empty) or logs/traces (SQL default)
        // stream once telemetry type resolves. Firing onRunQuery here would
        // race against that resolution and cause SQL/PromQL to be sent in
        // the wrong mode, so monitor mode skips auto-run on stream change.
        newQuery.queryText = '';
        newQuery.queryLanguage = undefined;
      }
      onChange(newQuery);
      if (editorMode !== 'monitor') {
        onRunQuery();
      }
    },
    [query, onChange, onRunQuery, editorMode, fieldTypeMap]
  );

  // Handle mode change
  const onModeChange = useCallback(
    (mode: QueryEditorMode) => {
      const newQuery: MyQuery = { ...query, editorMode: mode };

      if (mode === 'builder' && selectedStream?.value) {
        newQuery.filters = [];
        newQuery.selectedColumns = [];
        newQuery.queryText = buildSqlFromFilters(selectedStream.value, [], [], fieldTypeMap);
        newQuery.queryLanguage = 'sql';
      } else if (mode === 'promql') {
        newQuery.queryLanguage = 'promql';
        if (query.queryLanguage !== 'promql') {
          newQuery.queryText = '';
        }
      } else if (mode === 'monitor' && selectedStream?.value) {
        const field = query.monitorField ?? ALL_ROWS_VALUE;
        const agg = query.monitorAggregate ?? 'COUNT';
        newQuery.filters = query.filters || [];
        newQuery.monitorField = field;
        newQuery.monitorAggregate = agg;
        newQuery.queryText = buildMonitorSql(selectedStream.value, field, agg, newQuery.filters, fieldTypeMap);
      }
      onChange(newQuery);
      onRunQuery();
    },
    [query, onChange, onRunQuery, selectedStream, fieldTypeMap]
  );

  // Handle filter changes (builder mode)
  const onFiltersChange = useCallback(
    (newFilters: FilterCondition[]) => {
      if (!selectedStream?.value) {
        return;
      }
      const sql = buildSqlFromFilters(selectedStream.value, newFilters, selectedColumns, fieldTypeMap);
      onChange({ ...query, filters: newFilters, queryText: sql });
      onRunQuery();
    },
    [query, onChange, onRunQuery, selectedStream, selectedColumns, fieldTypeMap]
  );

  // Handle column selection changes (builder mode)
  const onColumnsChange = useCallback(
    (cols: Array<SelectableValue<string>>) => {
      if (!selectedStream?.value) {
        return;
      }
      const colNames = cols.map((c) => c.value!).filter(Boolean);
      const sql = buildSqlFromFilters(selectedStream.value, filters, colNames, fieldTypeMap);
      onChange({ ...query, selectedColumns: colNames, queryText: sql });
      onRunQuery();
    },
    [query, onChange, onRunQuery, selectedStream, filters, fieldTypeMap]
  );

  // Handle monitor field change
  const onMonitorFieldChange = useCallback(
    (v: SelectableValue<string>) => {
      if (!selectedStream?.value) {
        return;
      }
      const field = v.value ?? ALL_ROWS_VALUE;
      // Pick a valid aggregate for the new field
      const aggOptions = getAggregateOptions(fieldTypeMap, field);
      const currentAgg = query.monitorAggregate || 'COUNT';
      const agg = aggOptions.some((o) => o.value === currentAgg) ? currentAgg : aggOptions[0].value;

      const sql = buildMonitorSql(selectedStream.value, field, agg, filters, fieldTypeMap);
      onChange({ ...query, monitorField: field, monitorAggregate: agg, queryText: sql });
      onRunQuery();
    },
    [query, onChange, onRunQuery, selectedStream, filters, fieldTypeMap]
  );

  // Handle monitor aggregate change
  const onMonitorAggregateChange = useCallback(
    (v: SelectableValue<string>) => {
      if (!selectedStream?.value) {
        return;
      }
      const agg = v.value || 'COUNT';
      const field = query.monitorField ?? ALL_ROWS_VALUE;
      const sql = buildMonitorSql(selectedStream.value, field, agg, filters, fieldTypeMap);
      onChange({ ...query, monitorAggregate: agg, queryText: sql });
      onRunQuery();
    },
    [query, onChange, onRunQuery, selectedStream, filters, fieldTypeMap]
  );

  // Handle filter changes in monitor mode
  const onMonitorFiltersChange = useCallback(
    (newFilters: FilterCondition[]) => {
      if (!selectedStream?.value) {
        return;
      }
      const field = query.monitorField ?? ALL_ROWS_VALUE;
      const agg = query.monitorAggregate ?? 'COUNT';
      const sql = buildMonitorSql(selectedStream.value, field, agg, newFilters, fieldTypeMap);
      onChange({ ...query, filters: newFilters, queryText: sql });
      onRunQuery();
    },
    [query, onChange, onRunQuery, selectedStream, fieldTypeMap]
  );

  const isMetricsStream = telemetryType === 'metrics';

  // -- Metrics alert handlers --

  // Merged metadata map for metric autocomplete + pickers. Prefers /metadata
  // (native Prom endpoint); falls back to SQL-derived metricsList when the
  // server hasn't populated metadata for a metric.
  const metricMetadata = useMemo((): Record<string, { type?: string; help?: string }> => {
    const out: Record<string, { type?: string; help?: string }> = {};
    metricsList.forEach((m) => {
      if (m.metric_name) {
        out[m.metric_name] = { type: m.metric_type, help: m.metric_description };
      }
    });
    Object.keys(promMetadata).forEach((name) => {
      const entry = promMetadata[name];
      const existing = out[name] || {};
      out[name] = {
        type: entry.type || existing.type,
        help: entry.help || existing.help,
      };
    });
    return out;
  }, [metricsList, promMetadata]);

  // Publish the current state to the Monaco PromQL completion provider so it
  // returns context-aware suggestions (metrics, labels scoped to a metric,
  // label values, function snippets). Shared across Explore, Dashboards and
  // Alerts — same provider, same data.
  useEffect(() => {
    const streamName = selectedStream?.value || '';
    if (!streamName) {
      setPromqlCompletionContext(null);
      return;
    }
    setPromqlCompletionContext({
      streamName,
      metricNames: promMetricNames,
      metricMetadata,
      labels: promLabels,
      datasource,
      history: getPromqlHistory(datasource.uid),
    });
    // Re-read history when the user's query text commits (queries are
    // recorded during `datasource.query()` on Run). Reading on every
    // invocation of this effect is fine — it's synchronous localStorage.
  }, [selectedStream?.value, promMetricNames, promLabels, metricMetadata, datasource, query.queryText]);

  // Clear context on unmount so stale suggestions don't leak across editors.
  useEffect(() => {
    return () => {
      setPromqlCompletionContext(null);
    };
  }, []);

  // Per-keystroke in the Monaco PromQL editor — updates the query spec only.
  // Explicit run happens on blur (below), Shift+Enter, or the Run query button.
  const onMetricsCodeChange = useCallback(
    (value: string) => {
      onChange({ ...query, queryText: value, queryLanguage: 'promql' });
    },
    [query, onChange]
  );

  // Blur on the Monaco editor — commit the text only. Running the query is
  // user-initiated via the Run queries button, Shift+Enter, or a committed
  // UI action (mode/stream/filter change). Matches native Prometheus plugin.
  const onMetricsCodeBlur = useCallback(
    (value: string) => {
      onChange({ ...query, queryText: value, queryLanguage: 'promql' });
    },
    [query, onChange]
  );

  // Ensure metrics-stream alerts always use PromQL. Triggers when:
  //   - queryLanguage isn't set yet (fresh stream selection)
  //   - queryLanguage is 'sql' (legacy saved alert from the old builder)
  // Clears the text so the editor opens empty for the user to type PromQL.
  useEffect(() => {
    if (
      isAlerting &&
      isMetricsStream &&
      selectedStream?.value &&
      query.queryLanguage !== 'promql'
    ) {
      onChange({
        ...query,
        queryText: query.queryLanguage === 'sql' ? '' : query.queryText || '',
        queryLanguage: 'promql',
        monitorMetric: undefined,
        monitorMetricType: undefined,
      });
    }
  }, [isAlerting, isMetricsStream, selectedStream?.value, query.queryLanguage]);

  // Backfill default SQL for non-metrics monitor alerts (logs / traces) if
  // queryText is still empty after the telemetry type has resolved. Without
  // this, Grafana's /eval fires with an empty query and the backend returns
  // 500. The user can still override by picking a field / aggregate.
  useEffect(() => {
    if (
      isAlerting &&
      telemetryType !== undefined &&
      !isMetricsStream &&
      selectedStream?.value &&
      (!query.queryText || !query.queryText.trim())
    ) {
      const field = query.monitorField ?? ALL_ROWS_VALUE;
      const agg = query.monitorAggregate ?? 'COUNT';
      const sql = buildMonitorSql(selectedStream.value, field, agg, query.filters || [], fieldTypeMap);
      onChange({
        ...query,
        monitorField: field,
        monitorAggregate: agg,
        queryText: sql,
        queryLanguage: 'sql',
      });
    }
  }, [isAlerting, telemetryType, isMetricsStream, selectedStream?.value, fieldTypeMap]);

  // Monitor field options: "All rows (*)" + all non-internal fields
  const monitorFieldOptions = useMemo(() => {
    const options: Array<SelectableValue<string>> = [{ label: 'All rows (*)', value: ALL_ROWS_VALUE }];
    fieldNames
      .filter((name) => !name.startsWith('p_'))
      .forEach((name) => {
        options.push({
          label: name,
          value: name,
          description: typeDisplayName(fieldTypeMap[name]),
        });
      });
    return options;
  }, [fieldNames, fieldTypeMap]);

  // Aggregate options for the currently selected monitor field
  const aggregateOptions = useMemo(() => {
    const field = query.monitorField ?? ALL_ROWS_VALUE;
    return getAggregateOptions(fieldTypeMap, field);
  }, [query.monitorField, fieldTypeMap]);

  // Column options for multi-select
  const columnOptions = useMemo(() => {
    return fieldNames.map((name) => ({
      label: name,
      value: name,
      description: typeDisplayName(fieldTypeMap[name]),
    }));
  }, [fieldNames, fieldTypeMap]);

  return (
    <div className={styles.wrapper}>
      {/* Dataset Info Sidebar */}
      {!isAlerting && selectedStream?.value && editorMode !== 'promql' && (
        <StreamInfoPanel fieldNames={fieldNames} fieldTypeMap={fieldTypeMap} stats={stats} />
      )}

      {/* Main Query Area */}
      <div className={styles.mainArea}>
        {/* Top bar: Dataset select + Mode toggle */}
        <div className={styles.topBar}>
          <InlineField label="Dataset" labelWidth={8}>
            <AsyncSelect
              key={editorMode}
              loadOptions={loadAsyncOptions}
              defaultOptions
              value={selectedStream}
              onChange={onStreamChange}
              placeholder="Select a stream"
              width={30}
            />
          </InlineField>

          <div className={styles.topBarRight}>
            {/* Run queries button — Dashboard only. Explore has Grafana's
                native top-bar Run button; Alerting uses its own preview /
                evaluate flow. Matches native Prometheus plugin's behavior. */}
            {(isDashboard || isAlerting) && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => onRunQuery()}
                disabled={!query.queryText?.trim()}
              >
                Run queries
              </Button>
            )}
            {!isAlerting && (
              <RadioButtonGroup options={EXPLORE_MODE_OPTIONS} value={editorMode} onChange={onModeChange} size="sm" />
            )}
          </div>
        </div>

        {/* Builder Mode */}
        {editorMode === 'builder' && selectedStream?.value && (
          <div className={styles.builderArea}>
            {/* Filters */}
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Filters</div>
              <FilterBuilder
                filters={filters}
                fieldTypeMap={fieldTypeMap}
                fieldNames={fieldNames}
                streamName={selectedStream.value}
                datasource={datasource}
                onChange={onFiltersChange}
              />
            </div>

            {/* Column Selection */}
            <div className={styles.section}>
              <InlineField label="Columns" labelWidth={8} tooltip="Select specific columns or leave empty for all (*)">
                <MultiSelect
                  options={columnOptions}
                  value={selectedColumns.map((c) => ({ label: c, value: c }))}
                  onChange={onColumnsChange}
                  placeholder="All columns (*)"
                  isClearable
                  width={50}
                />
              </InlineField>
            </div>

            {/* SQL Preview */}
            <div className={styles.sqlPreviewSection}>
              <div className={styles.sectionLabel}>Generated SQL</div>
              <pre className={styles.sqlPreviewText}>{query.queryText || ''}</pre>
            </div>
          </div>
        )}

        {/* Monitor Mode — Metrics streams: always PromQL (no builder). */}
        {editorMode === 'monitor' && selectedStream?.value && isMetricsStream && (
          <div className={styles.metricsCodeArea}>
            <CodeEditor
              value={query.queryText || ''}
              language="promql"
              height={200}
              showMiniMap={false}
              showLineNumbers={true}
              onChange={onMetricsCodeChange}
              onBlur={onMetricsCodeBlur}
              onBeforeEditorMount={setupPromqlEditor}
              onEditorDidMount={(editor, monaco) => attachPromqlErrorMarkers(editor, monaco)}
              monacoOptions={{
                wordWrap: 'on',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                quickSuggestions: { other: true, comments: false, strings: true },
                suggestOnTriggerCharacters: true,
                wordBasedSuggestions: false,
                suggest: {
                  showKeywords: true,
                  showFunctions: true,
                  showFields: true,
                  showProperties: true,
                  showValues: true,
                  showWords: false,
                },
              }}
            />
          </div>
        )}

        {/* Monitor Mode — Non-metrics streams */}
        {editorMode === 'monitor' && selectedStream?.value && !isMetricsStream && (
          <div className={styles.builderArea}>
            {/* Field + Aggregate row */}
            <div className={styles.monitorRow}>
              <InlineField label="Monitor" labelWidth={8}>
                <Select
                  options={monitorFieldOptions}
                  value={
                    monitorFieldOptions.find((o) => o.value === (query.monitorField ?? ALL_ROWS_VALUE)) ||
                    monitorFieldOptions[0]
                  }
                  onChange={onMonitorFieldChange}
                  width={30}
                  menuPlacement="bottom"
                />
              </InlineField>

              <InlineField label="by" labelWidth={4}>
                <Select
                  options={aggregateOptions}
                  value={
                    aggregateOptions.find((o) => o.value === (query.monitorAggregate || 'COUNT')) || aggregateOptions[0]
                  }
                  onChange={onMonitorAggregateChange}
                  width={16}
                  menuPlacement="bottom"
                  disabled={(query.monitorField ?? ALL_ROWS_VALUE) === ALL_ROWS_VALUE}
                />
              </InlineField>
            </div>

            {/* Filters */}
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Filters</div>
              <FilterBuilder
                filters={filters}
                fieldTypeMap={fieldTypeMap}
                fieldNames={fieldNames}
                streamName={selectedStream.value}
                datasource={datasource}
                onChange={onMonitorFiltersChange}
              />
            </div>

            {/* SQL Preview */}
            <div className={styles.sqlPreviewSection}>
              <div className={styles.sectionLabel}>Generated SQL</div>
              <pre className={styles.sqlPreviewText}>{query.queryText || ''}</pre>
            </div>
          </div>
        )}

        {/* PromQL Mode (Explore) */}
        {editorMode === 'promql' && selectedStream?.value && (
          <>
            <div className={styles.metricsToggleRow}>
              <RadioButtonGroup
                options={[
                  { label: 'Range', value: 'range' as const },
                  { label: 'Instant', value: 'instant' as const },
                  { label: 'Both', value: 'both' as const },
                ]}
                value={
                  query.instant && query.range
                    ? 'both'
                    : query.instant
                    ? 'instant'
                    : 'range'
                }
                onChange={(mode) => {
                  const range = mode === 'range' || mode === 'both';
                  const instant = mode === 'instant' || mode === 'both';
                  onChange({ ...query, range, instant });
                  onRunQuery();
                }}
                size="sm"
              />
            </div>
          <div className={styles.promqlArea}>
            <CodeEditor
              value={query.queryText || ''}
              language="promql"
              height={60}
              showMiniMap={false}
              showLineNumbers={false}
              onChange={onMetricsCodeChange}
              onBlur={onMetricsCodeBlur}
              onBeforeEditorMount={setupPromqlEditor}
              onEditorDidMount={(editor, monaco) => attachPromqlErrorMarkers(editor, monaco)}
              monacoOptions={{
                wordWrap: 'on',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'off',
                folding: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 0,
                glyphMargin: false,
                renderLineHighlight: 'none',
                quickSuggestions: { other: true, comments: false, strings: true },
                suggestOnTriggerCharacters: true,
                wordBasedSuggestions: false,
                suggest: {
                  showKeywords: true,
                  showFunctions: true,
                  showFields: true,
                  showProperties: true,
                  showValues: true,
                  showWords: false,
                },
              }}
            />
          </div>
          </>
        )}

        {/* Prompt to select stream */}
        {!selectedStream?.value && (
          <div className={styles.placeholder}>Select a dataset to start building your query</div>
        )}
      </div>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    gap: theme.spacing(2),
    width: '100%',
  }),
  mainArea: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minWidth: 0,
  }),
  topBar: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
  }),
  modeToggle: css({
    flexShrink: 0,
  }),
  topBarRight: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexShrink: 0,
  }),
  builderArea: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),
  monitorRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  }),
  metricsToggleRow: css({
    display: 'flex',
    justifyContent: 'flex-end',
  }),
  metricsCodeArea: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  section: css({}),
  sectionLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.5),
  }),
  sqlPreviewSection: css({
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(1),
  }),
  sqlPreviewText: css({
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    margin: 0,
    wordBreak: 'break-all',
  }),
  promqlArea: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  placeholder: css({
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    padding: theme.spacing(2),
  }),
});
