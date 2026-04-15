import type { LogLevelName } from './levels';
import type { KonsoleFormat } from './formatter';
import type { Serializers } from './serializers';

// ─── Timestamp configuration ─────────────────────────────────────────────────

/**
 * Preset timestamp formats or a custom formatting function.
 *
 * - `'iso'`      — `2024-06-15T10:23:45.123Z` (full ISO 8601, UTC)
 * - `'datetime'` — `2024-06-15 10:23:45.123` (local date + time)
 * - `'date'`     — `2024-06-15`
 * - `'time'`     — `10:23:45.123` (time-only, local)
 * - `'unix'`     — `1718446025` (epoch seconds)
 * - `'unixMs'`   — `1718446025123` (epoch milliseconds)
 * - `'none'`     — omit timestamp from formatted output
 * - `function`   — custom formatter receiving the Date (and optional hrTime ns offset)
 */
export type TimestampFormat =
  | 'iso'
  | 'datetime'
  | 'date'
  | 'time'
  | 'unix'
  | 'unixMs'
  | 'none'
  | ((date: Date, hrTime?: number) => string);

/**
 * Full timestamp configuration object.
 */
export interface TimestampOptions {
  /** Timestamp output format (default: `'datetime'` for pretty/text, `'iso'` for json). */
  format?: TimestampFormat;
  /**
   * Capture high-resolution timing via `performance.now()` (browser) or
   * `process.hrtime.bigint()` (Node.js). The value is stored on `LogEntry.hrTime`
   * as nanoseconds relative to process/page start.
   * @default false
   */
  highResolution?: boolean;
}

/**
 * Represents a single log entry stored in the circular buffer.
 */
export type LogEntry = {
  /** Primary log message (extracted from the first string argument). */
  msg: string;
  /** All original arguments passed to the log method (kept for backward compatibility). */
  messages: unknown[];
  /** Structured key-value fields merged from the call arguments. */
  fields: Record<string, unknown>;
  timestamp: Date;
  /**
   * High-resolution monotonic timestamp in nanoseconds (relative to process/page start).
   * Present only when `highResolution: true` is set in timestamp options.
   */
  hrTime?: number;
  namespace: string;
  level: LogLevelName;
  levelValue: number;
  /** @deprecated Use `level` instead. */
  logtype?: string;
};

/**
 * Wire-format for worker postMessage — timestamps are ISO strings, objects are pre-serialized.
 */
export type SerializableLogEntry = {
  msg: string;
  messages: unknown[];
  fields: Record<string, unknown>;
  timestamp: string;
  hrTime?: number;
  namespace: string;
  level: LogLevelName;
  levelValue: number;
  /** @deprecated */
  logtype?: string;
};

/**
 * Fine-grained output filter. Prefer `level` for simple threshold filtering.
 * @deprecated Boolean criteria will be removed in a future version. Use `level` or `format: 'silent'`.
 */
export type Criteria = boolean | ((logEntry: LogEntry) => boolean);

/**
 * Public interface for Konsole logger — safe to expose to untrusted code (e.g. via exposeToWindow).
 */
export interface KonsolePublic {
  viewLogs(batchSize?: number): void;
}

/**
 * Base interface all transport implementations must satisfy.
 *
 * A transport receives every log entry that passes the logger's level filter
 * and is responsible for delivering it to some destination (HTTP endpoint,
 * file, stdout, external stream, etc.).
 */
export interface Transport {
  /** Unique identifier used in logs and debug output. */
  readonly name: string;
  /** Called synchronously for each entry that passes all filters. */
  write(entry: LogEntry): void;
  /**
   * Flush any buffered entries.
   * Optional — implement only when the transport batches internally.
   */
  flush?(): Promise<void>;
  /** Flush and release all resources (timers, file handles, sockets). */
  destroy(): Promise<void>;
}

/**
 * Configuration for an HTTP transport that batches and ships logs to an external endpoint.
 */
export interface TransportConfig {
  /** Unique identifier for this transport */
  name: string;
  /** Endpoint URL to POST logs to */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT';
  /** Additional request headers */
  headers?: Record<string, string>;
  /** Number of entries to accumulate before flushing (default: 50) */
  batchSize?: number;
  /** Flush interval in ms (default: 10000) */
  flushInterval?: number;
  /** Retry attempts on failure with exponential backoff (default: 3) */
  retryAttempts?: number;
  /** Only send entries that pass this predicate */
  filter?: (entry: LogEntry) => boolean;
  /** Transform an entry before sending */
  transform?: (entry: LogEntry) => unknown;
  /**
   * Custom fetch implementation.
   * Required on Node.js < 18. Pass e.g. the default export of `node-fetch`.
   * Defaults to `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Configuration options for a Konsole logger instance.
 */
export interface KonsoleOptions {
  /** Logger namespace shown in every output line (default: 'Global') */
  namespace?: string;

  /**
   * Minimum log level to process. Entries below this level are discarded
   * immediately — they are neither stored nor output.
   * @default 'trace' (all levels pass through)
   */
  level?: LogLevelName;

