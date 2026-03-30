# Performance

Console is built for production. It adds minimal overhead to your application while offering structured logging, child loggers, configurable timestamps, and flexible transports — all in a ~10 KB gzipped bundle with zero dependencies.

## Benchmarks

Measured on Apple M2 Max, Node.js v23.11.0, 100K iterations per benchmark.

### Throughput (ops/sec)

| Scenario | Console | Pino | Winston | Bunyan |
|---|---:|---:|---:|---:|
| Silent / disabled | ~8M | ~7M | ~1.5M | — |
| JSON → /dev/null | ~650K | ~470K | ~270K | ~340K |
| Child (disabled) | ~17M | ~14M | ~2M | — |
| Silent (browser, with buffer) | ~4.7M | — | — | — |
| With Worker (browser/Node.js) | non-blocking | — | — | — |

> Pino, Winston, and Bunyan are Node.js only. Console is the only structured logger that runs natively in the browser and Node.js with worker offloading.

### Latency (p50)

| Scenario | Console | Pino | Winston | Bunyan |
|---|---:|---:|---:|---:|
| Silent | 83 ns | 83 ns | 292 ns | — |
| JSON → stream | 1.13 µs | 1.50 µs | 1.54 µs | 2.08 µs |
| Child (disabled) | 41 ns | 41 ns | 292 ns | — |

### Bundle & Install Size

| | Console | Pino | Winston | Bunyan |
|---|---:|---:|---:|---:|
| Bundle (gzip) | ~10 KB | ~32 KB | ~70 KB | ~45 KB |
| Install size | 86 KB | 1.17 MB | 360 KB | 212 KB |
| Dependencies | 0 | 11 | 11 | 0 |

::: info Reproducing benchmarks
Microbenchmark numbers at the nanosecond level vary between runs due to V8 JIT state, GC, and OS scheduling. Run `npm run benchmark` to see numbers on your hardware. Install competitors first with `npm install --no-save pino winston bunyan`.
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
npm install --no-save pino winston bunyan  # install competitors
npm run benchmark                          # full comparison
npm run benchmark:size                     # bundle size analysis
npm run benchmark:gc                       # with GC stats
```
