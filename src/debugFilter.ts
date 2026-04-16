/**
 * DEBUG=* namespace filtering, compatible with the `debug` npm package convention.
 *
 * When `process.env.DEBUG` is set, only loggers whose namespace matches an
 * enabled pattern will produce output. Unmatched loggers are silenced.
 *
 * Supports:
 * - `DEBUG=*` — enable all namespaces
 * - `DEBUG=App:http,App:db` — comma-separated exact matches
 * - `DEBUG=App:*` — wildcard matching
 * - `DEBUG=*,-App:verbose` — negation (disable specific namespaces)
 *
 * Patterns are compiled once on first access and cached for zero per-call overhead.
 */

interface DebugFilter {
  enabled: RegExp[];
  disabled: RegExp[];
}

let _filter: DebugFilter | null = null;
let _hasFilter = false;

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function parseDebugEnv(): DebugFilter {
  const raw = typeof process !== 'undefined' && process.env ? process.env.DEBUG : undefined;
  if (!raw) return { enabled: [], disabled: [] };

  const enabled: RegExp[] = [];
  const disabled: RegExp[] = [];

  for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
    if (token.startsWith('-')) {
      disabled.push(patternToRegex(token.slice(1)));
    } else {
      enabled.push(patternToRegex(token));
    }
  }

  return { enabled, disabled };
}

/** Returns true when a DEBUG env var filter is active. */
export function hasDebugFilter(): boolean {
  if (_filter === null) {
    _filter = parseDebugEnv();
    _hasFilter = _filter.enabled.length > 0 || _filter.disabled.length > 0;
  }
  return _hasFilter;
}

/**
 * Returns true if the given namespace should be enabled based on DEBUG env var.
 *
 * - When DEBUG is not set → returns true (no filtering).
 * - When DEBUG is set → namespace must match at least one enabled pattern
 *   and must not match any disabled pattern.
 * - Disabled patterns take precedence over enabled patterns.
 */
export function isNamespaceEnabled(namespace: string): boolean {
  if (_filter === null) {
    _filter = parseDebugEnv();
    _hasFilter = _filter.enabled.length > 0 || _filter.disabled.length > 0;
  }

  if (!_hasFilter) return true;

  // Disabled patterns take precedence
  for (const re of _filter.disabled) {
    if (re.test(namespace)) return false;
  }

  // If only disabled patterns and no enabled patterns, everything not disabled passes
  if (_filter.enabled.length === 0) return true;

  // Must match at least one enabled pattern
  for (const re of _filter.enabled) {
    if (re.test(namespace)) return true;
  }

  return false;
}

/** Reset cached filter — for testing only. */
export function _resetDebugFilter(): void {
  _filter = null;
  _hasFilter = false;
}
