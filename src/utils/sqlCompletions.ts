import type { Monaco } from '@monaco-editor/react';
import type { SchemaFields } from '../types';

// Shared context that the registered Monaco SQL completion provider reads
// from. The Monaco provider is registered once per page lifetime, so it must
// pull the live stream/schema from a module-scope holder updated by whichever
// QueryEditor instance is currently mounted.
let currentSchema: {
  stream?: string;
  fields: SchemaFields[];
} = { fields: [] };

export function updateSqlSchema(stream: string | undefined, fields: SchemaFields[]) {
  currentSchema = { stream, fields };
}

const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'ILIKE',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
  'ASC',
  'DESC',
  'DISTINCT',
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'ON',
  'UNION',
  'UNION ALL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'WITH',
];

const SQL_AGGREGATES = [
  { name: 'COUNT', snippet: 'COUNT($1)' },
  { name: 'COUNT(DISTINCT)', snippet: 'COUNT(DISTINCT $1)' },
  { name: 'SUM', snippet: 'SUM($1)' },
  { name: 'AVG', snippet: 'AVG($1)' },
  { name: 'MIN', snippet: 'MIN($1)' },
  { name: 'MAX', snippet: 'MAX($1)' },
  { name: 'APPROX_DISTINCT', snippet: 'APPROX_DISTINCT($1)' },
];

const SQL_FUNCTIONS = [
  'NOW',
  'CURRENT_TIMESTAMP',
  'DATE_TRUNC',
  'DATE_BIN',
  'EXTRACT',
  'TO_TIMESTAMP',
  'CAST',
  'COALESCE',
  'NULLIF',
  'LOWER',
  'UPPER',
  'LENGTH',
  'SUBSTRING',
  'TRIM',
  'REPLACE',
  'CONCAT',
  'ROUND',
  'FLOOR',
  'CEIL',
  'ABS',
];

let sqlProviderRegistered = false;

export function setupSqlEditor(monaco: Monaco) {
  if (sqlProviderRegistered) {
    return;
  }
  sqlProviderRegistered = true;

  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', '.', ',', '('],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: any[] = [];
      const { stream, fields } = currentSchema;

      // Stream / dataset name (table)
      if (stream) {
        const quoted = `"${stream}"`;
        suggestions.push({
          label: stream,
          kind: monaco.languages.CompletionItemKind.Struct,
          insertText: quoted,
          detail: 'dataset',
          sortText: '0_' + stream,
          range,
        });
      }

      // Field / column names — always double-quoted (matches Prism behavior).
      fields.forEach((f) => {
        suggestions.push({
          label: f.name,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: `"${f.name}"`,
          detail: typeof f.data_type === 'string' ? `column · ${f.data_type}` : 'column',
          sortText: '1_' + f.name,
          range,
        });
      });

      // Aggregates
      SQL_AGGREGATES.forEach((a) => {
        suggestions.push({
          label: a.name,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: a.snippet,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'aggregate',
          sortText: '2_' + a.name,
          range,
        });
      });

      // Scalar functions
      SQL_FUNCTIONS.forEach((fn) => {
        suggestions.push({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: fn + '($1)',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'function',
          sortText: '3_' + fn,
          range,
        });
      });

      // Keywords
      SQL_KEYWORDS.forEach((kw) => {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          detail: 'keyword',
          sortText: '4_' + kw,
          range,
        });
      });

      return { suggestions };
    },
  });
}
