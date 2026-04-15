/**
 * Field serializers — transform structured field values before output.
 *
 * A serializer is keyed by field name and receives the raw value. The return
 * value replaces the original in the emitted log entry.
 *
 * Built-in `stdSerializers` cover Errors and HTTP req/res objects, matching
 * Pino's conventions so existing dashboards keep working.
 */

export type Serializer = (value: unknown) => unknown;
export type Serializers = Record<string, Serializer>;

/**
 * Flattens an Error into a plain object that survives JSON.stringify.
 * Error properties (`name`, `message`, `stack`) are non-enumerable, so a naive
 * `JSON.stringify(err)` yields `"{}"` — this is the canonical fix.
 *
 * Handles nested `cause` chains (ES2022) and preserves any custom own
 * enumerable properties attached to the error.
 */
export function serializeError(err: unknown): unknown {
  return serializeErrorInner(err, undefined);
}

function serializeErrorInner(err: unknown, seen: WeakSet<object> | undefined): unknown {
  if (!(err instanceof Error)) return err;
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(err)) return '[Circular]';
  visited.add(err);

  try {
    const out: Record<string, unknown> = {
      type: err.name || 'Error',
      message: err.message,
      stack: err.stack,
    };

    for (const key of Object.keys(err)) {
      if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue;
      out[key] = sanitize((err as unknown as Record<string, unknown>)[key], visited);
    }

    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) {
      out['cause'] = cause instanceof Error
        ? serializeErrorInner(cause, visited)
        : sanitize(cause, visited);
    }

    return out;
  } finally {
    // Path-scoped: once we've walked this error's subtree, sibling branches
    // should be free to reference it again without triggering [Circular].
    visited.delete(err);
  }
}

/**
 * Deep-walks a value, producing a cycle-safe, JSON-stringify-ready copy.
 * - Circular references become the string `"[Circular]"`.
 * - Nested `Error` instances are expanded via `serializeErrorInner`.
 * - Primitives and functions pass through (functions will be dropped by JSON).
 *
 * Shared across the error-custom-prop path to ensure the serializer's contract
 * holds: the returned object survives `JSON.stringify` without throwing.
 */
function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return serializeErrorInner(value, seen);
  // Anything exposing toJSON (URL, Buffer, Decimal, Moment, Date, etc.) is
  // left to JSON.stringify, which will call toJSON and produce the canonical
  // form. Enumerating own keys here would return {} for URL and similar
  // objects that keep their state in internal slots.
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value;

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  try {
    // RegExp has no toJSON and its own state lives in internal slots, but it
    // CAN carry user-attached enumerable props which may form cycles. Emit
    // the canonical `/pattern/flags` form, merging any custom props on top.
    if (value instanceof RegExp) {
      const ownKeys = Object.keys(obj);
      if (ownKeys.length === 0) return value.toString();
      const out: Record<string, unknown> = Object.create(null);
      out.source = value.source;
      out.flags  = value.flags;
      for (const k of ownKeys) {
        out[k] = sanitize((value as unknown as Record<string, unknown>)[k], seen);
      }
      return out;
    }

    if (Array.isArray(value)) {
      const arr: unknown[] = new Array(value.length);
      for (let i = 0; i < value.length; i++) arr[i] = sanitize(value[i], seen);
      return arr;
    }

    // Use a null-prototype object so a source key named `__proto__` becomes
    // an own data property (assignment to `out.__proto__` on a normal object
    // would invoke the legacy prototype setter and silently drop the key).
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(obj)) {
      out[k] = sanitize((value as Record<string, unknown>)[k], seen);
    }
    return out;
  } finally {
    // Path-scoped cycle detection: only references on the current walk path
    // are treated as cycles. Repeated non-cyclic references in sibling
    // branches are preserved as full copies.
    seen.delete(obj);
  }
}

/** Minimal HTTP-request shape (Node http.IncomingMessage / Express req / Fetch Request). */
interface ReqLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, unknown>;
  remoteAddress?: string;
  remotePort?: number;
  socket?: { remoteAddress?: string; remotePort?: number };
  connection?: { remoteAddress?: string; remotePort?: number };
}

