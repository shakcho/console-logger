# Types

Type definitions exported by `konsole-logger`.

## LogEntry

Represents a single log entry stored in the circular buffer.

```typescript
type LogEntry = {
  msg: string;                       // primary message string
  messages: unknown[];               // original arguments (kept for compatibility)
  fields: Record<string, unknown>;   // structured key-value pairs (includes bindings)
  timestamp: Date;
  hrTime?: number;                   // high-res nanosecond offset (when highResolution: true)
  namespace: string;
  level: LogLevelName;               // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  levelValue: number;                // 10 | 20 | 30 | 40 | 50 | 60
  logtype?: string;                  // @deprecated — use level
};
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `msg` | `string` | The primary log message |
| `messages` | `unknown[]` | Original arguments passed to the log method |
| `fields` | `Record<string, unknown>` | Structured key-value pairs (child bindings merged with call-site fields) |
| `timestamp` | `Date` | When the log was created |
| `hrTime` | `number \| undefined` | High-resolution monotonic timestamp in nanoseconds (present when `highResolution: true`) |
| `namespace` | `string` | The logger namespace |
| `level` | `LogLevelName` | Severity: `'trace'` `'debug'` `'info'` `'warn'` `'error'` `'fatal'` |
| `levelValue` | `number` | Numeric severity: 10 / 20 / 30 / 40 / 50 / 60 |

### Example

```typescript
import { Konsole } from 'konsole-logger';

const logger = new Konsole({ namespace: 'App', format: 'silent' });
logger.error('Something failed', { code: 500, path: '/users' });

const [entry] = logger.getLogs();
// {
//   msg: 'Something failed',
//   messages: ['Something failed', { code: 500, path: '/users' }],
//   fields: { code: 500, path: '/users' },
//   timestamp: Date,
//   namespace: 'App',
//   level: 'error',
//   levelValue: 50,
// }
```

---

## Transport *(interface)*

All transport implementations satisfy this interface.

```typescript
interface Transport {
  readonly name: string;
  write(entry: LogEntry): void;
  flush?(): Promise<void>;
  destroy(): Promise<void>;
}
```

### Implementing a custom transport

```typescript
import type { Transport, LogEntry } from 'konsole-logger';

class MyTransport implements Transport {
  readonly name = 'my-transport';

  write(entry: LogEntry): void {
    // deliver the entry somewhere
    externalService.send({
      level: entry.level,
      msg: entry.msg,
      ...entry.fields,
    });
  }

  async destroy(): Promise<void> {
    // clean up resources
  }
}

