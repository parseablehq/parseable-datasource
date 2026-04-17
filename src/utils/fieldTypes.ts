/**
 * Field type parsing and operator resolution — ported from Prism.
 *
 * Source: prism/src/store/streamSlice.ts  (parseType, FieldTypeMap)
 *         prism/src/constants/operators.ts (operator lists)
 *         prism/src/utils/index.ts         (getOperators)
 */

// ---------------------------------------------------------------------------
// Simplified field type (matches Prism exactly)
// ---------------------------------------------------------------------------

export type ParsedType = 'text' | 'number' | 'timestamp' | 'boolean' | 'listInt' | 'listFloat' | 'listString';

export type FieldTypeMap = {
  [key: string]: ParsedType;
};

// ---------------------------------------------------------------------------
// parseType — Prism's streamSlice.ts:34-64
// ---------------------------------------------------------------------------

function get(obj: any, path: string, defaultValue: any): any {
  const keys = path.split('.');
  let result = obj;
  for (const key of keys) {
    if (result == null || typeof result !== 'object') {
      return defaultValue;
    }
    result = result[key];
  }
  return result !== undefined ? result : defaultValue;
}

export const parseType = (type: any): ParsedType => {
  if (typeof type === 'object') {
    if (get(type, 'Timestamp', null)) {
      return 'timestamp';
    } else if (get(type, 'List', null)) {
      const listType = get(type, 'List.data_type', null);
      if (listType) {
        switch (listType) {
          case 'Float64':
            return 'listFloat';
          case 'Int64':
            return 'listInt';
          case 'UTF8':
            return 'listString';
          default:
            return 'listInt';
        }
      }
    }
    return 'text';
  }
  const lowercaseType = String(type).toLowerCase();
  if (lowercaseType.startsWith('int') || lowercaseType.startsWith('float') || lowercaseType.startsWith('double')) {
    return 'number';
  } else if (lowercaseType.startsWith('bool')) {
    return 'boolean';
  } else {
    return 'text';
  }
};

// ---------------------------------------------------------------------------
// Build a FieldTypeMap from schema fields (like setStreamSchema in Prism)
// ---------------------------------------------------------------------------

export interface SchemaField {
  name: string;
  data_type: any;
  nullable?: boolean;
  dict_id?: number;
  dict_is_ordered?: boolean;
}

export function buildFieldTypeMap(fields: SchemaField[]): FieldTypeMap {
  return fields.reduce<FieldTypeMap>((acc, field) => {
    acc[field.name] = parseType(field.data_type);
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// Operators — Prism's constants/operators.ts
// ---------------------------------------------------------------------------

export interface Operator {
  name: string;
  value: string;
}

export const numberFieldOperators: Operator[] = [
  { name: '=', value: '=' },
  { name: '!=', value: '!=' },
  { name: '<', value: '<' },
  { name: '>', value: '>' },
  { name: '<=', value: '<=' },
  { name: '>=', value: '>=' },
  { name: 'is null', value: 'is null' },
  { name: 'is not null', value: 'is not null' },
];

export const textFieldOperators: Operator[] = [
  { name: 'equals to', value: '=' },
  { name: 'not equals to', value: '!=' },
  { name: 'case-insensitive match', value: 'ilike' },
  { name: 'contains', value: 'contains' },
  { name: 'begins with', value: 'begins with' },
  { name: 'ends with', value: 'ends with' },
  { name: 'does not contain', value: 'does not contain' },
  { name: 'does not begin with', value: 'does not begin with' },
  { name: 'does not end with', value: 'does not end with' },
  { name: 'is null', value: 'is null' },
  { name: 'is not null', value: 'is not null' },
];

export const booleanFieldOperators: Operator[] = [
  { name: '=', value: '=' },
  { name: '!=', value: '!=' },
  { name: 'is null', value: 'is null' },
  { name: 'is not null', value: 'is not null' },
];

export const listFieldOperators: Operator[] = [
  { name: '=', value: '=' },
  { name: '!=', value: '!=' },
  { name: 'contains', value: 'contains' },
  { name: 'does not contain', value: 'does not contain' },
  { name: 'is null', value: 'is null' },
  { name: 'is not null', value: 'is not null' },
];

// ---------------------------------------------------------------------------
// getOperators — Prism's utils/index.ts:524-541
// ---------------------------------------------------------------------------

export const getOperators = (fieldTypeMap: FieldTypeMap, field: string): Operator[] => {
  if (!field) {
    return [];
  }
  if (fieldTypeMap[field] === 'number') {
    return numberFieldOperators;
  } else if (fieldTypeMap[field] === 'text') {
    return textFieldOperators;
  } else if (fieldTypeMap[field] === 'boolean') {
    return booleanFieldOperators;
  } else if (
    fieldTypeMap[field] === 'listInt' ||
    fieldTypeMap[field] === 'listFloat' ||
    fieldTypeMap[field] === 'listString'
  ) {
    return listFieldOperators;
  } else {
    return numberFieldOperators;
  }
};

// ---------------------------------------------------------------------------
// Aggregate options — mirrors Prism's AlertsQueryBuilder
// ---------------------------------------------------------------------------

export interface AggregateOption {
  label: string;
  value: string;
}

const NUMERIC_AGGREGATES: AggregateOption[] = [
  { label: 'COUNT', value: 'COUNT' },
  { label: 'SUM', value: 'SUM' },
  { label: 'AVG', value: 'AVG' },
  { label: 'MIN', value: 'MIN' },
  { label: 'MAX', value: 'MAX' },
];

const COUNT_ONLY: AggregateOption[] = [{ label: 'COUNT', value: 'COUNT' }];

/**
 * Returns the aggregate functions available for a given field.
 * Numeric fields get all aggregates; everything else only gets COUNT.
 * `fieldName` of `''` (All rows) always returns COUNT only.
 */
export function getAggregateOptions(fieldTypeMap: FieldTypeMap, fieldName: string): AggregateOption[] {
  if (!fieldName) {
    return COUNT_ONLY;
  }
  const type = fieldTypeMap[fieldName];
  if (type === 'number') {
    return NUMERIC_AGGREGATES;
  }
  return COUNT_ONLY;
}

// ---------------------------------------------------------------------------
// Display helpers for parsed types
// ---------------------------------------------------------------------------

export function typeLabel(pt: ParsedType): string {
  switch (pt) {
    case 'number':
      return '#';
    case 'text':
      return 'Ab';
    case 'timestamp':
      return 'T';
    case 'boolean':
      return 'B';
    case 'listInt':
    case 'listFloat':
    case 'listString':
      return '[]';
    default:
      return '?';
  }
}

export function typeDisplayName(pt: ParsedType): string {
  switch (pt) {
    case 'number':
      return 'number';
    case 'text':
      return 'text';
    case 'timestamp':
      return 'timestamp';
    case 'boolean':
      return 'boolean';
    case 'listInt':
      return 'list (int)';
    case 'listFloat':
      return 'list (float)';
    case 'listString':
      return 'list (string)';
    default:
      return 'unknown';
  }
}
