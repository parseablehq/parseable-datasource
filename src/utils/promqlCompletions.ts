import type { Monaco } from '@grafana/ui';
import type * as monacoType from 'monaco-editor';

import { DataSource } from '../datasource';
import { PROM_SIGNATURES, findEnclosingFunctionCall } from './promqlSignatures';
import { findAncestorByName, metricNameFromVectorSelector, nodeText, parsePromQL } from './promqlParser';

/**
 * Context shared with the Monaco PromQL completion provider.
 * Updated from QueryEditor whenever relevant state changes; the provider
 * reads the latest value at completion time.
 */
export interface PromqlCompletionContext {
  streamName: string;
  metricNames: string[];
  metricMetadata: Record<string, { type?: string; help?: string }>;
  labels: string[];
  datasource: DataSource;
  /** Recent PromQL queries (most recent first) for history suggestions. */
  history?: string[];
}

let currentContext: PromqlCompletionContext | null = null;

// Caches live for the duration of the Monaco lifetime; cleared on stream change.
const seriesLabelsCache = new Map<string, string[]>(); // key: stream|metric
const labelValuesCache = new Map<string, string[]>(); // key: stream|metric|label

export function setPromqlCompletionContext(ctx: PromqlCompletionContext | null) {
  currentContext = ctx;
}

export function clearPromqlCompletionCaches() {
  seriesLabelsCache.clear();
  labelValuesCache.clear();
}

/**
 * Number of cached distinct values for a (stream, metric, label) tuple,
 * or undefined if we haven't fetched values for this combination yet.
 * Used by the hover provider to show `values: N` on a label.
 */
export function getCachedLabelValueCount(
  streamName: string,
  label: string,
  metric?: string
): number | undefined {
  const key = `${streamName}|${metric || ''}|${label}`;
  const v = labelValuesCache.get(key);
  return v === undefined ? undefined : v.length;
}

export function getPromqlCompletionContext(): PromqlCompletionContext | null {
  return currentContext;
}

const AGGREGATIONS = [
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
];

const FUNCTIONS = [
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
  'double_exponential_smoothing',
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
  'hour',
  'minute',
  'month',
  'year',
  'day_of_month',
  'day_of_week',
  'day_of_year',
  'days_in_month',
  'label_replace',
  'label_join',
  'histogram_avg',
  'histogram_count',
  'histogram_sum',
  'histogram_fraction',
  'histogram_stddev',
  'histogram_stdvar',
  'histogram_quantile',
  'absent',
  'absent_over_time',
  'info',
];

const KEYWORDS = [
  'and',
  'or',
  'unless',
  'by',
  'without',
  'on',
  'ignoring',
  'group_left',
  'group_right',
  'bool',
  'offset',
  'start',
  'end',
];

// Grafana duration macros plus common fixed windows. Same set the native
// Prometheus datasource surfaces inside `[]` / subquery step contexts.
const RANGE_SUGGESTIONS = [
  '$__interval',
  '$__rate_interval',
  '$__range',
  '1m',
  '5m',
  '10m',
  '15m',
  '30m',
  '1h',
  '6h',
  '24h',
];

// Matches PromQL's legacy identifier rule: letters/underscore/colon, then
// letters/digits/underscore/colon. Anything else (dots, dashes, slashes) is
// UTF-8 and must be emitted inside quotes per Prometheus 3.0.
const LEGACY_IDENT = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function isLegacyIdent(s: string): boolean {
  return LEGACY_IDENT.test(s);
}

/**
 * Escape a label value for insertion inside a double-quoted string.
 * Mirrors the native plugin's `escapeLabelValueInExactSelector`:
 *   \ -> \\, " -> \", newline -> \n
 */
function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

type ParsedContext =
  | { type: 'expression' }
  | { type: 'labelName'; metric?: string; betweenQuotes?: boolean }
  | { type: 'labelValue'; metric?: string; label: string }
  | { type: 'range' }
  | { type: 'grouping' }
  | { type: 'modifierAt' }
  | { type: 'modifierOffset' };

/**
 * Entry point: prefer the Lezer parse tree; fall back to the regex-based
 * detector when the tree can't resolve a useful context (partial input,
 * parse failure, or a node type we don't map). Regex is kept as a second
 * line of defense so Phase A's already-verified cases keep working even if
 * the grammar-based path has an edge case we haven't mapped yet.
 */
