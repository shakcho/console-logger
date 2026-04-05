# Console

<div align="center">

**The only structured logger that runs natively in browsers and Node.js — with zero dependencies.**

[![npm version](https://img.shields.io/npm/v/konsole-logger.svg)](https://www.npmjs.com/package/konsole-logger)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/konsole-logger)](https://bundlephobia.com/package/konsole-logger)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-blue.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://www.npmjs.com/package/konsole-logger)

[Docs](https://console-logger.saktichourasia.dev/docs/) | [Live Demo](https://console-logger.saktichourasia.dev) | [Changelog](https://console-logger.saktichourasia.dev/docs/changelog)

</div>

---

## Why Console?

| Feature | Console | Pino | Winston | Bunyan |
|---------|:-------:|:----:|:-------:|:------:|
| Browser support | **Native** | No | No | No |
| Worker offloading | **Yes** | No | No | No |
| Bundle (gzip) | **~10 KB** | ~32 KB | ~70 KB | ~45 KB |
| Dependencies | **0** | 11 | 11 | 0 |
| Child loggers | Yes | Yes | Yes | Yes |
| File rotation + gzip | **Built-in** | Separate | Separate | No |
| Field redaction | **Built-in** | Plugin | No | No |
| Configurable timestamps | **7 presets + custom** | Epoch only | Basic | Basic |
| DevTools styling | **CSS badges** | No | No | No |
| TypeScript-first | **Yes** | Partial | Partial | No |

## Features

- **Browser-first, Node.js ready** — worker transport (Web Worker / `worker_threads`) keeps the main thread free
- **Six numeric log levels** — trace / debug / info / warn / error / fatal
- **Structured output** — consistent JSON schema, compatible with Datadog, Loki, CloudWatch
- **Beautiful terminal output** — ANSI colors on TTY, NDJSON in pipes, styled badges in DevTools
- **Configurable timestamps** — full date+time by default, ISO 8601, epoch, nanosecond precision, or custom format
- **Child loggers** — attach request-scoped context that flows into every log line
- **Field redaction** — mask sensitive data (`password`, `req.headers.authorization`) before any output or transport
- **Flexible transports** — HTTP, file (with rotation + gzip), stream, or console; per-transport filter and transform
- **Circular buffer** — memory-efficient in-process log history (browser); zero-overhead in Node.js
- **Fast** — on par with Pino, significantly faster than Winston and Bunyan, at 1/3 the bundle size
- **TypeScript first** — full type safety, zero runtime dependencies

## Installation

```bash
npm install konsole-logger
```

> Also works with `yarn add konsole-logger` or `pnpm add konsole-logger`

## Quick Start

> **Note:** The exported class is named `Konsole` (with a K) because `Console` is a reserved global in JavaScript. The library and brand name is **Console**.

```typescript
import { Konsole } from 'konsole-logger';

const logger = new Konsole({ namespace: 'MyApp' });

logger.info('Server started', { port: 3000 });
logger.warn('Config file missing, using defaults');
logger.error(new Error('Database connection failed'));
```

**Terminal output (TTY):**
```
2025-03-16 10:23:45.123  INF  [MyApp]  Server started  port=3000
2025-03-16 10:23:45.124  WRN  [MyApp]  Config file missing, using defaults
2025-03-16 10:23:45.125  ERR  [MyApp]  Database connection failed
```

**Pipe / CI output (NDJSON):**
```json
{"level":30,"levelName":"info","time":"2025-03-16T10:23:45.000Z","namespace":"MyApp","msg":"Server started","port":3000}
```

## Log Levels

| Method | Level | Value |
|--------|-------|-------|
| `logger.trace()` | trace | 10 |
| `logger.debug()` | debug | 20 |
| `logger.info()` / `logger.log()` | info | 30 |
| `logger.warn()` | warn | 40 |
| `logger.error()` | error | 50 |
| `logger.fatal()` | fatal | 60 |

Set a minimum threshold — entries below it are discarded entirely:

```typescript
const logger = new Konsole({ namespace: 'App', level: 'info' });

logger.trace('loop tick');   // dropped — below threshold
logger.debug('cache miss');  // dropped — below threshold
logger.info('ready');        // ✅ logged
```

Change the threshold at runtime:

```typescript
logger.setLevel('debug');
```

## Calling Conventions

All four styles work and produce the same structured `LogEntry`:

```typescript
// 1. Simple string
logger.info('Server started');

// 2. String + fields (recommended)
logger.info('Request received', { method: 'GET', path: '/users', ms: 42 });

// 3. Object-first with msg key
logger.info({ msg: 'Request received', method: 'GET', path: '/users' });

// 4. Error — message extracted, error stored in fields.err
logger.error(new Error('Connection refused'));
```

## Output Formats

The `format` option controls how logs are printed. `'auto'` (default) picks the right one for the environment:

| Format | Description |
|--------|-------------|
| `'auto'` | Browser → `browser`, Node.js TTY → `pretty`, Node.js pipe → `json` |
| `'pretty'` | ANSI-colored human-readable output |
| `'json'` | Newline-delimited JSON — aggregator-friendly |
| `'text'` | Plain text, no ANSI — for CI or log files |
| `'browser'` | Styled `%c` badges in DevTools |
| `'silent'` | No output; logs still stored in the buffer and sent to transports |

```typescript
const logger = new Konsole({ namespace: 'App', format: 'silent' });
```

## Timestamps

Every log line includes a full date+time timestamp by default (`2025-03-16 10:23:45.123`). Configure the format per-logger:

| Preset | Output |
|--------|--------|
| `'datetime'` *(default)* | `2025-03-16 10:23:45.123` |
| `'iso'` | `2025-03-16T10:23:45.123Z` |
| `'time'` | `10:23:45.123` |
| `'date'` | `2025-03-16` |
| `'unix'` | `1710583425` |
| `'unixMs'` | `1710583425123` |
| `'none'` | *(omitted)* |
| `(date, hrTime?) => string` | Custom function |

```typescript
// ISO timestamps everywhere
const logger = new Konsole({ namespace: 'App', timestamp: 'iso' });

// High-resolution timestamps (nanosecond precision)
const logger = new Konsole({
  namespace: 'App',
  timestamp: { format: 'iso', highResolution: true },
});

// Change at runtime (works in browser too)
logger.setTimestamp('unixMs');
logger.setTimestamp((d) => d.toLocaleString('ja-JP'));
```

### Browser runtime control

```typescript
// Via window.__Konsole (after exposeToWindow())
__Konsole.setTimestamp('iso')                    // all loggers
__Konsole.getLogger('Auth').setTimestamp('iso')   // specific logger
```

## Child Loggers

Create a child that automatically injects context into every entry it produces:

```typescript
const logger = new Konsole({ namespace: 'API' });

// Per-request child
const req = logger.child({ requestId: 'req_abc', userId: 42 });

req.info('Request started', { path: '/users' });
// → INF [API]  Request started  requestId=req_abc  userId=42  path=/users

// Nest further — bindings accumulate
const db = req.child({ component: 'postgres' });
db.debug('Query', { ms: 4 });
// → DBG [API]  Query  requestId=req_abc  userId=42  component=postgres  ms=4
```

Child options:

```typescript
const child = logger.child(
  { requestId: 'req_abc' },
  { namespace: 'API:handler', level: 'warn' }
);
```

Children are ephemeral — not registered in `Konsole.instances`, share the parent's buffer.

## Redaction

Automatically mask sensitive fields before they reach any output, transport, or buffer:

```typescript
const logger = new Konsole({
  namespace: 'API',
  redact: ['password', 'user.creditCard', 'req.headers.authorization'],
});

logger.info('Login attempt', { user: 'alice', password: 'hunter2' });
// → INF [API]  Login attempt  user=alice  password=[REDACTED]

logger.info('Request', {
  req: { headers: { authorization: 'Bearer tok', host: 'example.com' } },
});
// → authorization is [REDACTED], host is untouched
```

Redaction uses dot-notation for nested paths. Values are replaced with `'[REDACTED]'` before reaching the buffer, formatter, or any transport — nothing leaks.

### Child logger inheritance

Children always inherit their parent's redact paths and can add more. A child can never redact fewer fields than its parent:

```typescript
const parent = new Konsole({ namespace: 'App', redact: ['password'] });
const child = parent.child({ service: 'auth' }, { redact: ['token'] });

child.info('event', { password: 'secret', token: 'abc' });
// → both password and token are [REDACTED]

parent.info('event', { password: 'secret', token: 'abc' });
// → only password is [REDACTED] — parent is unaffected by child paths
```

### Disable redaction at runtime (browser only)

For debugging in DevTools, you can temporarily disable redaction to see the real values. This toggle is only available in the browser via `window.__Konsole` — it cannot be disabled in Node.js:

```js
// In DevTools console (after Konsole.exposeToWindow()):
__Konsole.disableRedaction(true)   // show real values
__Konsole.disableRedaction(false)  // restore redaction
```

### Advanced: using redaction utilities directly

The redaction functions are exported for use in custom transports:

```typescript
import { compileRedactPaths, applyRedaction, REDACTED } from 'konsole-logger';

const paths = compileRedactPaths(['password', 'req.headers.authorization']);
const redactedEntry = applyRedaction(entry, paths);
```

## Transports

Ship logs to external destinations alongside (or instead of) console output:

### HTTP

```typescript
const logger = new Konsole({
  namespace: 'App',
  transports: [
    {
      name: 'datadog',
      url: 'https://http-intake.logs.datadoghq.com/v1/input',
      headers: { 'DD-API-KEY': process.env.DD_API_KEY },
      batchSize: 50,
      flushInterval: 10000,
      filter: (entry) => entry.levelValue >= 40, // warn+ only
    },
  ],
});
```

### File (Node.js)

```typescript
import { Konsole, FileTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  transports: [
    new FileTransport({ path: '/var/log/app.log' }),
  ],
});
```

With rotation:

```typescript
new FileTransport({
  path: '/var/log/app.log',
  rotation: {
    maxSize: 10 * 1024 * 1024, // rotate at 10 MB
    interval: 'daily',          // also rotate daily
    maxFiles: 7,                // keep 7 rotated files
    compress: true,             // gzip old files (.log.1.gz)
  },
});
```

### Stream

```typescript
import { StreamTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  transports: [new StreamTransport({ stream: process.stdout, format: 'json' })],
});
```

### Add at runtime

```typescript
logger.addTransport(new FileTransport({ path: './debug.log' }));
```

### Graceful shutdown (Node.js)

Flush all transports before the process exits — no logs lost in Lambda, K8s, or containers:

```typescript
// Option 1: automatic — registers SIGTERM, SIGINT, and beforeExit handlers
Konsole.enableShutdownHook();

// Option 2: manual
process.on('SIGTERM', async () => {
  await Konsole.shutdown();
  process.exit(0);
});
```

## Configuration

```typescript
new Konsole({
  namespace?: string;          // default: 'Global' — logger identifier
  level?: LogLevelName;        // default: 'trace' — minimum level threshold
  format?: KonsoleFormat;      // default: 'auto' — output format (pretty/json/text/browser/silent)
  timestamp?: TimestampFormat | TimestampOptions; // default: 'datetime'
  redact?: string[];             // dot-notation field paths to mask with '[REDACTED]'
  transports?: (Transport | TransportConfig)[];   // external log destinations
  maxLogs?: number;            // default: 10000 — circular buffer capacity
  defaultBatchSize?: number;   // default: 100 — entries per viewLogs() call
  retentionPeriod?: number;    // default: 172800000 — 48h auto-cleanup
  cleanupInterval?: number;    // default: 3600000 (1 hour)
  useWorker?: boolean;         // default: false
})
```

## API Reference

### Instance methods

| Method | Description |
|--------|-------------|
| `trace / debug / info / log / warn / error / fatal` | Log at the given level |
| `child(bindings, options?)` | Create a child logger with merged bindings |
| `setLevel(level)` | Change minimum level at runtime |
| `setTimestamp(format)` | Change timestamp format at runtime |
| `getLogs()` | Return all entries from the circular buffer |
| `getLogsAsync()` | Async variant (for worker mode) |
| `clearLogs()` | Empty the buffer |
| `viewLogs(batchSize?)` | Print a batch of stored logs to the console |
| `getStats()` | `{ logCount, capacity }` |
| `addTransport(transport)` | Attach a transport at runtime |
| `flushTransports()` | Flush all pending batches |
| `destroy()` | Flush, stop timers, deregister |

### Static methods

| Method | Description |
|--------|-------------|
| `Konsole.getLogger(namespace)` | Retrieve a registered logger |
| `Konsole.getNamespaces()` | List all registered namespaces |
| `Konsole.exposeToWindow()` | Expose `__Konsole` on `window` for browser debugging |
| `Konsole.enableGlobalPrint(enabled)` | Override output for all loggers |
| `Konsole.addGlobalTransport(transport)` | Add a transport to all existing loggers |
| `Konsole.shutdown()` | Flush and destroy all registered loggers |
| `Konsole.enableShutdownHook()` | Register SIGTERM/SIGINT/beforeExit handlers (Node.js only) |

## Browser Debugging

```typescript
// In app init:
Konsole.exposeToWindow();

// Then in DevTools console:
__Konsole.getLogger('Auth').viewLogs()
__Konsole.enableGlobalPrint(true)   // unsilence all loggers
__Konsole.disableRedaction(true)   // show real values (debug only)
__Konsole.setTimestamp('iso')       // switch all loggers to ISO timestamps
__Konsole.getLogger('Auth').setTimestamp('time') // per-logger override
```

## Performance

Console is designed to have minimal overhead. Unlike Pino, Winston, and Bunyan (Node.js only), Console works natively in the browser and Node.js with worker offloading for non-blocking transport processing.

Benchmarked on Apple M2 Max, Node.js v23 (100K iterations):

| Scenario | Console | Pino | Winston | Bunyan |
|---|---:|---:|---:|---:|
| Disabled / silent | ~8M | ~7M | ~1.5M | — |
| JSON → /dev/null | ~650K | ~470K | ~270K | ~340K |
| Child (disabled) | ~17M | ~14M | ~2M | — |

| | Console | Pino | Winston | Bunyan |
|---|---:|---:|---:|---:|
| **Bundle (gzip)** | **~10 KB** | ~32 KB | ~70 KB | ~45 KB |
| **Install size** | **86 KB** | 1.17 MB | 360 KB | 212 KB |
| **Dependencies** | **0** | 11 | 11 | 0 |
| **Browser support** | **Native + Worker** | No | No | No |

> Run `npm run benchmark` to reproduce on your hardware. Install competitors with `npm install --no-save pino winston bunyan`.

### Worker Performance

With `useWorker: true`, log storage and HTTP transport batching run on a background worker (Web Worker in browsers, `worker_threads` in Node.js) — the main thread never blocks on logging:

```typescript
const logger = new Konsole({
  namespace: 'App',
  useWorker: true,
  transports: [{
    name: 'backend',
    url: '/api/logs',
    batchSize: 50,
    flushInterval: 10000,
  }],
});

// Logging never blocks rendering / event loop — processed in background
logger.info('User action', { event: 'click', target: 'checkout' });
```

No other structured logging library offers cross-platform worker offloading.

## CDN / Script Tag

Console ships a UMD build — use it directly in the browser without a bundler:

```html
<script src="https://unpkg.com/konsole-logger/dist/konsole.umd.cjs"></script>
<script>
  const logger = new Konsole.Konsole({ namespace: 'App' });
  logger.info('Hello from the browser!');
</script>
```

## Coming from Pino?

Console uses a Pino-compatible JSON schema. The calling conventions are similar but not identical:

```typescript
// Pino                                    // Konsole
const logger = pino()                      const logger = new Konsole({ namespace: 'App' })
logger.info({ userId: 1 }, 'msg')          logger.info('msg', { userId: 1 })
logger.info({ msg: 'hi', userId: 1 })      logger.info({ msg: 'hi', userId: 1 })
logger.child({ reqId: 'abc' })             logger.child({ reqId: 'abc' })
```

> **Note:** Pino puts the object first (`obj, 'msg'`). Console puts the string first (`'msg', obj`) or uses `{ msg, ...fields }` object syntax. Both produce the same JSON output.

Key differences: built-in browser support, built-in redaction, built-in file rotation, zero dependencies, and `~10 KB` gzipped vs Pino's `~32 KB`.

## Requirements

- **Node.js >= 18** for server-side use (native `fetch`). Older versions must pass `fetchImpl` to `TransportConfig`.

## License

MIT © Sakti Kumar Chourasia

---

<div align="center">

[Report Bug](https://github.com/shakcho/console-logger/issues) | [Request Feature](https://github.com/shakcho/console-logger/issues) | [Docs](https://console-logger.saktichourasia.dev/docs/)

</div>
