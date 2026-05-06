import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SelectableValue } from '@grafana/data';
import { AsyncSelect, InlineField, Input, Select } from '@grafana/ui';

import { DataSource } from '../datasource';
import { PromVariableQuery, PromVariableQueryType } from '../types';

interface Props {
  query: PromVariableQuery | string;
  onChange: (query: PromVariableQuery, definition: string) => void;
  datasource: DataSource;
}

const QUERY_TYPE_OPTIONS: Array<SelectableValue<PromVariableQueryType>> = [
  { label: 'Label names', value: 'label_names', description: 'All label keys in the dataset' },
  { label: 'Label values', value: 'label_values', description: 'Distinct values of a label (optionally scoped to a metric)' },
  { label: 'Metrics', value: 'metrics', description: 'Metric names, optionally filtered by regex' },
  { label: 'Query result', value: 'query_result', description: 'Run PromQL; each returned series becomes an option' },
];

function toTyped(q: PromVariableQuery | string | undefined): PromVariableQuery {
  if (q && typeof q === 'object' && 'qryType' in q) {
    return q;
  }
  return { qryType: 'metrics', stream: '' };
}

function buildDefinition(q: PromVariableQuery): string {
  switch (q.qryType) {
    case 'label_names':
      return 'label_names()';
    case 'label_values':
      return q.metric
        ? `label_values(${q.metric}, ${q.label || ''})`
        : `label_values(${q.label || ''})`;
    case 'metrics':
      return `metrics(${q.regex || '.*'})`;
    case 'query_result':
      return `query_result(${q.expr || ''})`;
    default:
      return '';
  }
}

export const VariableQueryEditor = ({ query, onChange, datasource }: Props) => {
  const [state, setState] = useState<PromVariableQuery>(() => toTyped(query));
  const [labelOptions, setLabelOptions] = useState<Array<SelectableValue<string>>>([]);
  const [metricOptions, setMetricOptions] = useState<Array<SelectableValue<string>>>([]);

  // Load label names + metric names when stream changes, to power pickers.
  useEffect(() => {
    const stream = state.stream;
    if (!stream) {
      setLabelOptions([]);
      setMetricOptions([]);
      return;
    }
    datasource
      .getPromLabels(stream)
      .then((labels) =>
        setLabelOptions(
          labels
            .filter((l) => l !== '__name__')
            .sort()
            .map((l) => ({ label: l, value: l }))
        )
      )
      .catch(() => setLabelOptions([]));
    datasource
      .getPromMetricNames(stream)
      .then((names) =>
        setMetricOptions([
          { label: '(no metric — stream-wide)', value: '' },
          ...names.sort().map((n) => ({ label: n, value: n })),
        ])
      )
      .catch(() => setMetricOptions([]));
  }, [state.stream, datasource]);

  const loadStreamOptions = useCallback(() => {
    return datasource
      .listDatasets()
      .then((result) =>
        result
          .filter((d) => d.datasetType === 'metrics')
          .map((d) => ({ label: d.title, value: d.title }))
      )
      .catch(() => []);
  }, [datasource]);

  const selectedStream = useMemo(
    () => (state.stream ? { label: state.stream, value: state.stream } : null),
    [state.stream]
  );

  const update = useCallback(
    (patch: Partial<PromVariableQuery>) => {
      const next = { ...state, ...patch };
      setState(next);
      onChange(next, buildDefinition(next));
    },
    [state, onChange]
  );

  return (
    <>
      <InlineField label="Query type" labelWidth={20} tooltip="Matches Grafana's native Prometheus variable query types">
        <Select
          width={30}
          options={QUERY_TYPE_OPTIONS}
          value={QUERY_TYPE_OPTIONS.find((o) => o.value === state.qryType) || QUERY_TYPE_OPTIONS[2]}
          onChange={(v) => update({ qryType: (v.value || 'metrics') as PromVariableQueryType })}
        />
      </InlineField>

      <InlineField label="Dataset" labelWidth={20} tooltip="Parseable metrics stream">
        <AsyncSelect
          width={30}
          defaultOptions
          loadOptions={loadStreamOptions}
          value={selectedStream}
          onChange={(v) => update({ stream: v?.value || '' })}
          placeholder="Select a dataset"
        />
      </InlineField>

      {state.qryType === 'label_values' && (
        <>
          <InlineField label="Label" labelWidth={20} tooltip="Label whose values to list">
            <Select
              width={30}
              options={labelOptions}
              value={state.label ? { label: state.label, value: state.label } : null}
              onChange={(v) => update({ label: v?.value || '' })}
              placeholder="Select a label"
              allowCustomValue
              onCreateOption={(v) => update({ label: v })}
            />
          </InlineField>
          <InlineField
            label="Metric (optional)"
            labelWidth={20}
            tooltip="When set, values are scoped to series of this metric via /series"
          >
            <Select
              width={30}
              options={metricOptions}
              value={state.metric ? { label: state.metric, value: state.metric } : { label: '(no metric — stream-wide)', value: '' }}
              onChange={(v) => update({ metric: v?.value || '' })}
              placeholder="All metrics"
              allowCustomValue
              onCreateOption={(v) => update({ metric: v })}
              isClearable
            />
          </InlineField>
        </>
      )}

      {state.qryType === 'metrics' && (
        <InlineField label="Regex" labelWidth={20} tooltip="Regular expression to filter metric names (client-side). Leave blank to list all.">
          <Input
            width={30}
            value={state.regex || ''}
            placeholder=".*"
            onChange={(e) => update({ regex: e.currentTarget.value })}
          />
        </InlineField>
      )}

      {state.qryType === 'query_result' && (
        <InlineField label="PromQL" labelWidth={20} tooltip="Instant PromQL expression. Each returned series becomes a variable option.">
          <Input
            width={60}
            value={state.expr || ''}
            placeholder="sum(up) by (job)"
            onChange={(e) => update({ expr: e.currentTarget.value })}
          />
        </InlineField>
      )}
    </>
  );
};
