import type { Monaco } from '@grafana/ui';
import type * as monacoType from 'monaco-editor';

import {
  detectPromqlContext,
  findKnownMetricInPrefix,
  getCachedLabelValueCount,
  getPromqlCompletionContext,
} from './promqlCompletions';
import { PROM_SIGNATURES } from './promqlSignatures';

let registered = false;

/**
 * Register the PromQL hover provider. Shows a markdown tooltip when the
 * cursor hovers over a known metric, function, aggregation, or label name.
 *
 * Data sources are local (no on-demand network):
 *   - metric type + help → `metricMetadata` from the completion context
 *   - function signature + doc → `PROM_SIGNATURES`
 *   - label value count → cached from prior autocomplete lookups
 */
export function ensurePromqlHoverProvider(monaco: Monaco) {
  if (registered) {
    return;
  }
  registered = true;

  monaco.languages.registerHoverProvider('promql', {
    provideHover(model, position): monacoType.languages.ProviderResult<monacoType.languages.Hover> {
      const word = model.getWordAtPosition(position);
      if (!word) {
        return null;
      }
      const ctx = getPromqlCompletionContext();
      if (!ctx) {
        return null;
      }

      const wordRange: monacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      // Metric hover — takes priority over label/function in case of name collisions.
      if (ctx.metricNames.includes(word.word)) {
        const meta = ctx.metricMetadata[word.word];
        const lines: string[] = [`**${word.word}**`];
        if (meta?.type) {
          lines.push(`*metric · ${meta.type}*`);
        } else {
          lines.push(`*metric*`);
        }
        if (meta?.help) {
          lines.push(meta.help);
        }
        return {
          range: wordRange,
          contents: [{ value: lines.join('\n\n') }],
        };
      }

      // Function / aggregation hover.
      const sig = PROM_SIGNATURES[word.word];
      if (sig) {
        return {
          range: wordRange,
          contents: [
            { value: '```promql\n' + sig.label + '\n```' },
            { value: sig.doc },
          ],
        };
      }

      // Label hover — only when the cursor is in a label-matcher or grouping
      // context. Uses a prefix ending at the word's start, so the word itself
      // doesn't skew the context detection.
      const prefix = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: word.startColumn,
      });
      const parsed = detectPromqlContext(prefix);
      const inLabelContext =
        parsed.type === 'labelName' ||
        parsed.type === 'labelValue' ||
        parsed.type === 'grouping';
      if (!inLabelContext) {
        return null;
      }

      // Determine the metric this label belongs to (if any) so we can surface
      // a value count from cache.
      const fullPrefix = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      let metric: string | undefined;
      if (parsed.type === 'labelName' || parsed.type === 'labelValue') {
        metric = parsed.metric;
      } else {
        metric = findKnownMetricInPrefix(fullPrefix, ctx.metricNames);
      }

      const lines: string[] = [`**${word.word}**`, '*label*'];
      const count = getCachedLabelValueCount(ctx.streamName, word.word, metric);
      if (count !== undefined) {
        lines.push(`values: ${count}${metric ? ` (scoped to ${metric})` : ''}`);
      }
      return {
        range: wordRange,
        contents: [{ value: lines.join('\n\n') }],
      };
    },
  });
}
