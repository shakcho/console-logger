# Konsole Class

The main logging class. Works in browser and Node.js.

## Constructor

```typescript
new Konsole(options?: KonsoleOptions)
```

### Example

```typescript
import { Konsole } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'MyApp',
  level: 'info',
  format: 'auto',
  maxLogs: 5000,
});
```

---

## Static Methods

### getLogger

```typescript
static getLogger(namespace?: string): Konsole
```

Gets an existing logger by namespace. Creates a new one with a warning if the namespace is not found.

**Parameters:**
- `namespace` — Namespace to look up (default: `'Global'`)

**Example:**
```typescript
const logger = Konsole.getLogger('Auth');
```

---

### getNamespaces

```typescript
static getNamespaces(): string[]
```

Returns all registered namespace names.

**Example:**
```typescript
Konsole.getNamespaces(); // ['Auth', 'API', 'DB']
```

---

### exposeToWindow

```typescript
static exposeToWindow(): void
```

Exposes a `__Konsole` debug handle on `window` for use in browser DevTools. No-op in Node.js.

**Example:**
```typescript
Konsole.exposeToWindow();

// In browser console:
// __Konsole.getLogger('Auth').viewLogs()
// __Konsole.getLogger('Auth').setTimestamp('iso')
// __Konsole.listLoggers()
// __Konsole.enableAll()
// __Konsole.setTimestamp('iso')   // change all loggers
// __Konsole.disableRedaction(true)  // bypass redaction for debugging
```

---

### enableGlobalPrint

```typescript
static enableGlobalPrint(enabled: boolean): void
```

When `true`, forces all loggers to produce output regardless of their individual `format` or `criteria` settings. Stored on `globalThis` — works in both environments.

**Example:**
```typescript
Konsole.enableGlobalPrint(true);  // All logs print
Konsole.enableGlobalPrint(false); // Restore normal rules
```

---

### shutdown

```typescript
static shutdown(): Promise<void>
```

Flushes and destroys all registered loggers. Returns a promise that resolves when every transport has been drained.

**Example:**
```typescript
process.on('SIGTERM', async () => {
  await Konsole.shutdown();
  process.exit(0);
});
```

---

### enableShutdownHook

```typescript
static enableShutdownHook(): void
```

Registers `SIGTERM`, `SIGINT`, and `beforeExit` handlers that automatically flush all transports before the process exits. Node.js only — no-op in browsers. Safe to call multiple times; handlers are registered at most once.

**Example:**
```typescript
Konsole.enableShutdownHook();
```

---

### addGlobalTransport

```typescript
static addGlobalTransport(config: TransportConfig): void
```

Adds an HTTP transport to every currently registered logger.

**Example:**
```typescript
Konsole.addGlobalTransport({
  name: 'sentry',
  url: 'https://sentry.io/api/123/store/',
  filter: (entry) => entry.level === 'error',
});
```

---

## Instance Methods — Logging

### trace

```typescript
trace(...args: unknown[]): void
```

Level 10. Extremely verbose; disabled by default at `level: 'debug'` and above.

---

### debug

```typescript
debug(...args: unknown[]): void
```

Level 20. Developer-facing detail; hidden at `level: 'info'` and above.

---

### info

```typescript
info(...args: unknown[]): void
```

Level 30. General informational messages.

---

### log

```typescript
log(...args: unknown[]): void
```

Alias for `info()`. Level 30.

---

### warn

```typescript
warn(...args: unknown[]): void
```

Level 40. Something unexpected but recoverable.

---

### error

```typescript
error(...args: unknown[]): void
```

Level 50. An operation failed. Written to `stderr` in Node.js.

---

### fatal

```typescript
fatal(...args: unknown[]): void
```

Level 60. Unrecoverable failure. Written to `stderr` in Node.js.

---

### Calling conventions

All log methods accept four argument styles:

```typescript
// 1. Simple string
logger.info('Server started');

// 2. String + fields object (recommended)
logger.info('Request received', { method: 'GET', path: '/users', ms: 42 });

// 3. Object-first: object with msg key
logger.info({ msg: 'Request received', method: 'GET', path: '/users' });

// 4. Error — message extracted, error stored in fields.err
logger.error(new Error('Connection refused'));
```

---

## Instance Methods — Child Loggers

### child

```typescript
child(bindings: Record<string, unknown>, options?: KonsoleChildOptions): Konsole
```

