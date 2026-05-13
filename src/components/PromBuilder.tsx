import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue, TimeRange } from '@grafana/data';
import { Button, Icon, RadioButtonGroup, Select, useStyles2 } from '@grafana/ui';
import { DataSource } from '../datasource';
import { PromLabelMatcher } from '../types';

interface PromBuilderProps {
  datasource: DataSource;
  streamName: string;
  metricNames: string[];
  labels: string[];
  metric?: string;
  matchers: PromLabelMatcher[];
  range?: boolean;
  instant?: boolean;
  timeRange?: TimeRange;
  onChange: (next: {
    metric?: string;
    matchers: PromLabelMatcher[];
    range?: boolean;
    instant?: boolean;
    queryText: string;
  }) => void;
}

const OPERATORS: Array<SelectableValue<PromLabelMatcher['operator']>> = [
  { label: '=', value: '=' },
  { label: '!=', value: '!=' },
  { label: '=~', value: '=~' },
  { label: '!~', value: '!~' },
];

const TYPE_OPTIONS = [
  { label: 'Range', value: 'range' as const },
  { label: 'Instant', value: 'instant' as const },
  { label: 'Both', value: 'both' as const },
];

const LEGAL_METRIC_IDENT = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LEGAL_LABEL_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// PromQL 3.0 UTF-8 selector syntax:
//   - Classic metric/label idents → `metric{label="value"}`
//   - Names with chars outside the ident grammar (dots, slashes, etc.) →
//     `{"metric.name", "label.name"="value"}` (quoted form, metric becomes
//     an implicit __name__ matcher inside the braces).
function buildPromQL(metric: string | undefined, matchers: PromLabelMatcher[]): string {
  const active = matchers.filter((m) => m.label && m.value !== undefined);
  if (!metric && active.length === 0) {
    return '';
  }
  // Quoting rules from the PromQL grammar:
  //   \\ → backslash, \" → quote, \n → LF, \r → CR, \t → tab.
  // Escape backslash first so subsequent sequences aren't double-escaped.
  const quote = (s: string) =>
    `"${s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')}"`;
  const metricLegal = !metric || LEGAL_METRIC_IDENT.test(metric);
  const labelsLegal = active.every((m) => LEGAL_LABEL_IDENT.test(m.label));

  if (metricLegal && labelsLegal) {
    if (active.length === 0) {
      return metric || '';
    }
    const inner = active.map((m) => `${m.label}${m.operator}${quote(m.value)}`).join(', ');
    return `${metric || ''}{${inner}}`;
  }

  // UTF-8 form — quote everything that's not a legal identifier.
  const parts: string[] = [];
  if (metric) {
    parts.push(quote(metric));
  }
  active.forEach((m) => {
    const lhs = LEGAL_LABEL_IDENT.test(m.label) ? m.label : quote(m.label);
    parts.push(`${lhs}${m.operator}${quote(m.value)}`);
  });
  return `{${parts.join(', ')}}`;
}

