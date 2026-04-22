import { CircularBuffer } from './CircularBuffer';
import { HttpTransport } from './transports/HttpTransport';
import { LEVELS, type LogLevelName } from './levels';
import { createFormatter, resolveTimestampConfig, type Formatter, type KonsoleFormat } from './formatter';
import { getHrTime, isBrowser } from './env';
import { createPlatformWorker, type KonsoleWorker } from './workerAdapter';
import { compileRedactPaths, applyRedaction } from './redact';
import { applySerializers, serializeError } from './serializers';
import { hasDebugFilter, isNamespaceEnabled } from './debugFilter';
import { enableContext, runWithContext, getContext, getActiveContext } from './context';
import type { Serializers } from './serializers';

/** JSON replacer that expands nested Errors (keeps stack/cause visible). */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  return value;
}
import type {
  LogEntry,
  Transport,
  SerializableLogEntry,
  Criteria,
  KonsolePublic,
  KonsoleOptions,
  KonsoleChildOptions,
  TransportConfig,
  TimestampFormat,
  TimestampOptions,
  WorkerMessage,
} from './types';

// Re-export types
export type { LogEntry, Transport, Criteria, KonsolePublic, KonsoleOptions, KonsoleChildOptions, TransportConfig };

/** Returns true when `t` is a plain `TransportConfig` object (not a Transport instance). */
function isTransportConfig(t: Transport | TransportConfig): t is TransportConfig {
  return typeof (t as TransportConfig).url === 'string';
}

// ─── Hot path constants ──────────────────────────────────────────────────────

/**
 * Sentinel for "no fields" in parseArgs fast path.
 * When this is the fields value AND buffer is disabled, we can skip
 * creating a new object. When buffer IS enabled, addLog replaces it
 * with a fresh `{}` so buffered entries don't share mutable state.
 */
const NO_FIELDS: Record<string, unknown> = Object.freeze(Object.create(null));

/** Shared frozen empty serializers map for the auto-Error-flattening fast path. */
const EMPTY_SERIALIZERS: Serializers = Object.freeze({});

/**
 * Empty function used to replace disabled log methods.
 * V8 does NOT create an arguments array when calling a function that doesn't
 * declare rest params — so `_logNoop('msg', {fields})` is truly zero-cost.
 */
function _logNoop() {}

/** Level values for fast comparison without LEVELS lookup. */
const LV_TRACE = 10;
const LV_DEBUG = 20;
const LV_INFO  = 30;
const LV_WARN  = 40;
const LV_ERROR = 50;
const LV_FATAL = 60;


/**
 * Konsole — a lightweight, namespaced logging library for browser and Node.js.
 *
 * @example
 * ```ts
 * import { Konsole } from 'konsole-logger';
 *
 * const logger = new Konsole({ namespace: 'API', level: 'info' });
 *
 * logger.info('Server started', { port: 3000 });
 * logger.error('Request failed', { err: new Error('timeout'), path: '/users' });
 * ```
 */
export class Konsole implements KonsolePublic {
  private static instances: Map<string, Konsole> = new Map();
  private static globalFlagName = '__KonsolePrintEnabled__';
  private static sharedWorker: KonsoleWorker | null = null;
  private static workerPendingCallbacks: Map<string, (logs: LogEntry[]) => void> = new Map();
  /** Browser-only runtime flag. When true, redaction is bypassed for all loggers. */
  private static _redactionDisabled: boolean = false;

  private logs: CircularBuffer<LogEntry>;
  private namespace: string;
  private _bindings: Record<string, unknown> = {};
  private criteria: Criteria;
  private formatter: Formatter;
  private currentFormat: KonsoleFormat;
  private timestampFormat: TimestampFormat;
  private highResolution: boolean;
  private _levelName: LogLevelName = 'trace';
  private minLevelValue: number;
  private defaultBatchSize: number;
  private currentBatchStart: number = 0;
  private retentionPeriod: number;
  private maxLogs: number;
  private cleanupIntervalId?: ReturnType<typeof setInterval>;
  private useWorker: boolean;
  private transports: Transport[] = [];

  /** Pre-compiled redaction path segments. Empty array = no redaction. */
  private _redactPaths: string[][] = [];

  /** Active field serializers. Empty object = no explicit serializers. */
  private _serializers: Serializers = {};
  /** Fast flag: at least one explicit serializer key is set. */
  private _hasSerializers: boolean = false;