export function detectPromqlContext(prefix: string): ParsedContext {
  try {
    const tree = detectPromqlContextFromTree(prefix);
    if (tree) {
      return tree;
    }
  } catch {
    /* fall through to regex */
  }
  return detectPromqlContextRegex(prefix);
}

/**
 * Tree-based detector. Parses the prefix with the canonical PromQL grammar
 * and maps the cursor position to one of our ParsedContext variants. Returns
 * null when the tree doesn't point to a specific context — caller falls back.
 */
function detectPromqlContextFromTree(prefix: string): ParsedContext | null {
  if (!prefix) {
    return { type: 'expression' };
  }
  const tree = parsePromQL(prefix);
  // Resolve the innermost node just before the cursor. `side = -1` prefers
  // the left-hand token when the cursor sits exactly on a boundary.
  const leaf = tree.resolveInner(prefix.length, -1);
  if (!leaf) {
    return null;
  }

  // Walk ancestors to determine the structural context.
  const rangeAncestor = findAncestorByName(leaf, ['MatrixSelector', 'SubqueryExpr']);
  const groupingAncestor = findAncestorByName(leaf, ['GroupingLabels']);
  const labelsAncestor = findAncestorByName(leaf, ['LabelMatchers']);
  const atAncestor = findAncestorByName(leaf, ['StepInvariantExpr', 'AtModifierPreprocessors']);
  const offsetAncestor = findAncestorByName(leaf, ['OffsetExpr']);

  // Inside `[…]` or subquery `[…:…]`
  if (rangeAncestor) {
    return { type: 'range' };
  }

  // Inside `by (…)` / `without (…)` / `on (…)` / `ignoring (…)` label list
  if (groupingAncestor) {
    return { type: 'grouping' };
  }

  // @-modifier — cursor after `@` and before/into start/end/timestamp
  if (atAncestor) {
    // If the cursor sits on or after the `@` token but hasn't committed a full
    // `start()`/`end()` yet, suggest those.
    const at = atAncestor.getChild('At');
    if (at) {
      return { type: 'modifierAt' };
    }
    // Anchored expressions have `AtModifierPreprocessors` which wraps start/end.
    return { type: 'modifierAt' };
  }

  // Offset modifier: `selector offset <duration>`
  if (offsetAncestor) {
    return { type: 'modifierOffset' };
  }

  // Inside a label matcher block `{…}`
  if (labelsAncestor) {
    // Metric of the enclosing selector (for scoping)
    const selector = findAncestorByName(labelsAncestor, ['VectorSelector']);
    const metric = selector ? metricNameFromVectorSelector(prefix, selector) : undefined;

    // Are we inside a value slot (after =, !=, =~, !~)?
    const matcher = findAncestorByName(leaf, ['UnquotedLabelMatcher', 'QuotedLabelMatcher']);
    if (matcher) {
      // A completed matcher has children: name, op, value (StringLiteral).
      // If the leaf is inside the StringLiteral (or the matcher's only child
      // so far includes a MatchOp), we're in value context.
      const stringLit = matcher.getChild('StringLiteral');
      const matchOp = matcher.getChild('MatchOp');
      if (stringLit && leaf.from >= stringLit.from) {
        // Pull label name — different child type depending on quoted form.
        const nameNode = matcher.getChild('LabelName') || matcher.getChild('QuotedLabelName');
        let label = nameNode ? nodeText(prefix, nameNode).replace(/^"|"$/g, '') : '';
        return { type: 'labelValue', metric, label };
      }
      if (matchOp && !stringLit) {
        const nameNode = matcher.getChild('LabelName') || matcher.getChild('QuotedLabelName');
        const label = nameNode ? nodeText(prefix, nameNode).replace(/^"|"$/g, '') : '';
        if (label) {
          return { type: 'labelValue', metric, label };
        }
      }
    }

    // Inside a quoted label name still being typed (UTF-8 form):
    // `{"m", "fo|"}` — leaf is a StringLiteral nested in QuotedLabelName
    // under a QuotedLabelMatcher whose MatchOp hasn't been parsed yet.
    const quotedName = findAncestorByName(leaf, ['QuotedLabelName']);
    if (quotedName) {
      // Determine whether this is the first quoted item (metric name) or a
      // subsequent one (label name).
      const prevSibling = quotedName.parent?.prevSibling;
      if (prevSibling && prevSibling.type.name !== 'OpenBrace') {
        return { type: 'labelName', metric, betweenQuotes: true };
      }
      // First quoted item — user is still typing the metric name.
      return { type: 'expression' };
    }

    // Default inside `{}`: suggest label names.
    return { type: 'labelName', metric };
  }

  // Top-level / function arg position / anywhere else → expression.
  return { type: 'expression' };
}

