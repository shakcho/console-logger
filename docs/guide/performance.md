---
title: Performance
description: Console Logger benchmarks against Pino, Winston, Bunyan, and Consola. ~10 KB gzipped, zero dependencies, ~790K ops/sec structured JSON on the buffered production path, with native browser support.
---

# Performance

Console is built for production. It adds minimal overhead to your application while offering structured logging, child loggers, configurable timestamps, and flexible transports — all in a ~10 KB gzipped bundle with zero dependencies.

## Benchmarks

Measured on Apple M5 Max, Node.js v24.15, 100K iterations per benchmark.

### What matters in production: structured JSON throughput

For most apps the only number that matters is "how fast can the logger actually emit a structured log line." We measure this two ways — both with every logger writing newline-delimited JSON to `/dev/null`, fully flushed (higher is better).

#### Realistic production — async / buffered

This is how loggers run in a real app: each uses its natural **buffered** path (Console's `StreamTransport`, Pino's async `sonic-boom`, a Node `WriteStream` for the rest), all writing through the same async I/O. We time emitting **and fully flushing** 100K lines.

| Logger | ops/sec |
|---|---:|
| **Console** (JSON, async) | **~790K** |
| Consola (JSON, async) | ~750K |
| Bunyan (JSON, async) | ~655K |
| Winston (JSON, async) | ~615K |
| Pino (JSON, async) | ~500K |

On the buffered path that production actually uses, **Console is the fastest of the field** — its `StreamTransport` keeps the stream's write buffer deep (a batched flush, tunable via `flushBatchSize`) so the OS write path never idles between drains.

#### Strict per-line cost — synchronous

A worst-case stress test: every logger serializes its own JSON and performs a **synchronous** `write(2)` on every call — no batching, no async buffer. This isolates raw per-line cost.

| Logger | ops/sec | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Pino (JSON → /dev/null) | ~710K | 1.10 µs | 1.30 µs | 2.7 µs |
| **Console** (JSON → /dev/null) | **~595K** | **1.42 µs** | **1.84 µs** | **1.96 µs** |
| Consola (JSON → /dev/null) | ~580K | 1.54 µs | 1.74 µs | 1.92 µs |
| Bunyan (JSON → /dev/null) | ~505K | 1.70 µs | 1.85 µs | 2.09 µs |
| Winston (JSON → /dev/null) | ~435K | 1.49 µs | 1.74 µs | 2.12 µs |

With every write forced synchronous, Pino's `sonic-boom` leads — that's exactly what it's built for — and Console is a close second, ahead of Consola, Bunyan, and Winston.

> Pino, Winston, and Bunyan are Node.js only. Consola runs in the browser but without worker offloading. Console is the only structured logger that runs natively in both with worker offloading.

### Microbenchmark: disabled / silent overhead

This measures how cheap a *filtered-out* log call is — i.e. what your code pays for `logger.debug(…)` in production when the level is set above `debug`. **It is not a realistic throughput number** because nobody runs a fully silenced logger; it's just an upper bound on per-call overhead.

| Logger | Mode | ops/sec |
|---|---|---:|
| Pino | child, disabled | 34.47M |
| **Console** | child, no buffer | 33.04M |
| Consola | tagged child, silent | 32.73M |
| Consola | silent | 12.69M |
| Pino | disabled | 12.23M |
| **Console** | silent, no buffer | 10.38M |
| Winston | silent | 2.45M |
| Winston | child, silent | 2.32M |

Console, Pino, and Consola sit in the same fast-path tier (within run-to-run V8 noise). Winston is a tier below. These near-zero numbers are dominated by V8 noise and shouldn't be read as a ranking — the meaningful comparison is the JSON-throughput table above.

### Browser / worker scenarios

| Scenario | Console |
|---|---:|
| Silent + circular buffer (browser default) | 6.15M ops/sec |
| Child + circular buffer (browser default) | 5.42M ops/sec |
| With Worker transport | non-blocking on the main thread |

Pino, Winston, Bunyan, and Consola don't have an equivalent — none offer worker-thread offloading, and Pino/Winston/Bunyan don't run in the browser at all.

### Bundle & install size