const logger = new Konsole({
  namespace: 'App',
  transports: [new MyTransport()],
});
```

---

## KonsoleOptions

Configuration for the `Konsole` constructor.

```typescript
interface KonsoleOptions {
  namespace?: string;
  level?: LogLevelName;
  format?: KonsoleFormat;
  timestamp?: TimestampFormat | TimestampOptions;
  redact?: string[];
  transports?: (Transport | TransportConfig)[];
  maxLogs?: number;
  defaultBatchSize?: number;
  retentionPeriod?: number;
  cleanupInterval?: number;
  useWorker?: boolean;
  criteria?: Criteria; // @deprecated
}
```

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `namespace` | `string` | `'Global'` | Logger namespace |
| `level` | `LogLevelName` | `'trace'` | Minimum level — entries below are discarded |
| `format` | `KonsoleFormat` | `'auto'` | Output format (see below) |
| `timestamp` | `TimestampFormat \| TimestampOptions` | `'datetime'` | Timestamp format (see below) |
| `redact` | `string[]` | `[]` | Dot-notation field paths to mask with `'[REDACTED]'` — see [Redaction](/guide/redaction) |
| `transports` | `(Transport \| TransportConfig)[]` | `[]` | External log destinations |
| `maxLogs` | `number` | `10000` | Circular buffer capacity |
| `defaultBatchSize` | `number` | `100` | Entries per `viewLogs()` call |
| `retentionPeriod` | `number` | `172800000` | 48 hours in ms |
| `cleanupInterval` | `number` | `3600000` | 1 hour in ms |
| `useWorker` | `boolean` | `false` | Worker mode (Web Worker in browser, `worker_threads` in Node.js) |
| `criteria` | `Criteria` | `true` | Output filter *(deprecated — use `level` and `format`)* |

---

## KonsoleFormat

```typescript
type KonsoleFormat = 'auto' | 'pretty' | 'json' | 'text' | 'browser' | 'silent';
```

| Value | Description |
|-------|-------------|
| `'auto'` | Browser → `browser`, Node.js TTY → `pretty`, Node.js pipe → `json` |
| `'pretty'` | ANSI-colored human-readable output; respects `NO_COLOR` / `FORCE_COLOR` |
| `'json'` | Newline-delimited JSON — aggregator-friendly (Datadog, Loki, CloudWatch) |
| `'text'` | Plain text, no ANSI — for CI logs or plain log files |
| `'browser'` | `%c` CSS badge styling in browser DevTools |
| `'silent'` | No output; entries still stored in buffer and forwarded to transports |

---

## KonsoleChildOptions

Options accepted by `logger.child()`.

```typescript
interface KonsoleChildOptions {
  namespace?: string;
  level?: LogLevelName;
  timestamp?: TimestampFormat | TimestampOptions;
  redact?: string[];
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `namespace` | `string` | Parent's | Override namespace for this child |
| `level` | `LogLevelName` | Parent's | Override minimum level (can only be more restrictive) |
| `timestamp` | `TimestampFormat \| TimestampOptions` | Parent's | Override timestamp format |
| `redact` | `string[]` | `[]` | Additional paths to redact (merged with parent's paths — child can never redact fewer) |

---

## RotationOptions

Configuration for file rotation on `FileTransport`.

```typescript
interface RotationOptions {
  maxSize?: number;
  interval?: 'daily' | 'hourly' | number;
  maxFiles?: number;
  compress?: boolean;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxSize` | `number` | — | Rotate when file exceeds this size in bytes |
| `interval` | `'daily' \| 'hourly' \| number` | — | Rotate on a time schedule (`'daily'`, `'hourly'`, or ms) |
| `maxFiles` | `number` | `5` | Maximum rotated files to retain; oldest are deleted |
| `compress` | `boolean` | `false` | Gzip-compress rotated files (`.gz` suffix) |

Rotated files use numeric suffixes: `app.log.1` (newest) → `app.log.2` → etc. The current log file always stays at the configured path. When both `maxSize` and `interval` are set, rotation triggers on whichever condition is met first.

---

## TransportConfig

Configuration for an HTTP transport (auto-wrapped in `HttpTransport`).

```typescript
interface TransportConfig {
  name: string;
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  batchSize?: number;
  flushInterval?: number;
  retryAttempts?: number;
  filter?: (entry: LogEntry) => boolean;
  transform?: (entry: LogEntry) => unknown;
  fetchImpl?: typeof fetch;
}
```

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | Required | Unique identifier |
| `url` | `string` | Required | Endpoint URL |
| `method` | `string` | `'POST'` | HTTP method |
| `headers` | `object` | `{}` | Additional request headers |
| `batchSize` | `number` | `50` | Entries per batch |
| `flushInterval` | `number` | `10000` | Auto-flush interval (ms) |
| `retryAttempts` | `number` | `3` | Retry attempts with exponential backoff |
| `filter` | `function` | — | Only forward entries matching predicate |
| `transform` | `function` | — | Transform entry before sending |
| `fetchImpl` | `typeof fetch` | `globalThis.fetch` | Custom fetch (required on Node.js < 18) |

---

## TimestampFormat

```typescript
type TimestampFormat =
  | 'iso'       // 2025-03-16T10:23:45.123Z
  | 'datetime'  // 2025-03-16 10:23:45.123
  | 'date'      // 2025-03-16
  | 'time'      // 10:23:45.123
  | 'unix'      // 1710583425 (epoch seconds)
  | 'unixMs'    // 1710583425123 (epoch milliseconds)
  | 'none'      // omit timestamp
  | ((date: Date, hrTime?: number) => string); // custom function
```

| Preset | Output | Notes |
|--------|--------|-------|
| `'datetime'` | `2025-03-16 10:23:45.123` | Default for pretty, text, and browser formatters |
| `'iso'` | `2025-03-16T10:23:45.123Z` | Default for JSON formatter; UTC |
| `'time'` | `10:23:45.123` | Time only, local timezone |
| `'date'` | `2025-03-16` | Date only, local timezone |
| `'unix'` | `1710583425` | Epoch seconds |
| `'unixMs'` | `1710583425123` | Epoch milliseconds |
| `'none'` | *(empty)* | Omit from output |
| `function` | Custom | Receives `Date` and optional `hrTime` (nanoseconds) |

---

## TimestampOptions

```typescript
interface TimestampOptions {
  format?: TimestampFormat;     // default: 'datetime'
  highResolution?: boolean;     // default: false
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `format` | `TimestampFormat` | `'datetime'` | Timestamp output format |
| `highResolution` | `boolean` | `false` | Capture nanosecond-precision timing via `process.hrtime.bigint()` (Node) or `performance.now()` (browser) |

When `highResolution` is `true`, each `LogEntry` receives an `hrTime` field (nanoseconds, monotonic). The JSON formatter includes this in output as `"hrTime": 123456789`.

---

## Criteria *(deprecated)*

```typescript
type Criteria = boolean | ((logEntry: LogEntry) => boolean);
```

Controls whether the formatter outputs a log entry. Prefer `level` and `format` for new code.

---

## LogLevelName

```typescript
type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

---

## ContextStore

```typescript
type ContextStore = Record<string, unknown>;
```

The key/value bag propagated through async scope via [`Konsole.runWithContext`](/api/konsole#runwithcontext). Merged into every log entry produced inside the scope — see the [Async Context Propagation guide](/guide/async-context).

```typescript
import { Konsole, type ContextStore } from 'konsole-logger';

const baseCtx: ContextStore = { service: 'payments', region: 'us-east-1' };

Konsole.runWithContext({ ...baseCtx, requestId: 'r_abc' }, () => {
  logger.info('charged');
});
```

---

## FileFormat

```typescript
type FileFormat = 'json' | 'text';
```

Used by `FileTransport` and `StreamTransport` to control the per-line serialization format.

---

## KonsolePublic

Public interface surfaced by `__Konsole.getLogger()` in the browser.

```typescript
// Per-logger interface (via __Konsole.getLogger())
{
  viewLogs(batchSize?: number): void;
  setTimestamp(opts: TimestampFormat | TimestampOptions): void;
  setLevel(level: LogLevelName): void;
}

// Global interface (via __Konsole)
{
  getLogger(namespace?: string): { viewLogs, setTimestamp, setLevel };
  listLoggers(): string[];
  enableAll(): void;
  disableAll(): void;
  setTimestamp(opts: TimestampFormat | TimestampOptions): void; // changes all loggers
  disableRedaction(disabled: boolean): void; // browser only — bypass redaction for debugging
}
```