/**
 * Regex-based detector retained as a fallback for situations where the
 * tree-based detector returns null or throws. Balances `{}` / `[]` manually
 * and handles both traditional and UTF-8 PromQL forms.
 */
function detectPromqlContextRegex(prefix: string): ParsedContext {
  // Range matcher `[…]` — innermost unmatched `[`
  let brDepth = 0;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === ']') {
      brDepth++;
    } else if (c === '[') {
      if (brDepth === 0) {
        return { type: 'range' };
      }
      brDepth--;
    }
  }

  // Label matcher `{…}` — innermost unmatched `{`
  let braceDepth = 0;
  let lastOpenBrace = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === '}') {
      braceDepth++;
    } else if (c === '{') {
      if (braceDepth === 0) {
        lastOpenBrace = i;
        break;
      }
      braceDepth--;
    }
  }

  if (lastOpenBrace >= 0) {
    const beforeBrace = prefix.substring(0, lastOpenBrace);
    const inside = prefix.substring(lastOpenBrace + 1);

    // Determine the metric name governing this matcher.
    //   UTF-8 form: `{"metric.name", …}` — first quoted string is the metric.
    //   Traditional: `metric{…}` — identifier immediately before `{`.
    let metric: string | undefined;
    let labelRegion = inside;

    const utf8MetricMatch = inside.match(/^\s*"([^"]*)"\s*(,)?/);
    if (utf8MetricMatch) {
      const quotedClosed = /^\s*"[^"]*"/.test(inside);
      if (!quotedClosed) {
        // Still typing the quoted metric name itself — treat as expression
        // context so metric-name suggestions continue to appear.
        return { type: 'expression' };
      }
      const commaIdx = inside.indexOf(',', utf8MetricMatch[0].length - 1);
      if (commaIdx < 0) {
        // Metric name closed but no comma yet; cursor is between the
        // quoted metric and a possible following selector — nothing
        // specific to suggest.
        return { type: 'expression' };
      }
      metric = utf8MetricMatch[1];
      labelRegion = inside.substring(commaIdx + 1);
    } else {
      const metricMatch = beforeBrace.match(/([a-zA-Z_:][a-zA-Z0-9_:.]*)\s*$/);
      metric = metricMatch ? metricMatch[1] : undefined;
    }

    // Segment = the current in-progress matcher (after the last comma).
    const lastComma = labelRegion.lastIndexOf(',');
    const segment = lastComma >= 0 ? labelRegion.substring(lastComma + 1) : labelRegion;

    // UTF-8 label value: `"foo.bar" = "val…`
    const utf8OpMatch = segment.match(/"([^"\\]*)"\s*(=~|!~|!=|=)\s*"?[^"]*$/);
    if (utf8OpMatch) {
      return { type: 'labelValue', metric, label: utf8OpMatch[1] };
    }

    // UTF-8 label name still being typed inside a `"…` that has no closing
    // quote yet, e.g. `{"m", "fo|`.
    const utf8OpenName = segment.match(/^\s*"([^"]*)$/);
    if (utf8OpenName) {
      return { type: 'labelName', metric, betweenQuotes: true };
    }

    // Traditional label value: `foo =~ "val…`
    const opMatch = segment.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~|!=|=)\s*"?[^"]*$/);
    if (opMatch) {
      return { type: 'labelValue', metric, label: opMatch[1] };
    }

    return { type: 'labelName', metric };
  }

  // Grouping clause `by (…) / without (…) / on (…) / ignoring (…)` — innermost
  // unmatched `(` whose preceding identifier is a grouping keyword.
  let parenDepth = 0;
  let lastOpenParen = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === ')') {
      parenDepth++;
    } else if (c === '(') {
      if (parenDepth === 0) {
        lastOpenParen = i;
        break;
      }
      parenDepth--;
    }
  }
  if (lastOpenParen >= 0) {
    const beforeParen = prefix.substring(0, lastOpenParen);
    if (/(^|[^a-zA-Z0-9_])(by|without|on|ignoring)\s*$/.test(beforeParen)) {
      return { type: 'grouping' };
    }
  }

  // At-modifier: selector `@ …` — expects `start()`, `end()`, or a timestamp.
  // `@` must appear at a token boundary (preceded by `]`, `}`, `)`, or space)
  // so we don't misfire on chars inside identifiers (PromQL doesn't allow `@`
  // in identifiers anyway, but defensive matching keeps this regex robust).
  if (/(^|[\s\]\}\)])@\s*[a-zA-Z_]*$/.test(prefix)) {
    return { type: 'modifierAt' };
  }

  // Offset modifier: `selector offset <duration>`. Match `offset` as a whole
  // word (no leading identifier chars, no trailing identifier chars already)
  // followed by at least one whitespace and an optional partial duration.
  if (/(^|[\s\]\}\)])offset\s+\w*$/.test(prefix)) {
    return { type: 'modifierOffset' };
  }

  return { type: 'expression' };
}

