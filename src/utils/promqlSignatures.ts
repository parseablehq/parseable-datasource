/**
 * PromQL function and aggregation signatures, used by Monaco's signature-help
 * provider and the (future) hover provider. Keyed by function name.
 *
 * `params` drives active-parameter highlighting inside a call.
 * Variadic tails are represented by ending `params` with an entry whose
 * label contains `…` — the help provider treats any argIndex past the last
 * param as still on the last one.
 */
export interface PromSignature {
  label: string;
  doc: string;
  params: string[];
}

export const PROM_SIGNATURES: Record<string, PromSignature> = {
  // -- Rate / counter --------------------------------------------------------
  rate: {
    label: 'rate(v range-vector)',
    doc: 'Per-second average rate of increase over the range. Handles counter resets.',
    params: ['v range-vector'],
  },
  irate: {
    label: 'irate(v range-vector)',
    doc: 'Per-second instant rate using only the last two samples.',
    params: ['v range-vector'],
  },
  increase: {
    label: 'increase(v range-vector)',
    doc: 'Total increase over the range. Equivalent to rate() * range duration.',
    params: ['v range-vector'],
  },
  delta: {
    label: 'delta(v range-vector)',
    doc: 'Difference between the first and last values in the range. Use for gauges.',
    params: ['v range-vector'],
  },
  idelta: {
    label: 'idelta(v range-vector)',
    doc: 'Delta based only on the last two samples.',
    params: ['v range-vector'],
  },
  changes: {
    label: 'changes(v range-vector)',
    doc: 'Number of times each series value changed within the range.',
    params: ['v range-vector'],
  },
  resets: {
    label: 'resets(v range-vector)',
    doc: 'Number of counter resets within the range.',
    params: ['v range-vector'],
  },
  deriv: {
    label: 'deriv(v range-vector)',
    doc: 'Per-second derivative via simple linear regression over the range.',
    params: ['v range-vector'],
  },
  predict_linear: {
    label: 'predict_linear(v range-vector, t scalar)',
    doc: 'Predicts value t seconds from now via linear regression of the range vector.',
    params: ['v range-vector', 't scalar'],
  },
  holt_winters: {
    label: 'holt_winters(v range-vector, sf scalar, tf scalar)',
    doc: 'Double-exponential smoothing. sf = smoothing factor, tf = trend factor.',
    params: ['v range-vector', 'sf scalar', 'tf scalar'],
  },
  double_exponential_smoothing: {
    label: 'double_exponential_smoothing(v range-vector, sf scalar, tf scalar)',
    doc: 'Prometheus 3.0 rename of holt_winters. Same semantics.',
    params: ['v range-vector', 'sf scalar', 'tf scalar'],
  },

  // -- Aggregation over time -------------------------------------------------
  avg_over_time: { label: 'avg_over_time(v range-vector)', doc: 'Average value over the range.', params: ['v range-vector'] },
  sum_over_time: { label: 'sum_over_time(v range-vector)', doc: 'Sum of all values over the range.', params: ['v range-vector'] },
  min_over_time: { label: 'min_over_time(v range-vector)', doc: 'Minimum value over the range.', params: ['v range-vector'] },
  max_over_time: { label: 'max_over_time(v range-vector)', doc: 'Maximum value over the range.', params: ['v range-vector'] },
  count_over_time: { label: 'count_over_time(v range-vector)', doc: 'Count of samples within the range.', params: ['v range-vector'] },
  last_over_time: { label: 'last_over_time(v range-vector)', doc: 'Most recent value within the range.', params: ['v range-vector'] },
  stddev_over_time: { label: 'stddev_over_time(v range-vector)', doc: 'Standard deviation over the range.', params: ['v range-vector'] },
  stdvar_over_time: { label: 'stdvar_over_time(v range-vector)', doc: 'Variance over the range.', params: ['v range-vector'] },
  quantile_over_time: {
    label: 'quantile_over_time(φ scalar, v range-vector)',
    doc: 'φ-quantile (0≤φ≤1) over the range.',
    params: ['φ scalar', 'v range-vector'],
  },
  present_over_time: { label: 'present_over_time(v range-vector)', doc: 'Returns 1 for any series with ≥1 sample in the range.', params: ['v range-vector'] },

  // -- Sorting ---------------------------------------------------------------
  sort: { label: 'sort(v instant-vector)', doc: 'Sort by sample value ascending.', params: ['v instant-vector'] },
  sort_desc: { label: 'sort_desc(v instant-vector)', doc: 'Sort by sample value descending.', params: ['v instant-vector'] },
  sort_by_label: {
    label: 'sort_by_label(v instant-vector, label string, …)',
    doc: 'Sort alphabetically by the given label(s).',
    params: ['v instant-vector', 'label string', '…'],
  },
  sort_by_label_desc: {
    label: 'sort_by_label_desc(v instant-vector, label string, …)',
    doc: 'Sort reverse-alphabetically by the given label(s).',
    params: ['v instant-vector', 'label string', '…'],
  },

  // -- Math ------------------------------------------------------------------
  abs: { label: 'abs(v instant-vector)', doc: 'Absolute value.', params: ['v instant-vector'] },
  ceil: { label: 'ceil(v instant-vector)', doc: 'Round up to nearest integer.', params: ['v instant-vector'] },
  floor: { label: 'floor(v instant-vector)', doc: 'Round down to nearest integer.', params: ['v instant-vector'] },
  round: {
    label: 'round(v instant-vector, to_nearest scalar = 1)',
    doc: 'Round to nearest integer (or multiple of to_nearest).',
    params: ['v instant-vector', 'to_nearest scalar'],
  },
  sqrt: { label: 'sqrt(v instant-vector)', doc: 'Square root.', params: ['v instant-vector'] },
  exp: { label: 'exp(v instant-vector)', doc: 'Natural exponential e^x.', params: ['v instant-vector'] },
  ln: { label: 'ln(v instant-vector)', doc: 'Natural logarithm.', params: ['v instant-vector'] },
  log2: { label: 'log2(v instant-vector)', doc: 'Base-2 logarithm.', params: ['v instant-vector'] },
  log10: { label: 'log10(v instant-vector)', doc: 'Base-10 logarithm.', params: ['v instant-vector'] },
  sgn: { label: 'sgn(v instant-vector)', doc: 'Sign function: -1, 0, or 1.', params: ['v instant-vector'] },

  // -- Clamping --------------------------------------------------------------
  clamp: {
    label: 'clamp(v instant-vector, min scalar, max scalar)',
    doc: 'Clamp values to [min, max].',
    params: ['v instant-vector', 'min scalar', 'max scalar'],
  },
  clamp_min: { label: 'clamp_min(v instant-vector, min scalar)', doc: 'Floor all values at min.', params: ['v instant-vector', 'min scalar'] },
  clamp_max: { label: 'clamp_max(v instant-vector, max scalar)', doc: 'Cap all values at max.', params: ['v instant-vector', 'max scalar'] },

  // -- Type conversion -------------------------------------------------------
  scalar: { label: 'scalar(v instant-vector)', doc: 'Convert a 1-element vector to a scalar. NaN otherwise.', params: ['v instant-vector'] },
  vector: { label: 'vector(s scalar)', doc: 'Convert a scalar to a 1-element vector with no labels.', params: ['s scalar'] },

  // -- Time ------------------------------------------------------------------
  time: { label: 'time()', doc: 'Current evaluation timestamp (unix seconds) at each step.', params: [] },
  timestamp: { label: 'timestamp(v instant-vector)', doc: 'Return each sample’s timestamp as its value.', params: ['v instant-vector'] },
  hour: { label: 'hour(v instant-vector = vector(time()))', doc: 'Hour (0–23).', params: ['v instant-vector'] },
  minute: { label: 'minute(v instant-vector = vector(time()))', doc: 'Minute (0–59).', params: ['v instant-vector'] },
  month: { label: 'month(v instant-vector = vector(time()))', doc: 'Month (1–12).', params: ['v instant-vector'] },
  year: { label: 'year(v instant-vector = vector(time()))', doc: 'Year.', params: ['v instant-vector'] },
  day_of_month: { label: 'day_of_month(v instant-vector = vector(time()))', doc: 'Day of month (1–31).', params: ['v instant-vector'] },
  day_of_week: { label: 'day_of_week(v instant-vector = vector(time()))', doc: 'Day of week (0 = Sunday).', params: ['v instant-vector'] },
  day_of_year: { label: 'day_of_year(v instant-vector = vector(time()))', doc: 'Day of year (1–365/366).', params: ['v instant-vector'] },
  days_in_month: { label: 'days_in_month(v instant-vector = vector(time()))', doc: 'Days in the month (28–31).', params: ['v instant-vector'] },

  // -- Label manipulation ----------------------------------------------------
  label_replace: {
    label: 'label_replace(v instant-vector, dst_label string, replacement string, src_label string, regex string)',
    doc: 'Replace/create dst_label using regex match+substitution on src_label.',
    params: ['v instant-vector', 'dst_label string', 'replacement string', 'src_label string', 'regex string'],
  },
  label_join: {
    label: 'label_join(v instant-vector, dst_label string, separator string, src_label_1, …)',
    doc: 'Join multiple label values into a new label using a separator.',
    params: ['v instant-vector', 'dst_label string', 'separator string', 'src_label_1', '…'],
  },

  // -- Histogram -------------------------------------------------------------
  histogram_quantile: {
    label: 'histogram_quantile(φ scalar, v instant-vector)',
    doc: 'φ-quantile (0≤φ≤1) from a conventional histogram (le buckets).',
    params: ['φ scalar', 'v instant-vector'],
  },
  histogram_avg: { label: 'histogram_avg(v instant-vector)', doc: 'Average from native-histogram data.', params: ['v instant-vector'] },
  histogram_count: { label: 'histogram_count(v instant-vector)', doc: 'Count from histogram data.', params: ['v instant-vector'] },
  histogram_sum: { label: 'histogram_sum(v instant-vector)', doc: 'Sum from histogram data.', params: ['v instant-vector'] },
  histogram_fraction: {
    label: 'histogram_fraction(lower scalar, upper scalar, v instant-vector)',
    doc: 'Estimated fraction of observations between lower and upper.',
    params: ['lower scalar', 'upper scalar', 'v instant-vector'],
  },
  histogram_stddev: { label: 'histogram_stddev(v instant-vector)', doc: 'Standard deviation of a native histogram.', params: ['v instant-vector'] },
  histogram_stdvar: { label: 'histogram_stdvar(v instant-vector)', doc: 'Variance of a native histogram.', params: ['v instant-vector'] },

  // -- Absence --------------------------------------------------------------
  absent: { label: 'absent(v instant-vector)', doc: 'Returns 1 if v is empty, nothing otherwise. Useful for alerting on missing metrics.', params: ['v instant-vector'] },
  absent_over_time: { label: 'absent_over_time(v range-vector)', doc: 'Returns 1 if v has no samples in the range.', params: ['v range-vector'] },

  // -- Info ------------------------------------------------------------------
  info: {
    label: 'info(v instant-vector, data-label-selector instant-vector)',
    doc: 'Prometheus 3.0 helper that joins info-metric labels onto v.',
    params: ['v instant-vector', 'data-label-selector instant-vector'],
  },

  // -- Aggregation operators -------------------------------------------------
  sum: { label: 'sum(v instant-vector)', doc: 'Sum of values across series. Use `by(…)`/`without(…)` for grouping.', params: ['v instant-vector'] },
  avg: { label: 'avg(v instant-vector)', doc: 'Arithmetic mean across series.', params: ['v instant-vector'] },
  min: { label: 'min(v instant-vector)', doc: 'Minimum across series.', params: ['v instant-vector'] },
  max: { label: 'max(v instant-vector)', doc: 'Maximum across series.', params: ['v instant-vector'] },
  count: { label: 'count(v instant-vector)', doc: 'Number of series.', params: ['v instant-vector'] },
  stddev: { label: 'stddev(v instant-vector)', doc: 'Population standard deviation.', params: ['v instant-vector'] },
  stdvar: { label: 'stdvar(v instant-vector)', doc: 'Population variance.', params: ['v instant-vector'] },
  topk: { label: 'topk(k scalar, v instant-vector)', doc: 'Top K series by value.', params: ['k scalar', 'v instant-vector'] },
  bottomk: { label: 'bottomk(k scalar, v instant-vector)', doc: 'Bottom K series by value.', params: ['k scalar', 'v instant-vector'] },
  quantile: { label: 'quantile(φ scalar, v instant-vector)', doc: 'φ-quantile (0≤φ≤1) across series.', params: ['φ scalar', 'v instant-vector'] },
  count_values: {
    label: 'count_values("label" string, v instant-vector)',
    doc: 'Count series with each distinct value, labeled by value.',
    params: ['"label" string', 'v instant-vector'],
  },
  group: { label: 'group(v instant-vector)', doc: 'Return 1 for each distinct label combination (set union).', params: ['v instant-vector'] },
};

