# Configuration

Console accepts options to customize its behavior. The most commonly used ones are `namespace`, `level`, and `format`.

## Constructor Options

```typescript
interface KonsoleOptions {
  namespace?: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  format?: 'auto' | 'pretty' | 'json' | 'text' | 'browser' | 'silent';
  timestamp?: TimestampFormat | TimestampOptions;
  transports?: (Transport | TransportConfig)[];
  maxLogs?: number;
  defaultBatchSize?: number;
  retentionPeriod?: number;
  cleanupInterval?: number;
  useWorker?: boolean;
  criteria?: Criteria; // @deprecated — use level and format instead
}
```

---

### namespace

- **Type:** `string`
- **Default:** `'Global'`

The identifier for this logger instance. Shown in every output line and used to retrieve the logger elsewhere.

```typescript
const logger = new Konsole({ namespace: 'PaymentService' });
```

---

### level

- **Type:** `'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'`
- **Default:** `'trace'` (all levels pass through)

Minimum log level to process. Entries below this level are discarded immediately — they are neither stored in the buffer nor forwarded to transports.

| Level | Value | Typical use |
|-------|-------|-------------|
| `trace` | 10 | Extremely verbose; function entry/exit |
| `debug` | 20 | Developer detail; hidden at `info` and above |
| `info` | 30 | General operational messages |
| `warn` | 40 | Unexpected but recoverable |
| `error` | 50 | Operation failed; written to stderr |
| `fatal` | 60 | Unrecoverable failure; written to stderr |

```typescript
// Development: see everything
const logger = new Konsole({ namespace: 'App', level: 'trace' });

// Production: only warnings and above
const logger = new Konsole({ namespace: 'App', level: 'warn' });
```

Change the level at runtime:

```typescript
logger.setLevel('debug');
```

---

### format

- **Type:** `'auto' | 'pretty' | 'json' | 'text' | 'browser' | 'silent'`
- **Default:** `'auto'`

Controls how log entries are rendered and where they go.

| Value | Description |
|-------|-------------|
| `'auto'` | Selects best format automatically (see below) |
| `'pretty'` | ANSI-colored, human-readable — errors to stderr |
| `'json'` | Newline-delimited JSON — aggregator-friendly (Datadog, Loki, CloudWatch) |
| `'text'` | Plain text, no ANSI — for CI or log files |
| `'browser'` | Styled `%c` badges in browser DevTools |
| `'silent'` | No output; logs still stored in the circular buffer |

**Auto selection rules:**
- Browser environment → `'browser'`
- Node.js on a TTY → `'pretty'`
- Node.js in a pipe / non-TTY → `'json'`

`pretty` and `json` respect `NO_COLOR` / `FORCE_COLOR` environment variables.

```typescript
// Force JSON even in a terminal (e.g., when running under PM2)
const logger = new Konsole({ namespace: 'App', format: 'json' });

// Silent in production — logs stored, nothing printed
const logger = new Konsole({ namespace: 'App', format: 'silent' });
```

---

### timestamp

- **Type:** `TimestampFormat | TimestampOptions`
- **Default:** `'datetime'` (pretty/text/browser), `'iso'` (json)

Controls how timestamps are formatted in log output. Accepts a preset string, a custom function, or a full options object.

| Preset | Output | Example |
|--------|--------|---------|
| `'datetime'` | Local date + time *(default)* | `2025-03-16 10:23:45.123` |
| `'iso'` | ISO 8601 UTC | `2025-03-16T10:23:45.123Z` |
| `'time'` | Time only | `10:23:45.123` |
| `'date'` | Date only | `2025-03-16` |
| `'unix'` | Epoch seconds | `1710583425` |
| `'unixMs'` | Epoch milliseconds | `1710583425123` |
| `'none'` | Omit timestamp | |

```typescript
// Preset string
const logger = new Konsole({ namespace: 'App', timestamp: 'iso' });

// Custom function
const logger = new Konsole({
  namespace: 'App',
  timestamp: (date) => date.toLocaleString('en-US'),
});

// Full options object with high-resolution timing
const logger = new Konsole({
  namespace: 'App',
  timestamp: { format: 'iso', highResolution: true },
});
```

::: tip High-resolution timestamps
When `highResolution: true`, each log entry gets an `hrTime` field containing a nanosecond-precision monotonic timestamp (via `process.hrtime.bigint()` in Node.js or `performance.now()` in browsers). Useful for measuring intervals between log lines.
:::

Change the timestamp format at runtime:

```typescript
logger.setTimestamp('unixMs');
logger.setTimestamp({ format: 'iso', highResolution: true });
logger.setTimestamp((d) => d.toLocaleString('ja-JP'));
```

---

### redact

- **Type:** `string[]`
- **Default:** `[]`

Field paths to redact from every log entry before any output or transport. Accepts dot-notation for nested fields. Matched values are replaced with `'[REDACTED]'`.

```typescript
const logger = new Konsole({
  namespace: 'App',
  redact: ['password', 'token', 'req.headers.authorization'],
});
```

Redaction is applied before entries reach the buffer, transports, or formatter — nothing leaks. See the [Redaction Guide](/guide/redaction) for child inheritance, nested paths, and runtime disable.

---

### transports