/**
 * Scan the whole prefix for the first known metric name and return it.
 * Supports both UTF-8 quoted form (`{"metric.name"}`) and traditional bare
 * identifiers with proper word boundaries. Used to scope grouping-clause
 * label suggestions to the metric actually referenced in the query.
 */
export function findKnownMetricInPrefix(prefix: string, metricNames: string[]): string | undefined {
  if (!prefix || metricNames.length === 0) {
    return undefined;
  }
  // Longest-first so `http_requests_total` wins over `http_requests`.
  const sorted = [...metricNames].sort((a, b) => b.length - a.length);
  const isIdent = (c: number) =>
    (c >= 48 && c <= 57) ||
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c === 95 ||
    c === 58 ||
    c === 46;
  for (const name of sorted) {
    // UTF-8 quoted form: `"metric.name"` — no boundary concern.
    if (prefix.includes(`"${name}"`)) {
      return name;
    }
    const idx = prefix.indexOf(name);
    if (idx < 0) {
      continue;
    }
    const before = idx > 0 ? prefix.charCodeAt(idx - 1) : 0;
    const after = idx + name.length < prefix.length ? prefix.charCodeAt(idx + name.length) : 0;
    if (!isIdent(before) && !isIdent(after)) {
      return name;
    }
  }
  return undefined;
}

/**
 * Build a match[] selector for /labels and /label/{x}/values from a metric
 * name. Uses `{__name__="<name>"}` which is the canonical selector form that
 * works for BOTH traditional (`http_requests_total`) and UTF-8
 * (`process.cpu.time`) metric names. Quotes and backslashes in the name are
 * escaped to keep the selector parseable.
 */
function matchSelectorForMetric(metric: string): string {
  const escaped = metric.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `{__name__="${escaped}"}`;
}

/**
 * Autocomplete lookups are scoped to a recent time window so Parseable's
 * /labels and /label/{x}/values don't scan full history when `match[]` is
 * present (they hang without a time range). 6 hours is wide enough for
 * typical exploration while keeping queries fast.
 */
const AUTOCOMPLETE_LOOKBACK_SEC = 6 * 60 * 60;

function autocompleteTimeRange() {
  const end = Math.floor(Date.now() / 1000);
  return { start: end - AUTOCOMPLETE_LOOKBACK_SEC, end };
}

async function fetchScopedLabels(ctx: PromqlCompletionContext, metric: string): Promise<string[]> {
  const key = `${ctx.streamName}|${metric}`;
  const cached = seriesLabelsCache.get(key);
  if (cached) {
    return cached;
  }
  const { start, end } = autocompleteTimeRange();
  const labels = await ctx.datasource.getPromLabels(ctx.streamName, {
    match: [matchSelectorForMetric(metric)],
    start,
    end,
  });
  const arr = labels.filter((l) => l !== '__name__').sort();
  seriesLabelsCache.set(key, arr);
  return arr;
}

async function fetchLabelValues(
  ctx: PromqlCompletionContext,
  label: string,
  metric?: string
): Promise<string[]> {
  const key = `${ctx.streamName}|${metric || ''}|${label}`;
  const cached = labelValuesCache.get(key);
  if (cached) {
    return cached;
  }
  const { start, end } = autocompleteTimeRange();
  const opts = metric
    ? { match: [matchSelectorForMetric(metric)], start, end }
    : { start, end };
  const raw = await ctx.datasource.getPromLabelValues(ctx.streamName, label, opts);
  const values = raw.slice().sort();
  labelValuesCache.set(key, values);
  return values;
}

