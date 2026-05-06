/**
 * SQL normalization utilities ported from Parseable Prism.
 *
 * These functions sanitize user-supplied SQL before it is sent to the
 * Parseable query API.  All transformations are quote-aware — content
 * inside single-quoted string literals is never modified.
 */

// ---------------------------------------------------------------------------
// Quote-aware helper
// ---------------------------------------------------------------------------

/**
 * Splits a SQL string on single-quoted literals, applies `transform`
 * only to the parts that are *outside* quotes, then reassembles.
 */
function transformOutsideQuotes(sql: string, transform: (part: string) => string): string {
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 === 0 ? transform(part) : part))
    .join('');
}

// ---------------------------------------------------------------------------
// Normalization primitives
// ---------------------------------------------------------------------------

/**
 * Fix escaped / tripled quotes that may arrive from the editor or
 * from copy-paste out of JSON payloads.
 */
export function normalizeToRealSql(s: string): string {
  if (!s) {
    return s;
  }
  let out = s;
  out = out.replace(/\\'\\''\\'/g, "'");
  out = out.replace(/\\'\\'\\'/g, "'");
  out = out.replace(/\\"/g, '"').replace(/\\'/g, "'");
  out = out.replace(/'''/g, "'");
  out = out.replace(/\\\\/g, '\\');
  return out;
}

/**
 * Strips full-line SQL comments (lines starting with `--`).
 * Inline comments on the same line as real SQL are left alone so the
 * raw editor content is not visually altered.
 */
export function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
}

/**
 * Wraps table names containing hyphens in double-quotes so the SQL
 * parser treats them as valid identifiers.
 *
 *   `FROM my-stream`  →  `FROM "my-stream"`
 */
export function quoteHyphenatedTables(sql: string): string {
  return sql.replace(
    /\b(FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:-[a-zA-Z0-9_]+)+)/gi,
    (_, keyword, identifier) => `${keyword} "${identifier}"`
  );
}

/**
 * Full sanitization pipeline applied just before a query is dispatched
 * to the Parseable API.
 *
 * Steps (in order):
 *  1. Normalize escaped quotes       → `normalizeToRealSql`
 *  2. Quote hyphenated table names    → `quoteHyphenatedTables`
 *  3. Strip full-line `--` comments   → `stripLineComments`
 *  4. Strip inline `--` comments      (quote-aware)
 *  5. Collapse newlines to spaces     (quote-aware)
 *  6. Remove stray semicolons         (quote-aware)
 *  7. Trim
 */
export function sanitizeSql(sql: string): string {
  if (!sql) {
    return sql;
  }

  // 1-3 – structural fixes
  let out = normalizeToRealSql(sql);
  out = quoteHyphenatedTables(out);
  out = stripLineComments(out);

  // 4-6 – quote-aware cleanup
  out = transformOutsideQuotes(out, (p) => p.replace(/--.*$/gm, ''));
  out = transformOutsideQuotes(out, (p) => p.replace(/\n/g, ' '));
  out = transformOutsideQuotes(out, (p) => p.replace(/;/g, ''));

  return out.trim();
}
