import type { SyntaxNode, Tree } from '@lezer/common';
import { parser as promqlParser } from '@prometheus-io/lezer-promql';

/**
 * Parse PromQL text using the canonical Lezer grammar (the same one the
 * native Grafana Prometheus datasource uses). Returns a parse tree; error
 * recovery is built in so partial / incomplete input still produces a tree.
 */
export function parsePromQL(text: string): Tree {
  return promqlParser.parse(text);
}

/** Ascend the tree and return the nearest ancestor whose type name is in the set. */
export function findAncestorByName(node: SyntaxNode | null, names: string[]): SyntaxNode | null {
  let n: SyntaxNode | null = node;
  while (n) {
    if (names.includes(n.type.name)) {
      return n;
    }
    n = n.parent;
  }
  return null;
}

/** Extract the original source text corresponding to a node. */
export function nodeText(text: string, node: SyntaxNode): string {
  return text.substring(node.from, node.to);
}

const MARKER_OWNER = 'parseable-promql';

/**
 * Convert parse errors in the current PromQL model into Monaco markers so
 * Grafana renders red squiggles under the offending ranges. Subscribe via
 * `attachPromqlErrorMarkers(editor, monaco)`; the returned disposable
 * should be cleaned up on editor unmount (Grafana handles this for us via
 * the editor's lifetime).
 */
export function attachPromqlErrorMarkers(editor: any, monaco: any): { dispose: () => void } {
  let pendingTimer: any = null;

  const update = () => {
    const model = editor.getModel?.();
    if (!model || model.getLanguageId?.() !== 'promql') {
      return;
    }
    const text = model.getValue();
    if (!text.trim()) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      return;
    }
    try {
      const tree = parsePromQL(text);
      const errors = collectParseErrors(tree);
      const markers = errors.map((e) => {
        // Empty spans happen on "missing token" — nudge them one char wide so
        // Monaco actually shows the squiggle.
        const from = model.getPositionAt(e.from);
        const to = e.to > e.from ? model.getPositionAt(e.to) : model.getPositionAt(e.from + 1);
        return {
          severity: monaco.MarkerSeverity.Error,
          message: 'PromQL syntax error',
          startLineNumber: from.lineNumber,
          startColumn: from.column,
          endLineNumber: to.lineNumber,
          endColumn: to.column,
        };
      });
      monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
    } catch {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    }
  };

  // Prime once so a dashboard panel opening on a saved query gets markers
  // without needing an edit first.
  update();

  const sub = editor.onDidChangeModelContent?.(() => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    // Debounce: parsing runs at most once every 250 ms while the user types.
    pendingTimer = setTimeout(update, 250);
  });

  return {
    dispose() {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
      }
      sub?.dispose?.();
      const model = editor.getModel?.();
      if (model) {
        monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      }
    },
  };
}

/** Iterate all error nodes in the tree and yield [from, to] spans. */
export function collectParseErrors(tree: Tree): Array<{ from: number; to: number }> {
  const errors: Array<{ from: number; to: number }> = [];
  tree.iterate({
    enter(ref) {
      if (ref.type.isError) {
        errors.push({ from: ref.from, to: ref.to });
      }
    },
  });
  return errors;
}

/**
 * Given a VectorSelector node, return the metric name (the child `MetricName`
 * for traditional form, or the first `QuotedLabelName` under `LabelMatchers`
 * for the UTF-8 form). Returns undefined if no metric is named.
 */
export function metricNameFromVectorSelector(text: string, selector: SyntaxNode): string | undefined {
  // Traditional form: `metric{…}` — the first child is a MetricName token.
  let child: SyntaxNode | null = selector.firstChild;
  while (child) {
    if (child.type.name === 'MetricName' || child.type.name === 'Identifier') {
      const t = nodeText(text, child).trim();
      if (t) {
        return t;
      }
    }
    child = child.nextSibling;
  }
  // UTF-8 form: `{"metric.name", …}` — first QuotedLabelName inside LabelMatchers.
  const labelMatchers = selector.getChild('LabelMatchers');
  if (labelMatchers) {
    const firstQ = labelMatchers.getChild('QuotedLabelName');
    if (firstQ) {
      const firstS = firstQ.getChild('StringLiteral');
      if (firstS) {
        // Strip surrounding quotes.
        const raw = nodeText(text, firstS);
        return raw.replace(/^"|"$/g, '');
      }
    }
  }
  return undefined;
}