let registered = false;
let signatureRegistered = false;

/**
 * Register the PromQL signature-help provider. Shows a floating tooltip with
 * the function signature and highlights the active parameter as the user
 * types inside a `funcName(…)` call. Idempotent.
 */
export function ensurePromqlSignatureHelpProvider(monaco: Monaco) {
  if (signatureRegistered) {
    return;
  }
  signatureRegistered = true;

  monaco.languages.registerSignatureHelpProvider('promql', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp(model, position): monacoType.languages.ProviderResult<monacoType.languages.SignatureHelpResult> {
      const prefix = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const call = findEnclosingFunctionCall(prefix);
      if (!call) {
        return null;
      }
      const sig = PROM_SIGNATURES[call.name];
      if (!sig) {
        return null;
      }
      // Clamp the active parameter to the last param (variadic tails keep
      // highlighting the final `…` entry).
      const activeParameter = sig.params.length === 0 ? 0 : Math.min(call.argIndex, sig.params.length - 1);
      return {
        value: {
          signatures: [
            {
              label: sig.label,
              documentation: sig.doc,
              parameters: sig.params.map((p) => ({ label: p })),
            },
          ],
          activeSignature: 0,
          activeParameter,
        },
        dispose() {
          /* no-op — signature objects are plain data */
        },
      };
    },
  });
}

