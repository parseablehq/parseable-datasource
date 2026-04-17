/**
 * SQL query building from filters — ported from Prism.
 *
 * Source: prism/src/utils/query-builder.ts (escapeSqlLiteral, escapeSqlLikeValue,
 *         buildSingleFilterCondition, generateWhereClause)
 *         prism/src/utils/filter.ts         (coerceValueByType, isNullOperator)
 */

import { FieldTypeMap } from './fieldTypes';

// ---------------------------------------------------------------------------
// Filter type (matches Prism's FilterType without the id / Redux fields)
// ---------------------------------------------------------------------------

export interface FilterCondition {
  column: string;
  operator: string;
  value: string | number | boolean | null;
  type: string;
}

// ---------------------------------------------------------------------------
// coerceValueByType — Prism's utils/filter.ts:39-55
// ---------------------------------------------------------------------------

export const coerceValueByType = (fieldType: string | undefined, raw: any): string | number | boolean | null => {
  const type = fieldType ?? 'text';

  if (raw === null || raw === undefined) {
    return null;
  }

  switch (type) {
    case 'number': {
      const num = Number(raw);
      return Number.isNaN(num) ? null : num;
    }
    case 'boolean':
      return String(raw).toLowerCase() === 'true';
    case 'text':
    case 'timestamp':
    default:
      return String(raw);
  }
};

export const isNullOperator = (op?: string): boolean => op === 'is null' || op === 'is not null';

// ---------------------------------------------------------------------------
// SQL escaping — Prism's utils/query-builder.ts:8-15
// ---------------------------------------------------------------------------

export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function escapeSqlLikeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// buildSingleFilterCondition — Prism's QueryBuilder.buildSingleFilterCondition
// ---------------------------------------------------------------------------

function buildSingleFilterCondition({
  column,
  operator,
  value,
  type,
}: {
  column: string;
  operator: string;
  value: string | number | boolean | null;
  type: string;
}): string {
  const formattedColumn = `"${column}"`;
  const normalizedOperator = operator.toLowerCase().trim();
  const normalizedValue = value === undefined ? '' : value;

  // Null handling
  if (normalizedValue === null) {
    if (normalizedOperator === '=' || normalizedOperator === 'is null') {
      return `${formattedColumn} IS NULL`;
    }
    if (normalizedOperator === '!=' || normalizedOperator === '<>' || normalizedOperator === 'is not null') {
      return `${formattedColumn} IS NOT NULL`;
    }
    return `${formattedColumn} IS NULL`;
  }

  // List types
  if (type === 'listInt' || type === 'listFloat' || type === 'listString') {
    const escapedValue = escapeSqlLikeValue(String(normalizedValue));
    const isContains = normalizedOperator === 'contains' || normalizedOperator === 'does not contain';
    const wrapNot = (sql: string) => (normalizedOperator === 'does not contain' ? `NOT ${sql}` : sql);

    let rhs: string;
    if (type === 'listInt') {
      rhs = `ARRAY${escapedValue}`;
    } else if (type === 'listFloat') {
      rhs = `CAST(${escapedValue} AS ARRAY<DOUBLE>)`;
    } else {
      rhs = `CAST(${escapedValue} AS ARRAY<STRING>)`;
    }

    if (isContains) {
      return wrapNot(`array_has_all(${formattedColumn}, ${rhs})`);
    }
    if (normalizedOperator === '=' || normalizedOperator === '!=') {
      return `${formattedColumn} ${operator} ${rhs}`;
    }
    if (normalizedOperator === 'is null') {
      return `${formattedColumn} IS NULL`;
    }
    if (normalizedOperator === 'is not null') {
      return `${formattedColumn} IS NOT NULL`;
    }
  }

  // Formatted value: quote text/timestamp, leave numbers/booleans raw
  const formattedValue =
    type === 'text' || type === 'timestamp'
      ? `'${String(normalizedValue).replace(/'/g, "''")}'`
      : normalizedValue;

  // Text-specific operators (contains, begins with, etc.)
  if (type === 'text') {
    const escapedLikeValue = escapeSqlLikeValue(String(normalizedValue));

    switch (normalizedOperator) {
      case 'contains':
        return `${formattedColumn} LIKE '%${escapedLikeValue}%' ESCAPE '\\\\'`;
      case 'begins with':
        return `${formattedColumn} LIKE '${escapedLikeValue}%' ESCAPE '\\\\'`;
      case 'ends with':
        return `${formattedColumn} LIKE '%${escapedLikeValue}' ESCAPE '\\\\'`;
      case 'does not contain':
        return `${formattedColumn} NOT LIKE '%${escapedLikeValue}%' ESCAPE '\\\\'`;
      case 'does not begin with':
        return `${formattedColumn} NOT LIKE '${escapedLikeValue}%' ESCAPE '\\\\'`;
      case 'does not end with':
        return `${formattedColumn} NOT LIKE '%${escapedLikeValue}' ESCAPE '\\\\'`;
      case 'case-insensitive match':
      case 'ilike':
        return `${formattedColumn} ILIKE '%${escapedLikeValue}%' ESCAPE '\\\\'`;
      default:
        return `${formattedColumn} ${operator} ${formattedValue}`;
    }
  }

  return `${formattedColumn} ${operator} ${formattedValue}`;
}

// ---------------------------------------------------------------------------
// Stream name quoting — ensures hyphenated names are valid SQL identifiers.
// Always quote so the SQL is correct regardless of evaluation path
// (frontend sanitizeSql vs backend Go which skips normalization).
// ---------------------------------------------------------------------------

function quoteStream(name: string): string {
  return name.includes('-') ? `"${name}"` : name;
}

// ---------------------------------------------------------------------------
// Build an aggregate SQL query for monitor / alert mode
// ---------------------------------------------------------------------------

export function buildMonitorSql(
  stream: string,
  monitorField: string,
  aggregate: string,
  filters: FilterCondition[],
  fieldTypeMap: FieldTypeMap
): string {
  const agg = aggregate || 'COUNT';
  const selectExpr = !monitorField ? `${agg}(*)` : `${agg}("${monitorField}")`;

  let sql = `SELECT ${selectExpr} FROM ${quoteStream(stream)}`;

  if (filters.length > 0) {
    const conditions = filters
      .map((f) => {
        const coerced = isNullOperator(f.operator)
          ? null
          : coerceValueByType(f.type || fieldTypeMap[f.column], f.value);

        return buildSingleFilterCondition({
          column: f.column,
          operator: f.operator,
          value: coerced,
          type: f.type || fieldTypeMap[f.column] || 'text',
        });
      })
      .filter(Boolean);

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
  }

  return sql;
}

// ---------------------------------------------------------------------------
// Build a full SQL query from builder state
// ---------------------------------------------------------------------------

export function buildSqlFromFilters(
  stream: string,
  filters: FilterCondition[],
  columns: string[],
  fieldTypeMap: FieldTypeMap
): string {
  const columnStr = columns.length > 0 ? columns.map((c) => `"${c}"`).join(', ') : '*';
  let sql = `SELECT ${columnStr} FROM ${quoteStream(stream)}`;

  if (filters.length > 0) {
    const conditions = filters
      .map((f) => {
        const coerced = isNullOperator(f.operator)
          ? null
          : coerceValueByType(f.type || fieldTypeMap[f.column], f.value);

        return buildSingleFilterCondition({
          column: f.column,
          operator: f.operator,
          value: coerced,
          type: f.type || fieldTypeMap[f.column] || 'text',
        });
      })
      .filter(Boolean);

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
  }

  return sql;
}
