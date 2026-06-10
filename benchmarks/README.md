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
| JSON → /dev/null (strict) | Each logger serializes + performs a **synchronous** `write(2)` per line. Worst-case raw per-line cost; no batching. |
| JSON, async/buffered | Each logger uses its natural buffered path (async I/O); we time emitting **and fully flushing** 100K lines. This is how production actually behaves. |
| Child logger | Child with bindings in silent mode. Measures binding merge overhead. |

The two JSON scenarios matter because loggers differ in *where* they spend time: the strict test isolates serialization + syscall cost (Pino's `sonic-boom` leads), while the buffered test rewards keeping the OS write path saturated (Console leads). Both write newline-delimited JSON to `/dev/null` and wait for a full flush, so nothing is hidden in an async buffer.

For each, we measure:
- **ops/sec** — total throughput, timed over one clean loop (no per-iteration timer in the hot path)
- **p50 / p95 / p99** — latency percentiles, batch-sampled (64 ops/sample) so they beat the timer's ~tens-of-ns resolution instead of quantizing to `0 ns`

### Fairness / reset

Every benchmark is preceded by a reset — a forced GC plus a short cooldown — so no logger is measured on a machine warmed (or heap-fragmented) by the run before it. The numbers are therefore independent of the order loggers run in. The script re-execs itself with `--expose-gc` automatically if needed, so a plain `node benchmarks/throughput.mjs` still gets real resets.

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
