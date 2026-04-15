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
  if (!(err instanceof Error)) return err;

  const out: Record<string, unknown> = {
    type: err.name || 'Error',
    message: err.message,
    stack: err.stack,
  };

  for (const key of Object.keys(err)) {
    if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue;
    out[key] = (err as unknown as Record<string, unknown>)[key];
  }

  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) {
    out['cause'] = cause instanceof Error ? serializeError(cause) : cause;
  }

  return out;
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

export function serializeRequest(req: unknown): unknown {
  if (!req || typeof req !== 'object') return req;
  const r = req as ReqLike;
  const socket = r.socket || r.connection;
  return {
    method: r.method,
    url: r.originalUrl ?? r.url,
    headers: r.headers,
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
  let headers: Record<string, unknown> | undefined = r.headers;
  if (!headers && typeof r.getHeaders === 'function') {
    try { headers = r.getHeaders(); } catch { /* noop */ }
  }
  return {
    statusCode: r.statusCode ?? r.status,
    headers,
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
    const fn = serializers[k];
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
