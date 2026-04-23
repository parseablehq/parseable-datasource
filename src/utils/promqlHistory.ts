/**
 * Per-datasource PromQL query history, persisted in localStorage.
 * Surfaces recent queries as suggestions in the Monaco completion provider.
 */

const MAX_ENTRIES = 10;
const STORAGE_PREFIX = 'parseable-datasource:promql-history:';

function storageKey(dsUid: string): string {
  return STORAGE_PREFIX + dsUid;
}

function safeRead(key: string): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((q): q is string => typeof q === 'string' && q.length > 0);
  } catch {
    return [];
  }
}

function safeWrite(key: string, value: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* quota / private-mode / SSR — silently skip. */
  }
}

export function getPromqlHistory(dsUid: string): string[] {
  if (!dsUid) {
    return [];
  }
  return safeRead(storageKey(dsUid));
}

/**
 * Push a query to the front of history; dedupe (move-to-front), trim to
 * MAX_ENTRIES. No-op on blank queries.
 */
export function recordPromqlQuery(dsUid: string, query: string): void {
  if (!dsUid || !query || !query.trim()) {
    return;
  }
  const trimmed = query.trim();
  const key = storageKey(dsUid);
  const current = safeRead(key);
  const deduped = [trimmed, ...current.filter((q) => q !== trimmed)].slice(0, MAX_ENTRIES);
  safeWrite(key, deduped);
}

export function clearPromqlHistory(dsUid: string): void {
  if (!dsUid) {
    return;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(storageKey(dsUid));
    }
  } catch {
    /* ignore */
  }
}
