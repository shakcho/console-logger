---
title: Transports
description: Ship JavaScript logs to HTTP endpoints, files (with rotation + gzip), writable streams, or the console. Per-transport filter and transform, batching, exponential-backoff retry.
---

# Transports

Transports forward log entries to external destinations — HTTP endpoints, log files, writable streams, or additional console output. You can use multiple transports simultaneously.

## Transport Types

Console ships four transport implementations:

| Class | Destination | Environment |
|-------|-------------|-------------|
| `HttpTransport` | HTTP endpoint (batched POST) | Browser + Node.js |
| `ConsoleTransport` | Console via a Formatter | Browser + Node.js |
| `FileTransport` | File on disk | Node.js only |
| `StreamTransport` | Any `WritableLike` stream | Node.js only |

## HttpTransport

Batches log entries and POSTs them to an external endpoint. Auto-created when you pass a plain `TransportConfig` object.

```typescript
import { Konsole } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  transports: [{
    name: 'backend',
    url: 'https://logs.example.com/ingest',
  }],
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | Required | Unique identifier |
| `url` | `string` | Required | Endpoint URL |
| `method` | `'POST' \| 'PUT'` | `'POST'` | HTTP method |
| `headers` | `object` | `{}` | Additional request headers |
| `batchSize` | `number` | `50` | Entries per batch before auto-flush |
| `flushInterval` | `number` | `10000` | Auto-flush interval (ms) |
| `retryAttempts` | `number` | `3` | Retry attempts with exponential backoff |
| `maxQueueSize` | `number` | `Infinity` | Cap on pending batches awaiting send |
| `overflowStrategy` | `'drop-oldest' \| 'drop-newest'` | `'drop-oldest'` | What to drop when `maxQueueSize` is reached |
| `onError` | `function` | — | Called when a batch is permanently dropped (retries exhausted or queue overflow) |
| `filter` | `function` | — | Only forward entries that pass the predicate |
| `transform` | `function` | — | Transform an entry before sending |
| `fetchImpl` | `typeof fetch` | `globalThis.fetch` | Custom fetch (required on Node.js < 18) |

Logs are sent when:
1. The `batchSize` is reached, OR
2. The `flushInterval` elapses, OR
3. `logger.flushTransports()` is called manually

### Retry Logic

Failed requests are retried with exponential backoff:
- Attempt 1: Immediate
- Attempt 2: 1 second delay
- Attempt 3: 2 second delay
- (controlled by `retryAttempts`)

### Handling Permanent Failures

A batch is "permanently dropped" when retry attempts are exhausted, or when `maxQueueSize` evicts it before it could be sent. By default these drops are silent — wire up `onError` to surface them:

```typescript
{
  name: 'backend',
  url: 'https://logs.example.com/ingest',
  retryAttempts: 5,
  maxQueueSize: 1000,                  // never queue more than 1000 batches
  overflowStrategy: 'drop-oldest',     // keep the freshest data
  onError: (err, droppedEntries) => {
    metrics.increment('log.dropped', droppedEntries.length);
    fallbackLogger.error('Log batch dropped', { reason: err.message });
  },
}
```

The callback receives the underlying `Error` (HTTP status, network failure, or a `queue overflow` sentinel) and the dropped log entries. Exceptions thrown from `onError` are caught and logged to `console.warn` — the transport keeps running.

### HTTP Payload Schema

```json
{
  "transport": "backend",
  "logs": [
    {
      "level": 30,
      "levelName": "info",
      "time": "2024-06-15T10:23:45.123Z",
      "namespace": "App",
      "msg": "User logged in",
      "userId": 42
    }
  ],
  "sentAt": "2024-06-15T10:23:45.500Z"
}
```

Fields from the log entry are spread into the root of each log object. Use `transform` to customize the shape.

## ConsoleTransport

Wraps a formatter and writes to the console. Useful when the main logger uses `format: 'silent'` but you want formatted output from specific transports.

```typescript
import { Konsole, ConsoleTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  format: 'silent',         // suppress default output
  transports: [
    new ConsoleTransport({ format: 'pretty' }),  // explicit pretty output
  ],
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `'console'` | Transport name |
| `format` | `KonsoleFormat` | `'auto'` | Output format |
| `filter` | `function` | — | Per-entry filter predicate |

## FileTransport *(Node.js only)*

Appends log entries as newline-delimited JSON (or plain text) to a file on disk.

```typescript
import { Konsole, FileTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  format: 'pretty',          // human-readable in terminal
  transports: [
    new FileTransport({ path: '/var/log/app.log' }),  // JSON to disk
  ],
});
```

Entries written before the file handle opens are buffered in memory and flushed automatically. Call `await transport.ready()` if you need to guarantee the file exists before proceeding.

```typescript
const fileTransport = new FileTransport({ path: '/tmp/debug.log' });
await fileTransport.ready(); // wait for file open

const logger = new Konsole({
  namespace: 'App',
  transports: [fileTransport],
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | Required | Absolute or relative path to the log file |
| `name` | `string` | `'file:<path>'` | Transport name |
| `format` | `'json' \| 'text'` | `'json'` | Line format |
| `flags` | `'a' \| 'w'` | `'a'` | `'a'` appends; `'w'` truncates on open |
| `filter` | `function` | — | Per-entry filter predicate |
| `rotation` | `RotationOptions` | — | File rotation config (see below) |
| `maxQueueSize` | `number` | `Infinity` | Cap on entries buffered under backpressure (see *StreamTransport › Backpressure*) |
| `overflowStrategy` | `'drop-oldest' \| 'drop-newest'` | `'drop-oldest'` | What to drop when `maxQueueSize` is reached |
| `onDrop` | `function` | — | Called when entries are dropped from the backpressure queue |

### File Rotation

Rotate log files by size, time, or both. Rotated files use a numeric suffix — the current file always stays at the configured path:

```
app.log        ← current
app.log.1      ← most recent rotated file
app.log.2      ← older
app.log.1.gz   ← compressed (when compress: true)
```

```typescript
new FileTransport({
  path: '/var/log/app.log',
  rotation: {
    maxSize: 10 * 1024 * 1024, // rotate at 10 MB
    interval: 'daily',          // also rotate at midnight
    maxFiles: 7,                // keep 7 rotated files
    compress: true,             // gzip old files
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSize` | `number` | — | Rotate when file exceeds this many bytes |
| `interval` | `'daily' \| 'hourly' \| number` | — | Rotate on a time schedule (number = ms) |
| `maxFiles` | `number` | `5` | Maximum rotated files to retain |
| `compress` | `boolean` | `false` | Gzip-compress rotated files |

When both `maxSize` and `interval` are set, rotation triggers on whichever condition is met first. Entries written during rotation are buffered and flushed to the new file — no logs are lost.

## StreamTransport *(Node.js only)*

Writes entries to any `WritableLike` stream — duck-typed to avoid requiring `@types/node` in consumer projects.

```typescript
import { Konsole, StreamTransport } from 'konsole-logger';
import { createWriteStream } from 'node:fs';

const logger = new Konsole({
  namespace: 'App',
  transports: [
    new StreamTransport({
      stream: createWriteStream('/tmp/debug.log', { flags: 'a' }),
      format: 'json',
    }),
  ],
});
```

The `WritableLike` interface requires `write(chunk: string)`, `end(cb?)`, and `on('error' | 'drain', fn)`. Standard Node.js streams satisfy this out of the box.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `stream` | `WritableLike` | Required | Target writable stream |
| `name` | `string` | `'stream'` | Transport name |
| `format` | `'json' \| 'text'` | `'json'` | Line format |
| `filter` | `function` | — | Per-entry filter predicate |
| `maxQueueSize` | `number` | `Infinity` | Cap on entries buffered while paused under backpressure |
| `overflowStrategy` | `'drop-oldest' \| 'drop-newest'` | `'drop-oldest'` | What to drop when `maxQueueSize` is reached |
| `onDrop` | `function` | — | Called when entries are dropped from the backpressure queue |
| `flushBatchSize` | `number` | `4096` | Entries flushed into the stream per `'drain'` event (see *Backpressure*) |

### Backpressure

When `stream.write()` returns `false`, the stream's internal buffer is full. `StreamTransport` pauses, queues subsequent entries in memory, and resumes on the stream's `'drain'` event — no log lines are silently dropped on the floor.

On each `'drain'`, the transport flushes a batch (`flushBatchSize`, default `4096`) of queued entries — deliberately feeding the stream past its high-water mark so its write buffer stays deep and the OS write path never idles between drain cycles. This is what keeps throughput high (~790K lines/sec to a buffered stream); stopping at the stream's first backpressure signal would roughly halve it. Memory stays bounded: at most `flushBatchSize` entries sit in the stream's buffer, with the rest held in the (capped) pending queue. Raise it for maximum burst throughput, or lower it to keep the stream's buffer shallower.

The queue is unbounded by default. For long-lived processes with a permanently slow consumer, cap it explicitly:

```typescript
new StreamTransport({
  stream: slowSink,
  maxQueueSize: 10_000,
  overflowStrategy: 'drop-oldest',          // favour fresh data
  onDrop: (entries, reason) => {
    metrics.increment('log.dropped', entries.length, { reason });
  },
});
```

The same backpressure handling applies to `FileTransport` (which extends `StreamTransport`) — including across rotations, since the new file stream gets its own `'drain'` listener.

## Filtering and Transforming

### Filter — send only specific entries

```typescript
// Only errors and fatals
{
  name: 'errors',
  url: 'https://errors.example.com/ingest',
  filter: (entry) => entry.levelValue >= 50,
}

// Only from specific namespaces
{
  name: 'api-logs',
  url: 'https://logs.example.com/api',
  filter: (entry) => entry.namespace.startsWith('API'),
}
```

### Transform — customize the payload shape

```typescript
// Datadog format
{
  name: 'datadog',
  url: 'https://http-intake.logs.datadoghq.com/v1/input',
  headers: { 'DD-API-KEY': process.env.DD_API_KEY },
  transform: (entry) => ({
    message:   entry.msg,
    status:    entry.level,
    timestamp: entry.timestamp.toISOString(),
    service:   entry.namespace,
    ddsource:  'nodejs',
    ...entry.fields,
  }),
}

// Logtail format
{
  name: 'logtail',
  url: 'https://in.logtail.com',
  headers: { 'Authorization': `Bearer ${process.env.LOGTAIL_TOKEN}` },
  transform: (entry) => ({
    message: entry.msg,
    level:   entry.level,
    dt:      entry.timestamp.toISOString(),
    context: { namespace: entry.namespace, ...entry.fields },
  }),
}
```

## Adding Transports at Runtime

```typescript
// To a specific logger
logger.addTransport(new FileTransport({ path: '/tmp/debug.log' }));

// Or using a plain config object (auto-wrapped in HttpTransport)
logger.addTransport({
  name: 'sentry',
  url: 'https://sentry.io/api/123/envelope/',
  filter: (e) => e.level === 'error',
});

// To all existing loggers
Konsole.addGlobalTransport({
  name: 'analytics',
  url: 'https://analytics.example.com/events',
});
```

## Manual Flushing

```typescript
// Before page unload (browser)
window.addEventListener('beforeunload', async () => {
  await logger.flushTransports();
});

// On visibility change
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void logger.flushTransports();
  }
});

// Graceful shutdown (Node.js)
process.on('SIGTERM', async () => {
  await logger.flushTransports();
  await logger.destroy();
  process.exit(0);
});
```

## Popular Service Configs

### Datadog

```typescript
{
  name: 'datadog',
  url: 'https://http-intake.logs.datadoghq.com/v1/input',
  headers: { 'DD-API-KEY': process.env.DD_API_KEY },
  batchSize: 100,
  flushInterval: 10000,
}
```

### Logtail / Better Stack

```typescript
{
  name: 'logtail',
  url: 'https://in.logtail.com',
  headers: { 'Authorization': `Bearer ${process.env.LOGTAIL_TOKEN}` },
}
```

### Custom Backend

```typescript
{
  name: 'custom',
  url: 'https://api.yourapp.com/logs',
  headers: {
    'Authorization': `Bearer ${getAuthToken()}`,
  },
  batchSize: 50,
  flushInterval: 10000,
  transform: (entry) => ({
    ...entry.fields,
    msg:       entry.msg,
    level:     entry.level,
    namespace: entry.namespace,
    ts:        entry.timestamp.toISOString(),
    appVersion: APP_VERSION,
  }),
}
```

## Best Practices

1. **Use filters** — Don't send all levels to every transport; target them by `levelValue`
2. **Batch appropriately** — Balance latency vs. network efficiency for your use case
3. **Handle shutdown** — Flush transports before process exit or page unload
4. **Secure credentials** — Use environment variables for API keys, never hardcode
5. **Transform for size** — Strip or reshape entries to reduce payload bytes sent over the network
