# Benchmarks

Performance benchmarks comparing Konsole against popular Node.js logging libraries.

## Running

```bash
# Build first (benchmarks import from dist/)
npm run build

# Throughput & latency (Konsole only)
npm run benchmark

# With competitors — install them first:
npm install --no-save pino winston bunyan consola
npm run benchmark

# Bundle size analysis
npm run benchmark:size

# Memory benchmark (with GC stats — optional)
node --expose-gc benchmarks/throughput.mjs
```

## What's Measured

### Throughput (`benchmarks/throughput.mjs`)

| Benchmark | Description |
|-----------|-------------|
| Silent mode | `format: 'silent'` — buffer only, no I/O. Measures pure log processing overhead. |
| JSON → /dev/null | JSON serialization + StreamTransport write. Measures serialization cost. |
| Child logger | Child with bindings in silent mode. Measures binding merge overhead. |

For each, we measure:
- **ops/sec** — total throughput
- **p50 / p95 / p99** — per-call latency percentiles

### Bundle Size (`benchmarks/size.mjs`)

- Minified ESM and UMD sizes (raw + gzip)
- Dependency count
- Install size comparison vs Pino, Winston, Bunyan
- Per-source-file breakdown

### Memory

- RSS growth after 100K log entries (unbounded buffer)
- RSS growth with `maxLogs: 10000` circular buffer (100K writes, 10K retained)
- Per-entry memory cost estimate

## Key Differentiators

Konsole's competitive advantages:

| Metric | Konsole | Why |
|--------|---------|-----|
| Bundle (gzip) | ~10 KB | Zero dependencies, tree-shakeable ESM |
| Dependencies | 0 | No supply chain risk |
| Browser support | Native | Works in browser + Node.js without polyfills |
| Startup time | Fast | No heavy initialization or stream setup |
| Memory ceiling | Bounded | Circular buffer prevents unbounded growth |

Konsole is not trying to beat Pino's raw throughput — Pino uses native C++ bindings (sonic-boom) for I/O. Konsole optimizes for **DX, portability, and size** while maintaining competitive throughput for real-world usage.