Creates a child logger that inherits this logger's level, format, transports, and circular buffer. `bindings` are merged into every log entry the child produces. Bindings accumulate through nested children; call-site fields override bindings on key collision.

Children are **not** registered in `Konsole.instances`.

**Parameters:**
- `bindings` — Key-value pairs attached to every entry
- `options.namespace` — Override namespace (default: parent's namespace)
- `options.level` — Override minimum level (default: parent's level)
- `options.timestamp` — Override timestamp format (default: parent's format)
- `options.redact` — Additional field paths to redact (merged with parent's — see [Redaction](/guide/redaction))

**Example:**
```typescript
const req = logger.child({ requestId: 'abc', ip: '1.2.3.4' });
req.info('Request started', { path: '/users' });
// → INF  [App]  Request started  requestId=abc ip=1.2.3.4 path=/users

const db = req.child({ component: 'db' }, { namespace: 'App:DB' });
db.debug('Query', { sql: 'SELECT...', ms: 4 });
// → DBG  [App:DB]  Query  requestId=abc ip=1.2.3.4 component=db sql="SELECT..." ms=4
```

---

## Instance Methods — Configuration

### setLevel

```typescript
setLevel(level: LogLevelName): void
```

Changes the minimum log level at runtime. Entries below the new level are discarded immediately.

**Example:**
```typescript
logger.setLevel('error'); // only error and fatal from now on
```

---

### setTimestamp

```typescript
setTimestamp(opts: TimestampFormat | TimestampOptions): void
```

Changes the timestamp format at runtime. Recreates the internal formatter with the new format. Accepts a preset string, a custom function, or a full `TimestampOptions` object.

**Example:**
```typescript
logger.setTimestamp('iso');
logger.setTimestamp('unixMs');
logger.setTimestamp({ format: 'iso', highResolution: true });
logger.setTimestamp((d) => d.toLocaleString('ja-JP'));
```

---

### setCriteria *(deprecated)*

```typescript
setCriteria(criteria: Criteria): void
```

Updates the output filter at runtime. Prefer `setLevel()` for threshold-based filtering.

**Example:**
```typescript
logger.setCriteria((entry) => entry.level === 'error');
```

---

### addTransport

```typescript
addTransport(transport: Transport | TransportConfig): void
```

Adds a transport to this logger. Accepts both `Transport` instances and plain `TransportConfig` objects (auto-wrapped in `HttpTransport`).

**Example:**
```typescript
import { FileTransport } from 'konsole-logger';

logger.addTransport(new FileTransport({ path: '/tmp/debug.log' }));

// Plain config — auto-wrapped in HttpTransport
logger.addTransport({
  name: 'backend',
  url: 'https://logs.example.com/ingest',
});
```

---

### flushTransports

```typescript
flushTransports(): Promise<void>
```

Immediately flushes all pending batches across every transport.

**Example:**
```typescript
window.addEventListener('beforeunload', () => {
  void logger.flushTransports();
});
```

---

## Instance Methods — Log Retrieval

### getLogs

```typescript
getLogs(): ReadonlyArray<LogEntry>
```

Returns all stored log entries synchronously.

**Example:**
```typescript
const errors = logger.getLogs().filter((e) => e.level === 'error');
```

---

### getLogsAsync

```typescript
getLogsAsync(): Promise<ReadonlyArray<LogEntry>>
```

Returns all stored entries asynchronously. When `useWorker: true`, retrieves from the background worker (Web Worker in browsers, `worker_threads` in Node.js); otherwise equivalent to `getLogs()`.

---

### clearLogs

```typescript
clearLogs(): void
```

Removes all stored entries and resets the `viewLogs()` cursor.

---

### viewLogs

```typescript
viewLogs(batchSize?: number): void
```

Displays stored entries in batches via `console.table`. Primarily a browser dev tool.

**Parameters:**
- `batchSize` — Entries per call (default: `defaultBatchSize`)

---

### resetBatch

```typescript
resetBatch(): void
```

Resets the `viewLogs()` pagination cursor to the beginning.

---

### getStats

```typescript
getStats(): { logCount: number; maxLogs: number; memoryUsage: string }
```

Returns buffer usage statistics.

**Example:**
```typescript
logger.getStats();
// { logCount: 1234, maxLogs: 10000, memoryUsage: "1234/10000 (12.3%)" }
```

---

### destroy

```typescript
destroy(): Promise<void>
```

Flushes and destroys all transports, stops the cleanup interval, and removes this logger from `Konsole.instances`.

**Example:**
```typescript
await logger.destroy();
```