  // ── Hot-path cached flags (avoid repeated checks per log call) ──
  private _hasBindings: boolean = false;
  private _isSilent: boolean = false;
  private _hasTransports: boolean = false;
  private _bufferEnabled: boolean = true;
  /** True when there are zero consumers — silent + no buffer + no transports + no worker. */
  private _isNoop: boolean = false;
  /** True when the logger was disabled by DEBUG env var filtering. Forces full noop. */
  private _debugDisabled: boolean = false;
  /** Cached bound log functions — created once per instance, reused by _rebindMethods. */
  private _bound!: {
    trace: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    info:  (...args: unknown[]) => void;
    warn:  (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    fatal: (...args: unknown[]) => void;
  };

  constructor(options: KonsoleOptions = {}) {
    const {
      namespace = 'Global',
      level = 'trace',
      format = 'auto',
      criteria = true,
      defaultBatchSize = 100,
      retentionPeriod = 48 * 60 * 60 * 1000, // 48 hours
      cleanupInterval = 60 * 60 * 1000,        // 1 hour
      maxLogs = 10000,
      buffer,
      useWorker = false,
      transports = [],
      timestamp,
      redact = [],
      serializers,
    } = options;

    const tsConfig = resolveTimestampConfig(timestamp);

    this.namespace        = namespace;
    this.criteria         = criteria;
    this._levelName       = level;
    this.minLevelValue    = LEVELS[level];
    this.currentFormat    = format;
    this.timestampFormat  = tsConfig.format;
    this.highResolution   = tsConfig.highResolution;
    this.formatter        = createFormatter(format, this.timestampFormat);
    this.defaultBatchSize = defaultBatchSize;
    this.retentionPeriod = retentionPeriod;
    this.maxLogs         = maxLogs;
    this.useWorker = useWorker;

    // Buffer defaults: on in browser (for getLogs/viewLogs/exposeToWindow), off in Node.js
    this._bufferEnabled = buffer ?? isBrowser;
    this.logs = new CircularBuffer<LogEntry>(this._bufferEnabled ? maxLogs : 0);
    this._isSilent = format === 'silent' || (typeof criteria === 'boolean' && !criteria);

    // DEBUG env var namespace filtering — fully disable loggers that don't match
    if (hasDebugFilter() && !isNamespaceEnabled(namespace)) {
      this._debugDisabled = true;
    }

    for (const t of transports) {
      this.transports.push(isTransportConfig(t) ? new HttpTransport(t) : t);
    }
    this._hasTransports = this.transports.length > 0;
    this._updateNoop();

    if (this.useWorker) {
      // Worker only supports HTTP transports — filter out custom Transport instances
      this.initWorker(transports.filter(isTransportConfig));
    }

    if (!this.useWorker && this._bufferEnabled) {
      this.cleanupIntervalId = setInterval(
        () => this.flushOldLogs(),
        cleanupInterval,
      );
    }

    this._redactPaths = compileRedactPaths(redact);

    if (serializers) {
      this._serializers = serializers;
      this._hasSerializers = Object.keys(serializers).length > 0;
    }

    this._createBoundMethods();
    this._rebindMethods();

    Konsole.instances.set(namespace, this);
    this.initGlobalFlag();
  }

  // ─── Static API ────────────────────────────────────────────────────────────

  /** Retrieve an existing logger by namespace. Creates a new one if not found. */
  static getLogger(namespace: string = 'Global'): Konsole {
    const instance = Konsole.instances.get(namespace);
    if (!instance) {
      console.warn(`[Konsole] Logger with namespace "${namespace}" not found, creating a new one.`);
      return new Konsole({ namespace });
    }
    return instance;
  }

  /** Returns the list of all registered namespace names. */
  static getNamespaces(): string[] {
    return Array.from(Konsole.instances.keys());
  }

  /**
   * Exposes a `__Konsole` debug handle on `window` for use in browser DevTools.
   *
   * @example
   * ```js
   * // In browser console:
   * __Konsole.getLogger('Auth').viewLogs()
   * __Konsole.listLoggers()
   * __Konsole.enableAll()
   * ```
   */
  static exposeToWindow(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__Konsole = {
      getLogger: (namespace: string = 'Global') => {
        const logger = Konsole.getLogger(namespace);
        return {
          viewLogs:     (batchSize?: number) => logger.viewLogs(batchSize),
          setTimestamp:  (opts: TimestampFormat | TimestampOptions) => logger.setTimestamp(opts),
          setLevel:      (level: LogLevelName) => logger.setLevel(level),
        };
      },
      listLoggers:  () => Array.from(Konsole.instances.keys()),
      enableAll:    () => Konsole.enableGlobalPrint(true),
      disableAll:   () => Konsole.enableGlobalPrint(false),
      setTimestamp: (opts: TimestampFormat | TimestampOptions) => {
        Konsole.instances.forEach((instance) => instance.setTimestamp(opts));
      },
      /**
       * Disable or re-enable field redaction at runtime (browser only).
       * Useful for debugging in DevTools — exposes redacted values in log output.
       *
       * @example
       * __Konsole.disableRedaction(true)   // show real values
       * __Konsole.disableRedaction(false)  // restore redaction (default)
       */
      disableRedaction: (disabled: boolean) => {
        Konsole._redactionDisabled = disabled;
      },
    };
  }

  /**
   * Globally override output for all loggers.
   * `true`  — forces all loggers to print regardless of their `level` / `criteria`.
   * `false` — restores normal per-logger rules (default).
   */
  static enableGlobalPrint(enabled: boolean): void {
    (globalThis as Record<string, unknown>)[Konsole.globalFlagName] = enabled;
    // Rebind all registered loggers — noop methods may need to become active (or vice versa)
    Konsole.instances.forEach((instance) => instance._rebindMethods());
  }

  /**
   * Flush and destroy all registered loggers.
   * Returns a promise that resolves when every transport has been drained.
   *
   * @example
   * ```ts
   * process.on('SIGTERM', async () => {
   *   await Konsole.shutdown();
   *   process.exit(0);
   * });
   * ```
   */
  static async shutdown(): Promise<void> {
    const instances = Array.from(Konsole.instances.values());
    await Promise.all(instances.map((i) => i.flushTransports()));
    await Promise.all(instances.map((i) => i.destroy()));
  }

  /** Whether shutdown hooks have already been registered (prevents double-registration). */
  private static _hooksRegistered = false;

  /**
   * Register `SIGTERM`, `SIGINT`, and `beforeExit` handlers that automatically
   * flush all transports before the process exits. Node.js only — no-op in browsers.
   *
   * Safe to call multiple times; handlers are registered at most once.
   *
   * @example
   * ```ts
   * Konsole.enableShutdownHook();
   * ```
   */
  static enableShutdownHook(): void {
    if (Konsole._hooksRegistered) return;
    if (typeof process === 'undefined' || typeof process.on !== 'function') return;

    Konsole._hooksRegistered = true;

    const onShutdown = (signal: string) => {
      Konsole.shutdown().finally(() => {
        process.exit(signal === 'SIGTERM' ? 143 : 130);
      });
    };

    process.on('SIGTERM', () => onShutdown('SIGTERM'));
    process.on('SIGINT',  () => onShutdown('SIGINT'));
    process.on('beforeExit', () => {
      Konsole.shutdown().catch(() => {});
    });
  }

  /** Add an HTTP transport to every registered logger. */
  static addGlobalTransport(config: TransportConfig): void {
    Konsole.instances.forEach((instance) => instance.addTransport(config));
  }

  // ─── Async context propagation (Node.js) ──────────────────────────────────
  //
  // AsyncLocalStorage-backed scope binding. Call `enableContext()` once at
  // startup, then wrap request-scoped work in `runWithContext(store, fn)` —
  // every log entry inside the scope auto-merges `store` into its fields.
  // Browser: `runWithContext` just invokes `fn()`; context is a no-op.
  //
  // @example
  // ```ts
  // await Konsole.enableContext();
  //
  // app.use((req, _res, next) => {
  //   Konsole.runWithContext({ requestId: req.id }, () => next());
  // });
  // ```

  /** Initialize `AsyncLocalStorage` for context propagation. Node.js only; no-op in browsers. */
  static enableContext = enableContext;
  /** Run `fn` in a scope whose `store` is auto-merged into every log entry produced inside it. */
  static runWithContext = runWithContext;
  /** Read the current context store, or `undefined` if none is active. */
  static getContext = getContext;

  // ─── Child loggers ─────────────────────────────────────────────────────────

  /**
   * Creates a child logger that inherits this logger's config and prepends
   * `bindings` to every log entry it produces.
   *
   * Bindings accumulate through nested children. Call-site fields always win
   * over bindings on key collision.
   *
   * Children share the parent's circular buffer and formatter.
   * They are NOT registered in `Konsole.instances` — they are ephemeral.
   *
   * @example
   * ```ts
   * // Per-request logger
   * const req = logger.child({ requestId: 'abc', ip: '1.2.3.4' });
   * req.info('request started', { path: '/users' });
   * // → INF [App]  request started  requestId=abc ip=1.2.3.4 path=/users
   *
   * // Nested child — bindings accumulate
   * const db = req.child({ component: 'db' }, { namespace: 'App:DB' });
   * db.debug('query', { sql: 'SELECT...', ms: 4 });
   * // → DBG [App:DB]  query  requestId=abc ip=1.2.3.4 component=db sql="SELECT..." ms=4
   * ```
   */
  child(bindings: Record<string, unknown>, options?: KonsoleChildOptions): Konsole {
    return Konsole.createChild(this, bindings, options);
  }

  /**
   * Factory that bypasses the normal constructor to produce a child logger
   * that shares the parent's buffer, formatter, and transports.
   */
  private static createChild(
    parent: Konsole,
    bindings: Record<string, unknown>,
    options?: KonsoleChildOptions,
  ): Konsole {
    // Object.create skips the constructor — we set every field manually.
    const child = Object.create(Konsole.prototype) as Konsole;

    // ── Shared references (mutations in parent are visible in child and vice-versa) ──
    child.logs      = parent.logs;      // same circular buffer
    child.useWorker = parent.useWorker;

    // ── Separate array, same Transport instances (child.addTransport won't affect parent) ──
    child.transports = [...parent.transports];

    // ── Inherited scalar values (copied, not shared) ──
    child.criteria        = parent.criteria;
    child.defaultBatchSize = parent.defaultBatchSize;
    child.retentionPeriod = parent.retentionPeriod;
    child.maxLogs         = parent.maxLogs;
    child.currentFormat   = parent.currentFormat;

    // ── Overridable per-child values ──
    child.namespace     = options?.namespace ?? parent.namespace;
    child._levelName    = options?.level ?? parent._levelName;
    child.minLevelValue = options?.level ? LEVELS[options.level] : parent.minLevelValue;

    // ── Timestamp config (override or inherit) ──
    if (options?.timestamp) {
      const tsConfig = resolveTimestampConfig(options.timestamp);
      child.timestampFormat = tsConfig.format;
      child.highResolution  = tsConfig.highResolution;
      child.formatter       = createFormatter(parent.currentFormat, tsConfig.format);
    } else {
      child.timestampFormat = parent.timestampFormat;
      child.highResolution  = parent.highResolution;
      child.formatter       = parent.formatter; // shared reference (existing behavior)
    }

    // ── Redact paths: child inherits parent paths, optionally adds more (union, deduplicated) ──
    const parentPathStrs = parent._redactPaths.map((segs) => segs.join('.'));
    const childPathStrs  = options?.redact ?? [];
    const mergedPaths    = [...new Set([...parentPathStrs, ...childPathStrs])];
    child._redactPaths   = compileRedactPaths(mergedPaths);

    // ── Serializers: child merges on top of parent (child keys win) ──
    if (options?.serializers) {
      child._serializers = { ...parent._serializers, ...options.serializers };
    } else {
      child._serializers = parent._serializers;
    }
    child._hasSerializers = Object.keys(child._serializers).length > 0;

    // ── Child-own state ──
    child._bindings         = { ...parent._bindings, ...bindings }; // bindings accumulate
    child._hasBindings      = Object.keys(child._bindings).length > 0;
    child._isSilent         = parent._isSilent;
    child._debugDisabled    = parent._debugDisabled;

    // DEBUG env var: child with a different namespace may need its own filter check
    if (options?.namespace && hasDebugFilter()) {
      child._debugDisabled = !isNamespaceEnabled(child.namespace);
    }

    child._hasTransports    = child.transports.length > 0;
    child._bufferEnabled    = parent._bufferEnabled;
    child._updateNoop();
    child._createBoundMethods();
    child._rebindMethods();
    child.currentBatchStart = 0;
    // No cleanupIntervalId — the root logger owns retention cleanup

    return child;
  }

  // ─── Logging methods ───────────────────────────────────────────────────────
  //
  // These prototype methods serve as fallbacks and provide TypeScript signatures.
  // _rebindMethods() overwrites them with own-property functions (either _logNoop
  // or the cached bound function) for Pino-style zero-cost disabled methods.

  /** Level 10 — extremely verbose, disabled in most environments. */
  trace(...args: unknown[]): void { this.addLog('trace', args); }

  /** Level 20 — developer-facing detail, hidden at `level: 'info'` and above. */
  debug(...args: unknown[]): void { this.addLog('debug', args); }

  /** Level 30 — general informational messages. */
  info(...args: unknown[]): void { this.addLog('info', args); }

  /** Level 30 — alias for `info()` (backward compatibility). */
  log(...args: unknown[]): void { this.addLog('info', args); }

  /** Level 40 — something unexpected but recoverable. */
  warn(...args: unknown[]): void { this.addLog('warn', args); }

  /** Level 50 — an operation failed; written to stderr. */
  error(...args: unknown[]): void { this.addLog('error', args); }

  /** Level 60 — unrecoverable failure; written to stderr. */
  fatal(...args: unknown[]): void { this.addLog('fatal', args); }

  // ─── Instance management ───────────────────────────────────────────────────

  /** Update the minimum log level at runtime. */
  setLevel(level: LogLevelName): void {
    this._levelName = level;
    this.minLevelValue = LEVELS[level];
    this._rebindMethods();
  }

  /**
   * Returns the current minimum log level name.
   * Pino-compatible property — use `logger.level` to read or write.
   */
  get level(): LogLevelName {
    return this._levelName;
  }

  /**
   * Sets the minimum log level at runtime.
   * Pino-compatible property — equivalent to `setLevel()`.
   */
  set level(level: LogLevelName) {
    this.setLevel(level);
  }

  /**
   * Check whether a given level would produce output at the current threshold.
   *
   * @example
   * ```ts
   * if (logger.isLevelEnabled('debug')) {
   *   logger.debug('expensive computation', { result: compute() });
   * }
   * ```
   */
  isLevelEnabled(level: LogLevelName): boolean {
    return LEVELS[level] >= this.minLevelValue;
  }

  /**
   * Returns a shallow copy of the current accumulated bindings.
   * Root loggers return `{}`; child loggers return the merged parent+child bindings.
   */
  bindings(): Record<string, unknown> {
    return { ...this._bindings };
  }

  /**
   * Flush all pending transport batches immediately.
   * Alias for `flushTransports()` — Pino-compatible naming.
   */
  async flush(): Promise<void> {
    return this.flushTransports();
  }

  /** Update the fine-grained criteria filter. @deprecated Prefer `setLevel()`. */
  setCriteria(criteria: Criteria): void {
    this.criteria = criteria;
    this._isSilent = typeof criteria === 'boolean' && !criteria;
    this._updateNoop();
    this._rebindMethods();
  }

  /**
   * Update the timestamp format at runtime. Recreates the internal formatter.
   *
   * @example
   * ```ts
   * logger.setTimestamp('iso');
   * logger.setTimestamp({ format: 'iso', highResolution: true });
   * logger.setTimestamp((d) => d.toLocaleString());
   * ```
   */
  setTimestamp(opts: TimestampFormat | TimestampOptions): void {
    const resolved = resolveTimestampConfig(opts);
    this.timestampFormat = resolved.format;
    this.highResolution  = resolved.highResolution;
    this.formatter       = createFormatter(this.currentFormat, this.timestampFormat);
  }

  /**
   * Add a transport to this logger.
   * Accepts both a `TransportConfig` plain object (auto-wrapped in `HttpTransport`)
   * and a concrete `Transport` instance (`ConsoleTransport`, `FileTransport`, etc.).
   */
  addTransport(transport: Transport | TransportConfig): void {
    this.transports.push(isTransportConfig(transport) ? new HttpTransport(transport) : transport);
    this._hasTransports = true;
    this._isNoop = false;
  }

  /** Flush all pending transport batches immediately. */
  async flushTransports(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.flush?.()));
  }

  // ─── Log retrieval ─────────────────────────────────────────────────────────

  /** Print stored logs in batches using `console.table`. Primarily a browser dev tool. */
  viewLogs(batchSize: number = this.defaultBatchSize): void {
    const allLogs = this.logs.toArray();

    if (this.currentBatchStart >= allLogs.length) {
      console.log('[Konsole] No more logs.');
      this.currentBatchStart = 0;
      return;
    }

    const batchEnd = Math.min(this.currentBatchStart + batchSize, allLogs.length);
    const batch    = allLogs.slice(this.currentBatchStart, batchEnd);

    const formatted = batch.map((e) => ({
      time:      e.timestamp.toISOString(),
      level:     e.level,
      namespace: e.namespace,
      msg:       e.msg,
      fields:    Object.keys(e.fields).length ? JSON.stringify(e.fields) : '',
    }));

    console.table(formatted);
    this.currentBatchStart = batchEnd;

    if (this.currentBatchStart >= allLogs.length) {
      console.log('[Konsole] End of logs. Call viewLogs() again to restart.');
    }
  }

  /** Returns all stored log entries as a readonly array. */
  getLogs(): ReadonlyArray<LogEntry> {
    return this.logs.toArray();
  }

  /** Returns stored log entries asynchronously (resolves from the worker when `useWorker: true`). */
  getLogsAsync(): Promise<ReadonlyArray<LogEntry>> {
    if (this.useWorker && Konsole.sharedWorker) {
      return new Promise((resolve) => {
        const requestId = `${this.namespace}-${Date.now()}-${Math.random()}`;
        Konsole.workerPendingCallbacks.set(requestId, resolve);
        Konsole.sharedWorker?.postMessage({
          type: 'GET_LOGS',
          namespace: this.namespace,
          requestId,
        });
      });
    }
    return Promise.resolve(this.getLogs());
  }

  /** Discard all stored log entries. */
  clearLogs(): void {
    this.logs.clear();
    this.currentBatchStart = 0;

    if (this.useWorker && Konsole.sharedWorker) {
      Konsole.sharedWorker.postMessage({ type: 'CLEAR_LOGS', namespace: this.namespace });
    }
  }

  /** Reset the `viewLogs()` pagination cursor back to the beginning. */
  resetBatch(): void {
    this.currentBatchStart = 0;
  }

  /** Returns memory usage statistics for this logger's buffer. */
  getStats(): { logCount: number; maxLogs: number; memoryUsage: string } {
    const logCount = this.logs.size;
    return {
      logCount,
      maxLogs: this.maxLogs,
      memoryUsage: `${logCount}/${this.maxLogs} (${((logCount / this.maxLogs) * 100).toFixed(1)}%)`,
    };
  }

  /** Flush transports and remove this logger from the registry. */
  async destroy(): Promise<void> {
    if (this.cleanupIntervalId) clearInterval(this.cleanupIntervalId);
    await Promise.all(this.transports.map((t) => t.destroy()));
    Konsole.instances.delete(this.namespace);
  }

  // ─── Private internals ─────────────────────────────────────────────────────

  /**
   * Parses log call arguments into a structured { msg, fields } pair.
   * The two most common calling conventions are inlined in addLog() for speed;
   * this method handles the remaining (less common) patterns.
   */
  private parseArgsSlow(args: unknown[]): { msg: string; fields: Record<string, unknown> } {
    if (args.length === 0) return { msg: '', fields: NO_FIELDS };

    const first = args[0];

    // Error as the sole first argument
    if (first instanceof Error) {
      return { msg: first.message, fields: { err: first } };
    }

    // Pino-style: first arg is a plain object containing a `msg` key
    if (
      typeof first === 'object' &&
      first !== null &&
      !Array.isArray(first) &&
      !(first instanceof Error) &&
      'msg' in first
    ) {
      const { msg, ...rest } = first as Record<string, unknown>;
      return { msg: String(msg), fields: rest };
    }

    // Single string — already handled in fast path, but guard anyway
    if (args.length === 1 && typeof first === 'string') {
      return { msg: first, fields: NO_FIELDS };
    }

    // Multiple args — join as a single message string. Errors are expanded
    // via `serializeError` (raw `JSON.stringify(err)` would yield "{}").
    return {
      msg: args.map((a) => {
        if (a instanceof Error) {
          try { return JSON.stringify(serializeError(a)); } catch { return a.message; }
        }
        if (typeof a === 'object' && a !== null) {
          try { return JSON.stringify(a, jsonReplacer); } catch { return '[Circular]'; }
        }
        return String(a);
      }).join(' '),
      fields: NO_FIELDS,
    };
  }

  private addLog(level: LogLevelName, args: unknown[]): void {
    // Note: level check and noop check are handled by _rebindMethods —
    // disabled methods are replaced with _logNoop and never reach here.

    // ── Fast-path argument parsing ──────────────────────────────────────────
    // Inline the two most common calling conventions to avoid the full
    // parseArgs cascade and its intermediate object allocation.
    let msg: string;
    let fields: Record<string, unknown>;

    const first = args[0];

    if (typeof first === 'string') {
      if (args.length === 1) {
        // logger.info('message') — most common case
        msg = first;
        fields = NO_FIELDS;
      } else if (
        args.length === 2 &&
        typeof args[1] === 'object' &&
        args[1] !== null &&
        !Array.isArray(args[1]) &&
        !(args[1] instanceof Error)
      ) {
        // logger.info('message', { userId: 1 }) — second most common
        msg = first;
        fields = args[1] as Record<string, unknown>;
      } else {
        ({ msg, fields } = this.parseArgsSlow(args));
      }
    } else {
      ({ msg, fields } = this.parseArgsSlow(args));
    }

    // ── Merge ALS context + bindings + call-site fields ─────────────────────
    // Precedence (low → high): ALS context < child bindings < call-site fields.
    // getActiveContext is null-fast when no-one has ever called runWithContext.
    const ctx = getActiveContext();
    let mergedFields: Record<string, unknown>;
    if (ctx) {
      mergedFields = this._hasBindings
        ? { ...ctx, ...this._bindings, ...fields }
        : (fields === NO_FIELDS ? { ...ctx } : { ...ctx, ...fields });
    } else {
      mergedFields = this._hasBindings
        ? { ...this._bindings, ...fields }
        : fields;
    }

    // ── Apply serializers (explicit map + auto Error flattening) ────────────
    if (this._hasSerializers) {
      mergedFields = applySerializers(mergedFields, this._serializers);
    } else if (mergedFields !== NO_FIELDS) {
      // Even with no explicit serializers, flatten Errors so they don't JSON
      // to "{}" downstream. `applySerializers` is a no-op copy when no field
      // contains an Error, so this stays cheap on the hot path.
      mergedFields = applySerializers(mergedFields, EMPTY_SERIALIZERS);
    }

    // ── Build entry ─────────────────────────────────────────────────────────
    // When buffered, ensure fields is a unique object (not the shared NO_FIELDS sentinel)
    // so user code reading getLogs() can safely mutate entries.
    const entryFields = (this._bufferEnabled && mergedFields === NO_FIELDS) ? {} : mergedFields;

    const rawEntry: LogEntry = {
      msg,
      messages: args,
      fields: entryFields,
      timestamp: new Date(),
      hrTime: this.highResolution ? getHrTime() : undefined,
      namespace: this.namespace,
      level,
      levelValue: LEVELS[level],
    };

    // Apply redaction before any consumer sees the entry.
    // The disable flag is only settable via window.__Konsole (browser-only API),
    // so in Node.js _redactionDisabled is always false.
    const entry = this._redactPaths.length > 0 && !Konsole._redactionDisabled
      ? applyRedaction(rawEntry, this._redactPaths)
      : rawEntry;

    // Store in the main-thread circular buffer (browser only by default)
    if (this._bufferEnabled) {
      this.logs.push(entry);
    }

    // Forward to worker when enabled
    if (this.useWorker && Konsole.sharedWorker) {
      const serializable: SerializableLogEntry = {
        msg,
        messages: args.map((m) => (typeof m === 'object' ? JSON.stringify(m) : m)),
        fields: entry.fields,
        timestamp: entry.timestamp.toISOString(),
        hrTime: entry.hrTime,
        namespace: this.namespace,
        level,
        levelValue: LEVELS[level],
      };
      Konsole.sharedWorker.postMessage({
        type: 'ADD_LOG',
        namespace: this.namespace,
        payload: serializable,
      });
    }

    // Forward to transports (when not using worker)
    if (this._hasTransports && !this.useWorker) {
      for (const transport of this.transports) {
        transport.write(entry);
      }
    }

    // ── Output ──────────────────────────────────────────────────────────────
    if (this._isSilent) {
      if ((globalThis as Record<string, unknown>)[Konsole.globalFlagName] === true) {
        this.formatter.write(entry);
      }
      return;
    }

    if (typeof this.criteria === 'function' && !this.criteria(entry)) return;
    this.formatter.write(entry);
  }

  private _updateNoop(): void {
    this._isNoop = this._debugDisabled || (this._isSilent && !this._bufferEnabled && !this._hasTransports && !this.useWorker);
  }

  /** Create cached bound log functions — one set per instance, reused by _rebindMethods. */
  private _createBoundMethods(): void {
    this._bound = {
      trace: (...args: unknown[]) => { this.addLog('trace', args); },
      debug: (...args: unknown[]) => { this.addLog('debug', args); },
      info:  (...args: unknown[]) => { this.addLog('info', args); },
      warn:  (...args: unknown[]) => { this.addLog('warn', args); },
      error: (...args: unknown[]) => { this.addLog('error', args); },
      fatal: (...args: unknown[]) => { this.addLog('fatal', args); },
    };
  }

  /**
   * Pino-style method replacement.
   * Disabled methods become `_logNoop` (empty function — V8 skips arg array creation).
   * Enabled methods become the cached bound function from `_bound`.
   * Called when level, transports, or noop state changes.
   */
  private _rebindMethods(): void {
    // Global override forces all methods active (even on noop loggers)
    const globalOverride = (globalThis as Record<string, unknown>)[Konsole.globalFlagName] === true;
    const isNoop = this._isNoop && !globalOverride;
    const min = globalOverride ? 0 : this.minLevelValue;

    this.trace = (isNoop || LV_TRACE < min) ? _logNoop as typeof this.trace : this._bound.trace;
    this.debug = (isNoop || LV_DEBUG < min) ? _logNoop as typeof this.debug : this._bound.debug;
    this.info  = (isNoop || LV_INFO  < min) ? _logNoop as typeof this.info  : this._bound.info;
    this.warn  = (isNoop || LV_WARN  < min) ? _logNoop as typeof this.warn  : this._bound.warn;
    this.error = (isNoop || LV_ERROR < min) ? _logNoop as typeof this.error : this._bound.error;
    this.fatal = (isNoop || LV_FATAL < min) ? _logNoop as typeof this.fatal : this._bound.fatal;
    this.log   = this.info;
  }

  private initGlobalFlag(): void {
    if (!(Konsole.globalFlagName in globalThis)) {
      (globalThis as Record<string, unknown>)[Konsole.globalFlagName] = false;
    }
  }

  private flushOldLogs(): void {
    const cutoff = new Date(Date.now() - this.retentionPeriod);
    // Accessing log.timestamp triggers the lazy getter if not yet materialized
    this.logs.retain((log) => log.timestamp > cutoff);
  }

  // ─── Worker setup ──────────────────────────────────────────────────────────

  private initWorker(transports: TransportConfig[]): void {
    if (!Konsole.sharedWorker) {
      const worker = createPlatformWorker(this.getWorkerCode());

      if (!worker) {
        console.warn('[Konsole] Failed to initialize worker, falling back to main thread.');
        this.useWorker = false;
        return;
      }

      Konsole.sharedWorker = worker;

      Konsole.sharedWorker.onmessage = (event: { data: unknown }) => {
        const { type, payload, requestId } = event.data as WorkerMessage;
        if (type === 'LOGS_RESPONSE' && requestId) {
          const callback = Konsole.workerPendingCallbacks.get(requestId);
          if (callback) {
            const logs = (payload as SerializableLogEntry[]).map((e) => ({
              ...e,
              timestamp: new Date(e.timestamp),
              hrTime: e.hrTime,
            }));
            callback(logs);
            Konsole.workerPendingCallbacks.delete(requestId);
          }
        }
      };
    }

    Konsole.sharedWorker?.postMessage({
      type: 'CONFIGURE',
      namespace: this.namespace,
      payload: {
        maxLogs: this.maxLogs,
        retentionPeriod: this.retentionPeriod,
        transports: transports.map((t) => ({
          name:          t.name,
          url:           t.url,
          method:        t.method,
          headers:       t.headers,
          batchSize:     t.batchSize,
          flushInterval: t.flushInterval,
          retryAttempts: t.retryAttempts,
        })),
      },
    });
  }

  private getWorkerCode(): string {
    return `
      const logBuffers    = new Map();
      const bufferConfigs = new Map();
      const transports    = new Map();

      class CircularBuffer {
        constructor(capacity) {
          this.capacity = capacity;
          this.buffer   = new Array(capacity);
          this.head     = 0;
          this.tail     = 0;
          this._size    = 0;
        }
        push(item) {
          this.buffer[this.tail] = item;
          this.tail = (this.tail + 1) % this.capacity;
          if (this._size < this.capacity) { this._size++; }
          else { this.head = (this.head + 1) % this.capacity; }
        }
        toArray() {
          const out = [];
          for (let i = 0; i < this._size; i++) {
            const item = this.buffer[(this.head + i) % this.capacity];
            if (item !== undefined) out.push(item);
          }
          return out;
        }
        retain(fn) {
          const kept = this.toArray().filter(fn);
          this.clear();
          kept.forEach(item => this.push(item));
          return this._size;
        }
        clear() {
          this.buffer = new Array(this.capacity);
          this.head = this.tail = this._size = 0;
        }
        get size() { return this._size; }
      }

      function getBuffer(ns) {
        let buf = logBuffers.get(ns);
        if (!buf) {
          const cfg = bufferConfigs.get(ns) || { maxLogs: 10000 };
          buf = new CircularBuffer(cfg.maxLogs);
          logBuffers.set(ns, buf);
        }
        return buf;
      }

      async function flush(t) {
        if (!t.batch.length) return;
        const batch  = t.batch.splice(0);
        try {
          await fetch(t.cfg.url, {
            method:  t.cfg.method || 'POST',
            headers: { 'Content-Type': 'application/json', ...(t.cfg.headers || {}) },
            body:    JSON.stringify({ transport: t.cfg.name, logs: batch, sentAt: new Date().toISOString() }),
          });
        } catch (e) { console.warn('[Konsole Worker]', e); }
      }

      self.onmessage = ({ data: { type, payload, namespace: ns, requestId } }) => {
        switch (type) {
          case 'ADD_LOG':
            if (ns && payload) {
              getBuffer(ns).push(payload);
              transports.forEach(t => {
                t.batch.push(payload);
                if (t.batch.length >= (t.cfg.batchSize || 50)) flush(t);
              });
            }
            break;
          case 'GET_LOGS':
            if (ns) self.postMessage({ type: 'LOGS_RESPONSE', payload: (logBuffers.get(ns) || { toArray: () => [] }).toArray(), ns, requestId });
            break;
          case 'CLEAR_LOGS':
            if (ns) { const b = logBuffers.get(ns); if (b) b.clear(); }
            break;
          case 'FLUSH_OLD':
            if (ns) {
              const b = logBuffers.get(ns), cfg = bufferConfigs.get(ns);
              if (b && cfg) { const cut = new Date(Date.now() - cfg.retentionPeriod).toISOString(); b.retain(e => e.timestamp > cut); }
            }
            break;
          case 'CONFIGURE':
            if (ns && payload) {
              bufferConfigs.set(ns, payload);
              (payload.transports || []).forEach(tc => {
                const t = { cfg: tc, batch: [] };
                t.timer = setInterval(() => flush(t), tc.flushInterval || 10000);
                transports.set(tc.name, t);
              });
            }
            break;
        }
      };

      setInterval(() => {
        logBuffers.forEach((buf, ns) => {
          const cfg = bufferConfigs.get(ns);
          if (cfg) { const cut = new Date(Date.now() - cfg.retentionPeriod).toISOString(); buf.retain(e => e.timestamp > cut); }
        });
      }, 3600000);
    `;
  }
}

export default Konsole;