/**
 * Walk the prefix and return the innermost named function call that
 * encloses the cursor, plus the 0-based argument index. Balances
 * parentheses / brackets / braces and skips string literals so commas
 * inside those don't bump the arg count.
 */
export function findEnclosingFunctionCall(prefix: string): { name: string; argIndex: number } | null {
  const stack: Array<{ type: '(' | '[' | '{'; name?: string; argIndex: number }> = [];
  let i = 0;
  while (i < prefix.length) {
    const c = prefix[i];
    if (c === '"') {
      i++;
      while (i < prefix.length && prefix[i] !== '"') {
        if (prefix[i] === '\\' && i + 1 < prefix.length) {
          i += 2;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '(') {
      const before = prefix.substring(0, i);
      const m = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*$/);
      stack.push({ type: '(', name: m ? m[1] : undefined, argIndex: 0 });
    } else if (c === '[') {
      stack.push({ type: '[', argIndex: 0 });
    } else if (c === '{') {
      stack.push({ type: '{', argIndex: 0 });
    } else if (c === ')' && stack.length && stack[stack.length - 1].type === '(') {
      stack.pop();
    } else if (c === ']' && stack.length && stack[stack.length - 1].type === '[') {
      stack.pop();
    } else if (c === '}' && stack.length && stack[stack.length - 1].type === '{') {
      stack.pop();
    } else if (c === ',' && stack.length && stack[stack.length - 1].type === '(') {
      stack[stack.length - 1].argIndex++;
    }
    i++;
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    if (stack[k].type === '(' && stack[k].name) {
      return { name: stack[k].name!, argIndex: stack[k].argIndex };
    }
  }
  return null;
}
