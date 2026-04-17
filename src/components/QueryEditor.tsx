import React, { ComponentType, ChangeEvent, useState, useCallback, useEffect, useMemo } from 'react';
import { css } from '@emotion/css';
import { CoreApp, GrafanaTheme2, QueryEditorProps, SelectableValue } from '@grafana/data';
import { AsyncSelect, InlineField, RadioButtonGroup, Select, useStyles2, MultiSelect } from '@grafana/ui';
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
import { buildSqlFromFilters, buildMonitorSql, buildMetricsAlertSql } from '../utils/queryBuilder';
import { FilterBuilder } from './FilterBuilder';
import { StreamInfoPanel } from './StreamInfoPanel';

const ALL_ROWS_VALUE = '';

interface Props extends QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions> {
  payload?: string;
}

const MODE_OPTIONS = [
  { label: 'Builder', value: 'builder' as QueryEditorMode },
  { label: 'Monitor', value: 'monitor' as QueryEditorMode },
  { label: 'Code', value: 'code' as QueryEditorMode },
];

export const QueryEditor: ComponentType<Props> = ({ datasource, onChange, onRunQuery, query, app }) => {
  const styles = useStyles2(getStyles);

  const isAlerting = app === CoreApp.UnifiedAlerting || app === CoreApp.CloudAlerting;
  const editorMode = isAlerting ? 'monitor' : query.editorMode || datasource.defaultEditorMode || 'builder';
  const filters = query.filters || [];
  const selectedColumns = query.selectedColumns || [];

  const [selectedStream, setSelectedStream] = useState<SelectableValue<string>>(
    query.stream ? { label: query.stream, value: query.stream } : ({} as SelectableValue<string>)
  );
  const [schemaFields, setSchemaFields] = useState<SchemaFields[]>([]);
  const [stats, setStats] = useState<StreamStatsResponse>({});
  const [telemetryType, setTelemetryType] = useState<string | undefined>();
  const [metricsList, setMetricsList] = useState<MetricInfo[]>([]);

  // Build fieldTypeMap and fieldNames from schema (like Prism's setStreamSchema)
  const fieldTypeMap: FieldTypeMap = useMemo(() => buildFieldTypeMap(schemaFields), [schemaFields]);
  const fieldNames: string[] = useMemo(() => schemaFields.map((f) => f.name), [schemaFields]);

  // Load streams for dropdown
  const loadAsyncOptions = useCallback(() => {
    return datasource.listStreams().then(
      (result) => result.map((data) => ({ label: data.name, value: data.name })),
      (response) => {
        throw new Error(response.statusText);
      }
    );
  }, [datasource]);

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

          // Fetch metric names for metrics streams
          if (tType === 'metrics') {
            datasource
              .getMetricNames(streamName)
              .then(setMetricsList)
              .catch(() => setMetricsList([]));
          } else {
            setMetricsList([]);
          }
        })
        .catch(() => {
          setSchemaFields([]);
          setStats({});
          setTelemetryType(undefined);
          setMetricsList([]);
        });
    } else {
      setSchemaFields([]);
      setStats({});
      setTelemetryType(undefined);
      setMetricsList([]);
    }
  }, [datasource, selectedStream?.value]);

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
      } else if (editorMode === 'monitor') {
        newQuery.filters = [];
        // Reset both monitor types; the correct UI will render once info loads
        newQuery.monitorField = ALL_ROWS_VALUE;
        newQuery.monitorAggregate = 'COUNT';
        newQuery.monitorMetric = undefined;
        newQuery.monitorMetricType = undefined;
        newQuery.queryText = '';
      }
      onChange(newQuery);
    },
    [query, onChange, editorMode, fieldTypeMap]
  );

  // Handle mode change
  const onModeChange = useCallback(
    (mode: QueryEditorMode) => {
      const newQuery: MyQuery = { ...query, editorMode: mode };

      if (mode === 'builder' && selectedStream?.value) {
        newQuery.filters = [];
        newQuery.selectedColumns = [];
        newQuery.queryText = buildSqlFromFilters(selectedStream.value, [], [], fieldTypeMap);
      } else if (mode === 'monitor' && selectedStream?.value) {
        const field = query.monitorField ?? ALL_ROWS_VALUE;
        const agg = query.monitorAggregate ?? 'COUNT';
        newQuery.filters = query.filters || [];
        newQuery.monitorField = field;
        newQuery.monitorAggregate = agg;
        newQuery.queryText = buildMonitorSql(selectedStream.value, field, agg, newQuery.filters, fieldTypeMap);
      }
      onChange(newQuery);
    },
    [query, onChange, selectedStream, fieldTypeMap]
  );

  // Handle filter changes (builder mode)
  const onFiltersChange = useCallback(
    (newFilters: FilterCondition[]) => {
      if (!selectedStream?.value) {
        return;
      }
      const sql = buildSqlFromFilters(selectedStream.value, newFilters, selectedColumns, fieldTypeMap);
      onChange({ ...query, filters: newFilters, queryText: sql });
    },
    [query, onChange, selectedStream, selectedColumns, fieldTypeMap]
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
    },
    [query, onChange, selectedStream, filters, fieldTypeMap]
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
    },
    [query, onChange, selectedStream, filters, fieldTypeMap]
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
    },
    [query, onChange, selectedStream, filters, fieldTypeMap]
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
    },
    [query, onChange, selectedStream, fieldTypeMap]
  );

  const isMetricsStream = telemetryType === 'metrics';

  // -- Metrics alert handlers --

  const metricsOptions = useMemo((): Array<SelectableValue<string>> => {
    return metricsList.map((m) => ({
      label: m.metric_name,
      value: m.metric_name,
      description: `${m.metric_type}${m.metric_description ? ' - ' + m.metric_description : ''}`,
    }));
  }, [metricsList]);

  const onMetricChange = useCallback(
    (v: SelectableValue<string>) => {
      if (!selectedStream?.value) {
        return;
      }
      const metricName = v.value || '';
      const metric = metricsList.find((m) => m.metric_name === metricName);
      const metricType = metric?.metric_type || '';
      const sql = buildMetricsAlertSql(selectedStream.value, metricName, metricType, 'AVG', filters, fieldTypeMap);
      onChange({ ...query, monitorMetric: metricName, monitorMetricType: metricType, queryText: sql });
    },
    [query, onChange, selectedStream, filters, fieldTypeMap, metricsList]
  );

  const onMetricsFiltersChange = useCallback(
    (newFilters: FilterCondition[]) => {
      if (!selectedStream?.value) {
        return;
      }
      const metricName = query.monitorMetric || '';
      const metricType = query.monitorMetricType || '';
      const sql = buildMetricsAlertSql(selectedStream.value, metricName, metricType, 'AVG', newFilters, fieldTypeMap);
      onChange({ ...query, filters: newFilters, queryText: sql });
    },
    [query, onChange, selectedStream, fieldTypeMap]
  );

  // Auto-select first metric when metrics list loads and none is selected
  useEffect(() => {
    if (isAlerting && isMetricsStream && metricsList.length > 0 && !query.monitorMetric && selectedStream?.value) {
      const first = metricsList[0];
      const sql = buildMetricsAlertSql(
        selectedStream.value,
        first.metric_name,
        first.metric_type,
        'AVG',
        filters,
        fieldTypeMap
      );
      onChange({ ...query, monitorMetric: first.metric_name, monitorMetricType: first.metric_type, queryText: sql });
    }
  }, [isAlerting, isMetricsStream, metricsList, selectedStream?.value]);

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

  // Handle SQL text change (code mode)
  const onQueryTextChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...query, queryText: event.target.value });
    },
    [query, onChange]
  );

  // Debounced query execution — only run if there's a valid query
  useEffect(() => {
    if (!query.queryText || !query.queryText.trim()) {
      return;
    }
    const timer = setTimeout(() => {
      onRunQuery();
    }, 2000);
    return () => clearTimeout(timer);
  }, [onRunQuery, query.queryText]);

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
      {/* Stream Info Sidebar */}
      {!isAlerting && selectedStream?.value && (
        <StreamInfoPanel fieldNames={fieldNames} fieldTypeMap={fieldTypeMap} stats={stats} />
      )}

      {/* Main Query Area */}
      <div className={styles.mainArea}>
        {/* Top bar: Stream select + Mode toggle */}
        <div className={styles.topBar}>
          <InlineField label="Stream" labelWidth={8}>
            <AsyncSelect
              loadOptions={loadAsyncOptions}
              defaultOptions
              value={selectedStream}
              onChange={onStreamChange}
              placeholder="Select a stream"
              width={30}
            />
          </InlineField>

          {!isAlerting && (
            <div className={styles.modeToggle}>
              <RadioButtonGroup options={MODE_OPTIONS} value={editorMode} onChange={onModeChange} size="sm" />
            </div>
          )}
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

        {/* Monitor Mode — Metrics streams */}
        {editorMode === 'monitor' && selectedStream?.value && isMetricsStream && (
          <div className={styles.builderArea}>
            {/* Metric + Aggregate row */}
            <div className={styles.monitorRow}>
              <InlineField label="Metric" labelWidth={8}>
                <Select
                  options={metricsOptions}
                  value={metricsOptions.find((o) => o.value === query.monitorMetric) || metricsOptions[0]}
                  onChange={onMetricChange}
                  width={40}
                  menuPlacement="bottom"
                  isLoading={metricsList.length === 0}
                  placeholder="Select a metric"
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
                onChange={onMetricsFiltersChange}
              />
            </div>

            {/* SQL Preview */}
            <div className={styles.sqlPreviewSection}>
              <div className={styles.sectionLabel}>Generated SQL</div>
              <pre className={styles.sqlPreviewText}>{query.queryText || ''}</pre>
            </div>
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

        {/* Code Mode */}
        {editorMode === 'code' && (
          <div className={styles.codeArea}>
            <div className={styles.sectionLabel}>SQL Query</div>
            <textarea
              className={styles.sqlTextarea}
              value={query.queryText || ''}
              onChange={onQueryTextChange}
              rows={4}
              placeholder={
                selectedStream?.value
                  ? `SELECT * FROM ${selectedStream.value}`
                  : 'Select a stream first, then write your SQL query'
              }
              spellCheck={false}
            />
          </div>
        )}

        {/* Prompt to select stream */}
        {!selectedStream?.value && (
          <div className={styles.placeholder}>Select a stream to start building your query</div>
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
  codeArea: css({}),
  sqlTextarea: css({
    width: '100%',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.text.primary,
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
    resize: 'vertical' as const,
    outline: 'none',
    '&:focus': {
      borderColor: theme.colors.primary.border,
      boxShadow: `0 0 0 1px ${theme.colors.primary.border}`,
    },
    '&::placeholder': {
      color: theme.colors.text.disabled,
    },
  }),
  placeholder: css({
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    padding: theme.spacing(2),
  }),
});