- **Type:** `(Transport | TransportConfig)[]`
- **Default:** `[]`

Transports forward log entries to external destinations. Accepts both ready-made `Transport` instances and plain `TransportConfig` objects (auto-wrapped in `HttpTransport`).

```typescript
import { Konsole, FileTransport, ConsoleTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  format: 'silent',        // suppress default output
  transports: [
    new ConsoleTransport({ format: 'pretty' }), // formatted console output
    new FileTransport({ path: '/var/log/app.log' }),  // JSON to disk
    {
      name: 'datadog',     // plain object → auto-wrapped in HttpTransport
      url: 'https://http-intake.logs.datadoghq.com/v1/input',
      headers: { 'DD-API-KEY': process.env.DD_API_KEY },
    },
  ],
});
```

See the [Transports Guide](/guide/transports) for all options.

---

### maxLogs

- **Type:** `number`
- **Default:** `10000`

Maximum entries to keep in the circular buffer. When the limit is reached, oldest entries are silently evicted.

```typescript
const logger = new Konsole({ maxLogs: 1000 }); // keep last 1000 entries
```

::: tip Memory Optimization
Use `maxLogs` to bound memory usage in long-running services. Combined with `retentionPeriod`, this gives you both size and time-based eviction.
:::

---

### defaultBatchSize

- **Type:** `number`
- **Default:** `100`

Number of entries shown per `viewLogs()` call. Does not affect buffering.

---

### retentionPeriod

- **Type:** `number` (milliseconds)
- **Default:** `172800000` (48 hours)

Log entries older than this are removed during periodic cleanup.

```typescript
const logger = new Konsole({
  retentionPeriod: 24 * 60 * 60 * 1000, // keep 24 hours
});
```

---

### cleanupInterval

- **Type:** `number` (milliseconds)
- **Default:** `3600000` (1 hour)

How often the retention cleanup runs.

---

### useWorker

- **Type:** `boolean`
- **Default:** `false`

Offload log storage and HTTP transport processing to a background worker for better main-thread performance. Uses a Web Worker in browsers and `worker_threads` in Node.js.

::: info Platform Adapter
Worker creation is handled by the platform adapter (`createPlatformWorker`). Falls back gracefully if no worker API is available. Custom transport instances (`FileTransport`, etc.) are excluded from worker processing — only `TransportConfig` plain objects are supported in worker mode.
:::

---

### criteria *(deprecated)*

- **Type:** `boolean | ((entry: LogEntry) => boolean)`
- **Default:** `true`

::: warning Deprecated
Use `level` to filter by severity and `format: 'silent'` to suppress output. The `criteria` option remains supported but will be removed in a future major version.
:::

`criteria: false` suppresses all output but still stores logs in the buffer. A function criteria acts as an additional output filter on top of `level`.

---

## Runtime Configuration

### Change the level

```typescript
logger.setLevel('error'); // only error and fatal from now on
logger.setLevel('trace'); // back to everything
```

### Change the timestamp format

```typescript
logger.setTimestamp('iso');
logger.setTimestamp({ format: 'unixMs', highResolution: true });
logger.setTimestamp((d) => d.toLocaleString());
```

### Global print override

Forces all loggers to print regardless of their individual `format` or `criteria`:

```typescript
Konsole.enableGlobalPrint(true);  // all loggers print
Konsole.enableGlobalPrint(false); // restore normal rules
```

### Add a transport at runtime

```typescript
// Specific logger
logger.addTransport(new FileTransport({ path: '/tmp/debug.log' }));

// All existing loggers
Konsole.addGlobalTransport({
  name: 'sentry',
  url: 'https://sentry.io/api/123/envelope/',
  filter: (e) => e.level === 'error',
});
```

### Flush transports

```typescript
await logger.flushTransports();
```

### Memory stats

```typescript
const stats = logger.getStats();
// { logCount: 1234, maxLogs: 5000, memoryUsage: "1234/5000 (24.7%)" }
```

## Graceful Shutdown

Ensure no logs are lost when the process exits:

```typescript
// Automatic — registers SIGTERM, SIGINT, and beforeExit handlers
Konsole.enableShutdownHook();

// Or manual — flush and destroy all loggers
await Konsole.shutdown();

// Or per-logger cleanup
await logger.destroy(); // flushes transports, stops cleanup timer, removes from registry
```

## Full Example

```typescript
import { Konsole, FileTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'PaymentService',
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn',
  format: 'auto',             // pretty in terminal, JSON in CI
  timestamp: 'iso',           // ISO 8601 timestamps
  redact: ['password', 'user.ssn', 'req.headers.authorization'],
  defaultBatchSize: 50,
  retentionPeriod: 12 * 60 * 60 * 1000, // 12 hours
  cleanupInterval: 15 * 60 * 1000,
  maxLogs: 5000,
  transports: [
    new FileTransport({ path: '/var/log/payments.log' }),
    {
      name: 'datadog',
      url: 'https://http-intake.logs.datadoghq.com/v1/input',
      headers: { 'DD-API-KEY': process.env.DD_API_KEY },
      batchSize: 100,
      flushInterval: 30000,
      filter: (e) => e.level === 'error' || e.level === 'fatal',
    },
  ],
});
```