| | Console | Pino | Winston | Bunyan | Consola |
|---|---:|---:|---:|---:|---:|
| Bundle (gzip) | **~10 KB** | ~32 KB | ~70 KB | ~45 KB | ~12 KB |
| Install size | **135 KB** | 1.17 MB | 360 KB | 212 KB | 420 KB |
| Dependencies | **0** | 11 | 11 | 0 | 0 |

::: info Reproducing benchmarks
Microbenchmark numbers at the nanosecond level vary between runs due to V8 JIT state, GC, and OS scheduling. Run `npm run benchmark` to see numbers on your hardware. Install competitors first with `npm install --no-save pino winston bunyan consola`.
:::

## Buffer Mode

In **Node.js** (default), log entries go directly to formatters and transports with no in-memory storage. This gives you maximum throughput and zero memory accumulation.

In **browsers** (default), entries are stored in a circular buffer so you can inspect them via `getLogs()`, `viewLogs()`, and the `exposeToWindow()` DevTools handle.

```typescript
// Node.js: maximum throughput, no buffer (default)
const logger = new Konsole({ namespace: 'App' });

// Browser: stored for DevTools inspection (default)
const logger = new Konsole({ namespace: 'App' });

// Node.js: opt in to buffer when you need getLogs()
const logger = new Konsole({ namespace: 'App', buffer: true });
```

## Circular Buffer

When `buffer` is enabled, Console stores up to 10,000 logs (configurable via `maxLogs`) in a circular buffer. When the limit is reached, oldest logs are automatically evicted.

```typescript
const logger = new Konsole({
  namespace: 'App',
  buffer: true,
  maxLogs: 5000,
});
```

- **Constant memory** — never grows beyond the limit
- **No manual cleanup** — automatic eviction
- **O(1) operations** — push and evict

```typescript
const stats = logger.getStats();
console.log(stats.memoryUsage); // "1234/5000 (24.7%)"
```

## Worker Transport

This is Console's standout feature. With `useWorker: true`, log storage and HTTP transport batching move to a background worker — Web Worker in browsers, `worker_threads` in Node.js. The main thread never blocks on logging, even at high volume.

No other structured logging library (Pino, Winston, Bunyan) works in the browser, let alone offers cross-platform worker offloading.

```typescript
const logger = new Konsole({
  namespace: 'App',
  useWorker: true,
  transports: [{
    name: 'analytics',
    url: '/api/logs',
    batchSize: 50,
    flushInterval: 10000,
  }],
});

// Main thread stays free for rendering
logger.info('Frame rendered', { fps: 60, dt: 16.2 });
logger.info('User interaction', { event: 'scroll', y: 1200 });

// Retrieve logs from worker
const logs = await logger.getLogsAsync();
```

### When to use

- High-volume browser logging (100+ logs/sec)
- Performance-critical SPAs and animations
- Long-running applications where main-thread responsiveness matters
- Shipping logs to a backend from the browser without blocking UI

### How it works

When `useWorker: true`:
- Logs are written to **both** the main-thread buffer (for synchronous `getLogs()`) and a background worker
- HTTP transports run entirely in the worker — batching, flushing, and retries happen off the main thread
- Use `getLogsAsync()` to retrieve the worker's copy of stored logs
- In browsers, uses Web Worker via Blob + Object URL
- In Node.js, uses `worker_threads` via dynamic import with a compatibility shim
- Falls back gracefully to main-thread processing if no worker API is available

## Production Tips

### Set an appropriate level

```typescript
const logger = new Konsole({
  namespace: 'App',
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
});
// In production, trace/debug/info add zero overhead
```

### Filter transports

```typescript
{
  name: 'errors-only',
  url: '/api/logs',
  filter: (e) => e.levelValue >= 50,
  batchSize: 100,
  flushInterval: 60000,
}
```

### Flush before exit

```typescript
process.on('SIGTERM', async () => {
  await logger.flushTransports();
  process.exit(0);
});
```

### Clean up in components

```typescript
useEffect(() => {
  const logger = new Konsole({ namespace: 'Component' });
  return () => { logger.destroy(); };
}, []);
```

## Running Benchmarks

```bash
npm run build
npm run benchmark                          # Console only
npm install --no-save pino winston bunyan consola  # install competitors
npm run benchmark                          # full comparison
npm run benchmark:size                     # bundle size analysis
npm run benchmark:gc                       # with GC stats
```