export function ensurePromqlCompletionProvider(monaco: Monaco) {
  if (registered) {
    return;
  }
  registered = true;

  const Kind = monaco.languages.CompletionItemKind;

  monaco.languages.registerCompletionItemProvider('promql', {
    triggerCharacters: ['{', ',', '=', '~', '"', '(', '[', ' ', '@'],
    async provideCompletionItems(
      model: monacoType.editor.ITextModel,
      position: monacoType.Position
    ): Promise<monacoType.languages.CompletionList> {
      const ctx = currentContext;
      if (!ctx) {
        return { suggestions: [], incomplete: true };
      }

      const prefix = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const word = model.getWordUntilPosition(position);
      const range: monacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const parsed = detectPromqlContext(prefix);

      // Post-insert command that re-opens the suggestion widget; native plugin
      // uses this after label names so values suggest immediately after `=`.
      const retrigger: monacoType.languages.Command = {
        id: 'editor.action.triggerSuggest',
        title: '',
      };

      if (parsed.type === 'labelName') {
        const labels = parsed.metric
          ? await fetchScopedLabels(ctx, parsed.metric).catch(() => [] as string[])
          : ctx.labels;
        const filtered = labels.filter((l) => l !== '__name__');
        return {
          suggestions: filtered.map((l) => {
            // If the user is inside an already-open quoted label (UTF-8 form),
            // don't emit an outer quote pair; just insert the name. Otherwise,
            // UTF-8 label names must be wrapped in quotes. Always append `=`
            // and re-trigger the suggest widget so values show immediately.
            const legacy = isLegacyIdent(l);
            let insertText: string;
            if (parsed.betweenQuotes) {
              insertText = `${l}=`;
            } else if (legacy) {
              insertText = `${l}=`;
            } else {
              insertText = `"${l}"=`;
            }
            return {
              label: l,
              kind: Kind.Property,
              insertText,
              filterText: l,
              detail: parsed.metric ? `label (${parsed.metric})` : 'label',
              command: retrigger,
              range,
            };
          }),
          incomplete: true,
        };
      }

      if (parsed.type === 'labelValue') {
        const values = await fetchLabelValues(ctx, parsed.label, parsed.metric).catch(() => [] as string[]);
        // Don't re-emit the leading quote if the user just typed one.
        const prevChar = prefix.length > 0 ? prefix[prefix.length - 1] : '';
        const alreadyQuoted = prevChar === '"';
        return {
          suggestions: values.map((v) => {
            const escaped = escapeLabelValue(v);
            // When already inside an open quote, insert just the escaped text
            // (native relies on the editor's existing closing quote). When
            // starting fresh, wrap both sides.
            const insertText = alreadyQuoted ? escaped : `"${escaped}"`;
            return {
              label: v,
              kind: Kind.Value,
              insertText,
              filterText: v,
              detail: 'value',
              range,
            };
          }),
          incomplete: true,
        };
      }

      if (parsed.type === 'range') {
        return {
          suggestions: RANGE_SUGGESTIONS.map((r) => ({
            label: r,
            kind: Kind.Value,
            insertText: r,
            detail: 'range',
            range,
          })),
          incomplete: true,
        };
      }

      if (parsed.type === 'modifierAt') {
        // start() and end() are the anchor functions for the @-modifier.
        // Also offer the `time()` of the current evaluation as a template.
        const options: Array<{ label: string; insert: string; detail: string }> = [
          { label: 'start()', insert: 'start()', detail: 'at-modifier · range start' },
          { label: 'end()', insert: 'end()', detail: 'at-modifier · range end' },
        ];
        return {
          suggestions: options.map((o) => ({
            label: o.label,
            kind: Kind.Function,
            insertText: o.insert,
            filterText: o.label,
            detail: o.detail,
            range,
          })),
          incomplete: true,
        };
      }

      if (parsed.type === 'modifierOffset') {
        return {
          suggestions: RANGE_SUGGESTIONS.map((r) => ({
            label: r,
            kind: Kind.Value,
            insertText: r,
            detail: 'offset duration',
            range,
          })),
          incomplete: true,
        };
      }

      if (parsed.type === 'grouping') {
        // Inside `by (…)` / `without (…)` / `on (…)` / `ignoring (…)`. Scope
        // labels to the metric referenced anywhere in the query text. Falls
        // back to stream-wide labels when no known metric is in the prefix.
        const metric = findKnownMetricInPrefix(prefix, ctx.metricNames);
        const labels = metric
          ? await fetchScopedLabels(ctx, metric).catch(() => [] as string[])
          : ctx.labels.filter((l) => l !== '__name__');
        return {
          suggestions: labels.map((l) => ({
            label: l,
            kind: Kind.Property,
            // UTF-8 label names must be quoted here too.
            insertText: isLegacyIdent(l) ? l : `"${l}"`,
            filterText: l,
            detail: metric ? `label (${metric})` : 'label',
            range,
          })),
          incomplete: true,
        };
      }

      // Expression context: history + metrics + aggregations + functions + keywords.
      const suggestions: monacoType.languages.CompletionItem[] = [];

      // Recent queries — emitted first so they appear at the top of the list
      // when they match the partial typed text. `sortText` with a leading
      // `0_` forces ordering ahead of metrics / functions / keywords.
      const history = ctx.history ?? [];
      history.forEach((q, idx) => {
        // Collapse multi-line queries to a single line for display.
        const shortLabel = q.length > 80 ? q.substring(0, 77) + '…' : q;
        suggestions.push({
          label: shortLabel.replace(/\s+/g, ' '),
          kind: Kind.Snippet,
          insertText: q,
          filterText: q,
          sortText: `0_${String(idx).padStart(3, '0')}`,
          detail: 'history',
          range,
        });
      });

      ctx.metricNames.forEach((name) => {
        const meta = ctx.metricMetadata[name];
        const detail = meta?.type
          ? `metric · ${meta.type}${meta.help ? ' — ' + meta.help : ''}`
          : 'metric';
        // Traditional PromQL metric names are inserted bare; anything else
        // (OTel-style `process.cpu.time`) must use Prometheus 3.0 UTF-8 form.
        const insertText = isLegacyIdent(name) ? name : `{"${name}"}`;
        suggestions.push({
          label: name,
          kind: Kind.Field,
          insertText,
          filterText: name,
          detail,
          range,
        });
      });

      // Native plugin inserts aggregations and functions as bare identifiers —
      // no parens, no snippet. Typing `(` then fires the trigger-char completion
      // for the next argument. Snippet tab stops would suppress further
      // completions inside the parens, which is the exact bug we're avoiding.
      AGGREGATIONS.forEach((op) => {
        suggestions.push({
          label: op,
          kind: Kind.Function,
          insertText: op,
          filterText: op,
          detail: 'aggregation',
          range,
        });
      });

      FUNCTIONS.forEach((fn) => {
        suggestions.push({
          label: fn,
          kind: Kind.Function,
          insertText: fn,
          filterText: fn,
          detail: 'function',
          range,
        });
      });

      KEYWORDS.forEach((kw) => {
        suggestions.push({
          label: kw,
          kind: Kind.Keyword,
          insertText: kw,
          detail: 'keyword',
          range,
        });
      });

      return { suggestions, incomplete: true };
    },
  });
}