/**
 * Flattens Fetch/Web `Headers` (or any iterable header container) into a plain
 * object so downstream JSON output and redaction paths can see the values.
 * Plain objects are returned as-is.
 */
function normalizeHeaders(h: unknown): Record<string, unknown> | undefined {
  if (!h || typeof h !== 'object') return undefined;

  // Detect header containers by interface rather than constructor name so
  // that Headers subclasses, polyfills, and Map-like containers all flatten
  // correctly. Anything exposing a Headers/Map-shaped `forEach(value, key)`
  // (or equivalent `entries()` iterator) counts.
  const maybe = h as {
    forEach?: (cb: (v: unknown, k: unknown) => void) => void;
    entries?: () => Iterable<[unknown, unknown]>;
  };

  // Null-prototype output so a header literally named `__proto__` becomes an
  // own data property instead of invoking the legacy prototype setter (which
  // would drop the value from JSON/redaction output and mutate the result).
  if (typeof maybe.forEach === 'function') {
    try {
      const out: Record<string, unknown> = Object.create(null);
      let used = false;
      maybe.forEach.call(h, (v: unknown, k: unknown) => {
        if (typeof k === 'string') { out[k] = v; used = true; }
      });
      if (used) return out;
    } catch { /* fall through */ }
  }

  if (typeof maybe.entries === 'function') {
    try {
      const out: Record<string, unknown> = Object.create(null);
      let used = false;
      for (const pair of maybe.entries()) {
        if (Array.isArray(pair) && typeof pair[0] === 'string') {
          out[pair[0]] = pair[1];
          used = true;
        }
      }
      if (used) return out;
    } catch { /* fall through */ }
  }

  return h as Record<string, unknown>;
}

export function serializeRequest(req: unknown): unknown {
  if (!req || typeof req !== 'object') return req;
  const r = req as ReqLike;
  const socket = r.socket || r.connection;
  return {
    method: r.method,
    url: r.originalUrl ?? r.url,
    headers: normalizeHeaders(r.headers),
    remoteAddress: r.remoteAddress ?? socket?.remoteAddress,
    remotePort: socket?.remotePort,
  };
}

interface ResLike {
  statusCode?: number;
  status?: number;
  headers?: Record<string, unknown>;
  getHeaders?: () => Record<string, unknown>;
}

export function serializeResponse(res: unknown): unknown {
  if (!res || typeof res !== 'object') return res;
  const r = res as ResLike;
  let headers: unknown = r.headers;
  if (!headers && typeof r.getHeaders === 'function') {
    try { headers = r.getHeaders(); } catch { /* noop */ }
  }
  return {
    statusCode: r.statusCode ?? r.status,
    headers: normalizeHeaders(headers),
  };
}

/**
 * Standard serializers mirroring Pino's `stdSerializers`.
 *
 * - `err` — full Error with type/message/stack/cause (fixes `JSON.stringify(err) === "{}"`).
 * - `req` — HTTP request metadata.
 * - `res` — HTTP response metadata.
 */
export const stdSerializers: Serializers = {
  err: serializeError,
  req: serializeRequest,
  res: serializeResponse,
};

/**
 * Apply serializers to a fields object. Returns the same reference when no
 * serializer matches any field key — zero allocation on the hot path.
 *
 * Errors appearing under keys that have no explicit serializer are still
 * auto-flattened via `serializeError`, so `logger.info('x', { err })` and
 * `logger.info('x', { cause: new Error('y') })` both render fully.
 */
export function applySerializers(
  fields: Record<string, unknown>,
  serializers: Serializers,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  const keys = Object.keys(fields);

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const v = fields[k];
    // Only trust own keys on the serializer map — otherwise a field named
    // `hasOwnProperty`/`toString`/etc. would pick up Object.prototype methods
    // and either throw or rewrite legitimate values.
    const fn = Object.prototype.hasOwnProperty.call(serializers, k)
      ? serializers[k]
      : undefined;
    let next: unknown = v;

    if (fn) {
      next = fn(v);
    } else if (v instanceof Error) {
      next = serializeError(v);
    } else {
      continue;
    }

    if (out === null) {
      out = { ...fields };
    }
    out[k] = next;
  }

  return out ?? fields;
}