  /**
   * Output format.
   * - `'auto'`    — selects based on environment (default)
   * - `'pretty'`  — colorized, human-readable (Node.js TTY)
   * - `'json'`    — newline-delimited JSON (pipes / log aggregators)
   * - `'text'`    — plain text, no ANSI (CI / log files)
   * - `'browser'` — styled DevTools output via `%c`
   * - `'silent'`  — no output; logs are still stored in memory
   * @default 'auto'
   */
  format?: KonsoleFormat;

  /**
   * Fine-grained output filter or legacy silent flag.
   * @deprecated Boolean `false` — use `format: 'silent'` instead.
   *             Boolean `true`  — omit this option (auto-output is now the default).
   *             Function filter — still fully supported.
   */
  criteria?: Criteria;

  /** Default batch size for `viewLogs()` (default: 100) */
  defaultBatchSize?: number;
  /** How long to keep log entries in ms (default: 48 hours) */
  retentionPeriod?: number;
  /** How often to run the retention cleanup in ms (default: 1 hour) */
  cleanupInterval?: number;
  /** Maximum entries to keep in the circular buffer (default: 10000) */
  maxLogs?: number;
  /**
   * Enable in-memory circular buffer for `getLogs()` / `viewLogs()`.
   *
   * - **Browser** (default: `true`) — logs stored for DevTools inspection via `exposeToWindow()`
   * - **Node.js** (default: `false`) — logs go to stdout/transports; no buffer overhead
   *
   * Set explicitly to override the environment default.
   */
  buffer?: boolean;
  /** Offload log storage to a worker thread — Web Worker (browser) or worker_threads (Node.js) (default: false) */
  useWorker?: boolean;
  /**
   * Transports to forward log entries to external destinations.
   * Accepts both `TransportConfig` plain objects (auto-wrapped in `HttpTransport`)
   * and concrete `Transport` instances (`ConsoleTransport`, `FileTransport`, etc.).
   */
  transports?: (Transport | TransportConfig)[];

  /**
   * Timestamp format configuration.
   *
   * Pass a preset string (`'iso'`, `'datetime'`, `'time'`, etc.), a custom
   * `(date, hrTime?) => string` function, or a full `TimestampOptions` object
   * for both format and high-resolution control.
   *
   * Defaults:
   * - Pretty / Text / Browser formatters → `'datetime'`
   * - JSON formatter                     → `'iso'`
   *
   * @example
   * ```ts
   * new Konsole({ timestamp: 'iso' })
   * new Konsole({ timestamp: { format: 'iso', highResolution: true } })
   * new Konsole({ timestamp: (d) => d.toLocaleString() })
   * ```
   */
  timestamp?: TimestampFormat | TimestampOptions;

  /**
   * Field paths to redact from every log entry before any output or transport.
   * Accepts dot-notation paths for nested fields.
   * Matched values are replaced with `'[REDACTED]'`.
   *
   * @example
   * ```ts
   * new Konsole({ redact: ['password', 'user.creditCard', 'req.headers.authorization'] })
   * ```
   */
  redact?: string[];

  /**
   * Field serializers applied to every log entry before output.
   *
   * Keys match field names; each function receives the raw field value and
   * its return value replaces the original. Use `stdSerializers` for
   * common cases (Error, HTTP req/res). Errors in any field are
   * auto-flattened even without an explicit serializer.
   *
   * @example
   * ```ts
   * import { Konsole, stdSerializers } from 'konsole-logger'
   * new Konsole({ serializers: { ...stdSerializers, user: (u) => ({ id: u.id }) } })
   * ```
   */
  serializers?: Serializers;
}

/**
 * Options accepted by `logger.child()`.
 */
export interface KonsoleChildOptions {
  /**
   * Override the namespace for this child logger.
   * Useful for labelling a subsystem: `logger.child({}, { namespace: 'App:DB' })`.
   * Defaults to the parent's namespace.
   */
  namespace?: string;
  /**
   * Override the minimum log level for this child.
   * Can only be equal to or more restrictive than the parent — a child cannot
   * log levels that the parent's buffer would discard.
   */
  level?: LogLevelName;
  /** Override the timestamp format for this child logger. */
  timestamp?: TimestampFormat | TimestampOptions;

  /**
   * Additional paths to redact in this child logger.
   * These are **merged** (union) with the parent's redact paths —
   * a child can never redact fewer fields than its parent.
   */
  redact?: string[];

  /**
   * Additional serializers merged on top of the parent's serializers.
   * Child serializers override parent entries with the same key.
   */
  serializers?: Serializers;
}

// ─── Worker message protocol ──────────────────────────────────────────────────

export type WorkerMessageType =
  | 'ADD_LOG'
  | 'GET_LOGS'
  | 'CLEAR_LOGS'
  | 'FLUSH_OLD'
  | 'CONFIGURE'
  | 'LOGS_RESPONSE'
  | 'FLUSH_TRANSPORT';

export interface WorkerMessage {
  type: WorkerMessageType;
  payload?: unknown;
  namespace?: string;
  requestId?: string;
}