export const PromBuilder: React.FC<PromBuilderProps> = ({
  datasource,
  streamName,
  metricNames,
  labels,
  metric,
  matchers,
  range,
  instant,
  timeRange,
  onChange,
}) => {
  const styles = useStyles2(getStyles);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Per-label cached value lists. Keyed by label name; value is the array
  // returned by /label/<name>/values scoped to the current metric.
  const [valueCache, setValueCache] = useState<Record<string, string[]>>({});

  const metricOptions = useMemo<Array<SelectableValue<string>>>(
    () => metricNames.map((n) => ({ label: n, value: n })),
    [metricNames]
  );
  const labelOptions = useMemo<Array<SelectableValue<string>>>(
    () => labels.filter((l) => l !== '__name__').map((l) => ({ label: l, value: l })),
    [labels]
  );

  const typeValue = instant && range ? 'both' : instant ? 'instant' : 'range';

  const emit = useCallback(
    (nextMetric?: string, nextMatchers?: PromLabelMatcher[], nextRange?: boolean, nextInstant?: boolean) => {
      const m = nextMetric !== undefined ? nextMetric : metric;
      const list = nextMatchers ?? matchers;
      const r = nextRange !== undefined ? nextRange : range;
      const i = nextInstant !== undefined ? nextInstant : instant;
      onChange({
        metric: m,
        matchers: list,
        range: r,
        instant: i,
        queryText: buildPromQL(m, list),
      });
    },
    [metric, matchers, range, instant, onChange]
  );

  // Load values for a label whenever a row picks one (and scope to the
  // currently selected metric so the dropdown shows only relevant values).
  const loadLabelValues = useCallback(
    async (label: string) => {
      if (!streamName || !label || valueCache[label]) {
        return;
      }
      const match = metric ? [metric] : undefined;
      const opts: { match?: string[]; start?: number; end?: number; limit?: number } = {
        match,
        limit: 1000,
      };
      if (timeRange) {
        opts.start = Math.floor(timeRange.from.valueOf() / 1000);
        opts.end = Math.floor(timeRange.to.valueOf() / 1000);
      }
      const values = await datasource.getPromLabelValues(streamName, label, opts);
      setValueCache((prev) => ({ ...prev, [label]: values }));
    },
    [datasource, streamName, metric, timeRange, valueCache]
  );

  // Reset cached values when metric or time range changes — both scope the
  // /label/{name}/values response, so stale entries would mislead dropdowns.
  useEffect(() => {
    setValueCache({});
  }, [metric, timeRange?.from?.valueOf(), timeRange?.to?.valueOf()]);

  const onMetricChange = (v: SelectableValue<string>) => {
    emit(v?.value ?? undefined, matchers, range, instant);
  };

  const onMatcherChange = (idx: number, patch: Partial<PromLabelMatcher>) => {
    // Touching the always-rendered placeholder row materializes it into the
    // real matchers list.
    if (idx >= matchers.length) {
      const seeded: PromLabelMatcher = { label: '', operator: '=', value: '', ...patch };
      emit(metric, [...matchers, seeded], range, instant);
      return;
    }
    const next = matchers.map((m, i) => (i === idx ? { ...m, ...patch } : m));
    emit(metric, next, range, instant);
  };

  const onAddMatcher = () => {
    const next = [...matchers, { label: '', operator: '=' as const, value: '' }];
    emit(metric, next, range, instant);
  };

  const onRemoveMatcher = (idx: number) => {
    // Placeholder row (idx beyond real list) — clearing it just resets it
    // visually; nothing to remove from state.
    if (idx >= matchers.length) {
      return;
    }
    emit(metric, matchers.filter((_, i) => i !== idx), range, instant);
  };

  // Always render at least one matcher row so the user can pick a label/value
  // without first clicking "+". Mirrors the Prometheus plugin's behavior.
  const displayMatchers: PromLabelMatcher[] =
    matchers.length > 0 ? matchers : [{ label: '', operator: '=', value: '' }];

  const onTypeChange = (mode: 'range' | 'instant' | 'both') => {
    const r = mode === 'range' || mode === 'both';
    const i = mode === 'instant' || mode === 'both';
    emit(metric, matchers, r, i);
  };

  const livePromQL = useMemo(() => buildPromQL(metric, matchers), [metric, matchers]);

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <div className={styles.metricCell}>
          <div className={styles.cellLabel}>Metric</div>
          <Select
            options={metricOptions}
            value={metric ? { label: metric, value: metric } : null}
            onChange={onMetricChange}
            placeholder="Select metric"
            isClearable
            width={32}
            menuPlacement="bottom"
          />
        </div>

        <div className={styles.filtersCell}>
          <div className={styles.cellLabel}>Label filters</div>
          <div className={styles.matchersRow}>
            {displayMatchers.map((m, idx) => (
              <div key={idx} className={styles.matcherGroup}>
                <Select
                  options={labelOptions}
                  value={m.label ? { label: m.label, value: m.label } : null}
                  onChange={(v) => {
                    const label = v?.value ?? '';
                    onMatcherChange(idx, { label, value: '' });
                    if (label) {
                      loadLabelValues(label);
                    }
                  }}
                  placeholder="Select label"
                  width={18}
                  menuPlacement="bottom"
                />
                <Select
                  options={OPERATORS}
                  value={OPERATORS.find((o) => o.value === m.operator) ?? OPERATORS[0]}
                  onChange={(v) => onMatcherChange(idx, { operator: v?.value ?? '=' })}
                  width={8}
                  menuPlacement="bottom"
                />
                <Select
                  options={(valueCache[m.label] || []).map((v) => ({ label: v, value: v }))}
                  value={m.value ? { label: m.value, value: m.value } : null}
                  onChange={(v) => onMatcherChange(idx, { value: v?.value ?? '' })}
                  onOpenMenu={() => loadLabelValues(m.label)}
                  placeholder="Select value"
                  allowCustomValue
                  onCreateOption={(v) => onMatcherChange(idx, { value: v })}
                  width={20}
                  menuPlacement="bottom"
                />
                <Button
                  variant="secondary"
                  fill="text"
                  size="sm"
                  onClick={() => onRemoveMatcher(idx)}
                  icon="times"
                  aria-label="Remove filter"
                />
              </div>
            ))}
            <Button variant="secondary" size="sm" icon="plus" onClick={onAddMatcher} aria-label="Add filter" />
          </div>
        </div>
      </div>

      <div className={styles.rawQueryRow}>
        <div className={styles.rawQueryLabel}>Raw query</div>
        <div className={styles.rawQueryBox}>
          {livePromQL || <span className={styles.rawQueryPlaceholder}>Select a metric or label filter to build a query</span>}
        </div>
      </div>

      <div className={styles.optionsRow}>
        <div className={styles.optionsHeader} onClick={() => setOptionsOpen(!optionsOpen)}>
          <Icon name={optionsOpen ? 'angle-down' : 'angle-right'} size="sm" />
          <span>Options</span>
          {!optionsOpen && <span className={styles.optionsSummary}>Type: {typeValue === 'both' ? 'Both' : typeValue === 'instant' ? 'Instant' : 'Range'}</span>}
        </div>
        {optionsOpen && (
          <div className={styles.optionsBody}>
            <div className={styles.optionItem}>
              <span className={styles.optionLabel}>Type</span>
              <RadioButtonGroup options={TYPE_OPTIONS} value={typeValue} onChange={onTypeChange} size="sm" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    width: '100%',
  }),
  row: css({
    display: 'flex',
    gap: theme.spacing(2),
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  }),
  metricCell: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  filtersCell: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    flex: 1,
    minWidth: 0,
  }),
  cellLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  matchersRow: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    alignItems: 'center',
  }),
  matcherGroup: css({
    display: 'flex',
    gap: theme.spacing(0.25),
    alignItems: 'center',
  }),
  emptyHint: css({
    color: theme.colors.text.disabled,
    fontStyle: 'italic',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  rawQueryRow: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(1),
  }),
  rawQueryLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  rawQueryBox: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.75, 1),
    color: theme.colors.text.primary,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    minHeight: theme.spacing(4),
  }),
  rawQueryPlaceholder: css({
    color: theme.colors.text.disabled,
    fontStyle: 'italic',
    fontFamily: theme.typography.fontFamily,
  }),
  optionsRow: css({
    display: 'flex',
    flexDirection: 'column',
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(1),
  }),
  optionsHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    userSelect: 'none',
  }),
  optionsSummary: css({
    marginLeft: theme.spacing(1),
    color: theme.colors.text.primary,
  }),
  optionsBody: css({
    display: 'flex',
    flexDirection: 'row',
    gap: theme.spacing(2),
    marginTop: theme.spacing(1),
    flexWrap: 'wrap',
  }),
  optionItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  optionLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});
