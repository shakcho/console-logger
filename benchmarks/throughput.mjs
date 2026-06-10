#!/usr/bin/env node

/**
 * Konsole performance benchmark — throughput & latency
 *
 * Compares Konsole against Pino, Winston, and Bunyan (when installed).
 * Install competitors first:
 *   npm install --no-save pino winston bunyan
 *
 * Run:
 *   node benchmarks/throughput.mjs
 */

import { performance } from 'node:perf_hooks';
import { createWriteStream, openSync, writeSync, closeSync, write as fsWrite } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Ensure GC is available so we can reset between benchmarks ─────────────────
// CI runs `node benchmarks/throughput.mjs` with no --expose-gc. Without GC we
// can't reclaim the previous benchmark's heap, so every run would start on a
// machine warmed (and heap-fragmented) by the one before it — exactly the bias
// that skews pino-vs-Konsole. Re-exec ourselves once with --expose-gc so every
// benchmark gets a real reset.
if (typeof global.gc !== 'function') {
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(
    process.execPath,
    ['--expose-gc', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: process.env },
  );
  process.exit(res.status ?? 0);
}

// ─── Config ──────────────────────────────────────────────────────────────────

const ITERATIONS = 100_000;
const WARMUP = 1_000;
const COOLDOWN_MS = 300; // idle between benchmarks so the CPU/event loop settle
const FIELDS = { userId: 42, requestId: 'req_abc123', method: 'GET', path: '/api/users', ms: 127 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function devNull() {
  return createWriteStream('/dev/null');
}

/**
 * Strict apples-to-apples sink for the "JSON → /dev/null" comparison.
 *
 * Returns a duck-typed WritableLike whose `write()` performs a real, synchronous
 * `write(2)` syscall to /dev/null and always returns `true`. Returning `true`
 * means a logger can never defer work into an async backpressure queue — every
 * call must serialize its line AND hand it to the OS before returning. This is
 * the same contract Pino runs under with `pino.destination({ sync: true })`, so
 * every logger pays the identical per-line cost: serialize + one syscall.
 *
 * Each call opens its own fd so loggers never share/close each other's handle.
 */
function syncNull() {
  const fd = openSync('/dev/null', 'w');
  return new Writable({
    // Effectively-infinite buffer so write() never returns false → no logger
    // can defer work into an async backpressure queue. Every call serializes
    // its line and writeSync's it to the fd before returning.
    highWaterMark: 1 << 30,
    write(chunk, _enc, cb) {
      writeSync(fd, chunk);
      cb();
    },
    final(cb) {
      try { closeSync(fd); } catch { /* already closed */ }
      cb();
    },
  });
}

/**
 * Realistic-production sink for the async/buffered comparison.
 *
 * A normal async stream (default 16 KB highWaterMark → real backpressure + real
 * 'drain' events) writing to /dev/null. It counts the lines it actually
 * receives and resolves `done` once `expected` lines have been serialized and
 * written. Waiting on `done` after the write loop captures the *amortized*
 * cost of emitting N lines through the buffered path — including all the
 * deferred serialization that a logger's backpressure queue does on 'drain' —
 * which is how logging behaves in a real app, not the worst-case sync path.
 */
function countingNull(expected) {
  const fd = openSync('/dev/null', 'w');
  let lines = 0;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  if (expected === 0) resolveDone();
  const onWritten = (count) => { lines += count; if (lines >= expected) resolveDone(); };
  const stream = new Writable({
    highWaterMark: 16 * 1024,
    // Real async writes through the libuv threadpool — same I/O mechanism as
    // Pino's async sonic-boom. `_writev` lets Node coalesce queued chunks into
    // one syscall under backpressure, exactly like a real fs.WriteStream, so no
    // logger is penalised for writing line-by-line vs. buffering internally.
    write(chunk, _enc, cb) {
      fsWrite(fd, chunk, (err) => { onWritten(1); cb(err); });
    },
    writev(chunks, cb) {
      const buf = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c.chunk) ? c.chunk : Buffer.from(c.chunk))));
      fsWrite(fd, buf, (err) => { onWritten(chunks.length); cb(err); });
    },
    final(cb) {
      try { closeSync(fd); } catch { /* already closed */ }
      cb();
    },
  });
  return { stream, done };
}

function tmpFile(name) {
  return path.join(os.tmpdir(), `konsole-bench-${name}-${Date.now()}.log`);
}

function formatOps(ops) {
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(2)}M ops/sec`;
  if (ops >= 1_000) return `${(ops / 1_000).toFixed(1)}K ops/sec`;
  return `${ops.toFixed(0)} ops/sec`;
}

function formatNs(ns) {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(2)} µs`;
  return `${ns.toFixed(0)} ns`;
}

function percentile(sorted, p) {
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

// Reset machine state before every benchmark so we never measure on a warm
// machine: reclaim the previous run's heap, idle so the event loop drains and
// CPU frequency settles, then reclaim again. This is what makes the loggers
// comparable regardless of the order they run in.
async function settle() {
  global.gc();
  await new Promise((r) => setTimeout(r, COOLDOWN_MS));
  global.gc();
}

async function runBench(name, logFn, opts = {}) {
  const iterations = opts.iterations ?? ITERATIONS;
  const warmup = opts.warmup ?? WARMUP;

  // Reset first — no benchmark starts on a machine warmed by the previous one.
  await settle();

  // Warmup — prime the JIT for *this* logFn only (not timed).
  for (let i = 0; i < warmup; i++) logFn(i);

  // ── Throughput: one clean loop, no timer in the hot path. ──
  // The old code called performance.now() twice per iteration *inside* the
  // timed window, adding ~50–100 ns of timer overhead to every op. That
  // deflated ops/sec — and hit the fastest loggers hardest, distorting the
  // pino-vs-Konsole comparison. Time the whole loop instead.
  const start = performance.now();
  for (let i = 0; i < iterations; i++) logFn(i);
  const elapsed = performance.now() - start;
  const opsPerSec = (iterations / elapsed) * 1000;

  // ── Latency: batch-sample so we beat the timer's resolution. ──
  // performance.now() resolves to ~tens of ns, so timing a single sub-µs call
  // yields garbage (the 0 ns / quantized values in the old report). Time BATCH
  // ops per sample and divide to get a meaningful ns/op figure.
  const BATCH = opts.batch ?? 64;
  const samples = Math.max(1, Math.floor(iterations / BATCH));
  const latencies = new Float64Array(samples);
  for (let s = 0; s < samples; s++) {
    const base = s * BATCH;
    const t0 = performance.now();
    for (let k = 0; k < BATCH; k++) logFn(base + k);
    latencies[s] = ((performance.now() - t0) / BATCH) * 1_000_000; // ns/op
  }

  // Sort for percentiles
  const sorted = Array.from(latencies).sort((a, b) => a - b);

  const p50ns = percentile(sorted, 0.5);
  const p95ns = percentile(sorted, 0.95);
  const p99ns = percentile(sorted, 0.99);

  return {
    name,
    iterations,
    elapsedRaw: elapsed,
    elapsed: `${elapsed.toFixed(0)} ms`,
    opsPerSec: formatOps(opsPerSec),
    opsPerSecRaw: opsPerSec,
    p50ns,
    p95ns,
    p99ns,
    p50: formatNs(p50ns),
    p95: formatNs(p95ns),
    p99: formatNs(p99ns),
  };
}

/**
 * Throughput on the realistic async/buffered path. `factory(n)` returns
 * `{ log(i), drained(), cleanup() }` for a logger wired to a buffered sink that
 * resolves `drained()` once all `n` lines have actually been flushed. We time
 * the write loop *plus* the wait-until-flushed, so the number reflects the true
 * end-to-end cost of emitting N lines the way production does.
 */
async function runBenchAsync(name, factory, opts = {}) {
  const iterations = opts.iterations ?? ITERATIONS;
  const warmup = opts.warmup ?? WARMUP;

  await settle();

  // Warmup on a throwaway logger so the JIT is primed without polluting timing.
  {
    const w = factory(warmup);
    for (let i = 0; i < warmup; i++) w.log(i);
    await w.drained();
    await w.cleanup();
  }

  // Yield to the event loop periodically so this models a real app emitting
  // logs *over time* — not a synchronous flood. Without this, loggers that
  // ignore backpressure buffer all N lines in memory while a backpressure-aware
  // logger (Konsole) throttles, which is an artifact of the burst, not of
  // steady-state throughput. The yield interval is identical for every logger.
  const YIELD_EVERY = opts.yieldEvery ?? 1_000;
  const m = factory(iterations);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    m.log(i);
    if ((i % YIELD_EVERY) === 0) await new Promise((r) => setImmediate(r));
  }
  await m.drained();
  const elapsed = performance.now() - start;
  await m.cleanup();

  const opsPerSec = (iterations / elapsed) * 1000;
  return {
    name,
    iterations,
    elapsedRaw: elapsed,
    elapsed: `${elapsed.toFixed(0)} ms`,
    opsPerSec: formatOps(opsPerSec),
    opsPerSecRaw: opsPerSec,
  };
}

// ─── Load loggers ────────────────────────────────────────────────────────────

async function tryImport(pkg) {
  try {
    return await import(pkg);
  } catch {
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│  Konsole Performance Benchmark                      │');
  console.log('│  Throughput & Latency vs. Popular Loggers           │');
  console.log('└─────────────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Platform:    ${os.platform()} ${os.arch()}`);
  console.log(`  Node.js:     ${process.version}`);
  console.log(`  CPU:         ${os.cpus()[0]?.model ?? 'unknown'}`);
  console.log(`  Iterations:  ${ITERATIONS.toLocaleString()}`);
  console.log('');

  const results = [];

  // ── Konsole ──────────────────────────────────────────────────────────────

  const { Konsole, StreamTransport } = await import('../dist/konsole.js');

  // Silent mode with buffer (browser-like)
  {
    const logger = new Konsole({ namespace: 'Bench', format: 'silent', maxLogs: 10, buffer: true });
    results.push(await runBench('Konsole (silent+buffer)', (i) => logger.info('Hello world', { i, ...FIELDS })));
    await logger.destroy();
  }

  // Silent mode without buffer (Node.js default — no buffer, no I/O)
  {
    const logger = new Konsole({ namespace: 'BenchNoBuf', format: 'silent', buffer: false });
    results.push(await runBench('Konsole (silent, no buffer)', (i) => logger.info('Hello world', { i, ...FIELDS })));
    await logger.destroy();
  }

  // JSON to /dev/null — strict sync sink (serialize + syscall every call)
  {
    const logger = new Konsole({
      namespace: 'BenchJson',
      format: 'silent',
      buffer: false,
      transports: [new StreamTransport({ stream: syncNull(), format: 'json' })],
    });
    results.push(await runBench('Konsole (JSON → /dev/null)', (i) => logger.info('Hello world', { i, ...FIELDS })));
    await logger.destroy();
  }

  // Child logger with buffer (browser-like)
  {
    const logger = new Konsole({ namespace: 'BenchChild', format: 'silent', maxLogs: 10, buffer: true });
    const child = logger.child({ requestId: 'req_xyz', userId: 99 });
    results.push(await runBench('Konsole (child+buffer)', (i) => child.info('Hello world', { i, path: '/users' })));
    await logger.destroy();
  }

  // Child logger without buffer (Node.js default)
  {
    const logger = new Konsole({ namespace: 'BenchChildNb', format: 'silent', buffer: false });
    const child = logger.child({ requestId: 'req_xyz', userId: 99 });
    results.push(await runBench('Konsole (child, no buffer)', (i) => child.info('Hello world', { i, path: '/users' })));
    await logger.destroy();
  }

  // ── Pino ─────────────────────────────────────────────────────────────────

  const pino = await tryImport('pino');
  if (pino) {
    // Silent
    {
      const logger = pino.default({ level: 'trace', enabled: false });
      results.push(await runBench('Pino (disabled)', (i) => logger.info({ i, ...FIELDS }, 'Hello world')));
    }

    // JSON to /dev/null — sync destination, matching syncNull()'s contract
    {
      const dest = pino.destination?.({ dest: '/dev/null', sync: true }) ?? syncNull();
      const logger = pino.default({ level: 'trace' }, dest);
      results.push(await runBench('Pino (JSON → /dev/null)', (i) => logger.info({ i, ...FIELDS }, 'Hello world')));
    }

    // Child
    {
      const logger = pino.default({ level: 'trace', enabled: false });
      const child = logger.child({ requestId: 'req_xyz', userId: 99 });
      results.push(await runBench('Pino (child, disabled)', (i) => child.info({ i, path: '/users' }, 'Hello world')));
    }
  } else {
    console.log('  ⚠ Pino not installed — skipping (npm install --no-save pino)');
  }

  // ── Winston ──────────────────────────────────────────────────────────────

  const winston = await tryImport('winston');
  if (winston) {
    // Silent
    {
      const logger = winston.default.createLogger({ silent: true });
      results.push(await runBench('Winston (silent)', (i) => logger.info('Hello world', { i, ...FIELDS })));
    }

    // JSON to /dev/null
    {
      const logger = winston.default.createLogger({
        level: 'info',
        format: winston.default.format.json(),
        transports: [new winston.default.transports.Stream({ stream: syncNull() })],
      });
      results.push(await runBench('Winston (JSON → /dev/null)', (i) => logger.info('Hello world', { i, ...FIELDS })));
    }

    // Child
    {
      const logger = winston.default.createLogger({ silent: true });
      const child = logger.child({ requestId: 'req_xyz', userId: 99 });
      results.push(await runBench('Winston (child, silent)', (i) => child.info('Hello world', { i, path: '/users' })));
    }
  } else {
    console.log('  ⚠ Winston not installed — skipping (npm install --no-save winston)');
  }

  // ── Consola ──────────────────────────────────────────────────────────────

  const consola = await tryImport('consola');
  if (consola?.createConsola) {
    // Silent (level -999 drops everything before reporters run)
    {
      const logger = consola.createConsola({ level: -999 });
      results.push(await runBench('Consola (silent)', (i) => logger.info('Hello world', { i, ...FIELDS })));
    }

    // JSON → /dev/null via custom reporter (sync sink for parity)
    {
      const sink = syncNull();
      const jsonReporter = {
        log(obj) { sink.write(JSON.stringify(obj) + '\n'); },
      };
      const logger = consola.createConsola({ level: 5, reporters: [jsonReporter] });
      results.push(await runBench('Consola (JSON → /dev/null)', (i) => logger.info('Hello world', { i, ...FIELDS })));
      sink.end();
    }

    // Tagged child (consola's equivalent of bindings)
    {
      const logger = consola.createConsola({ level: -999 });
      const child = logger.withTag('child').withDefaults({ requestId: 'req_xyz', userId: 99 });
      results.push(await runBench('Consola (tagged child, silent)', (i) => child.info('Hello world', { i, path: '/users' })));
    }
  } else {
    console.log('  ⚠ Consola not installed — skipping (npm install --no-save consola)');
  }

  // ── Bunyan ───────────────────────────────────────────────────────────────

  const bunyan = await tryImport('bunyan');
  if (bunyan) {
    // JSON to /dev/null (sync sink for parity)
    {
      const logger = bunyan.default.createLogger({ name: 'bench', stream: syncNull() });
      results.push(await runBench('Bunyan (JSON → /dev/null)', (i) => logger.info({ i, ...FIELDS }, 'Hello world')));
    }

    // Child
    {
      const logger = bunyan.default.createLogger({ name: 'bench', stream: syncNull() });
      const child = logger.child({ requestId: 'req_xyz', userId: 99 });
      results.push(await runBench('Bunyan (child → /dev/null)', (i) => child.info({ i, path: '/users' }, 'Hello world')));
    }
  } else {
    console.log('  ⚠ Bunyan not installed — skipping (npm install --no-save bunyan)');
  }

  // ── Realistic production: async / buffered JSON → /dev/null ─────────────────
  // Each logger uses its natural buffered path (real backpressure, real drain),
  // and we time emitting + fully flushing N lines — the amortized cost a real
  // app pays, vs. the worst-case per-line sync path measured above.

  const asyncResults = [];

  asyncResults.push(await runBenchAsync('Konsole (JSON, async/buffered)', (n) => {
    const { stream, done } = countingNull(n);
    const logger = new Konsole({
      namespace: 'BenchAsync', format: 'silent', buffer: false,
      transports: [new StreamTransport({ stream, format: 'json' })],
    });
    return {
      log: (i) => logger.info('Hello world', { i, ...FIELDS }),
      drained: () => done,
      cleanup: () => logger.destroy(),
    };
  }));

  if (pino) {
    asyncResults.push(await runBenchAsync('Pino (JSON, async/buffered)', (n) => {
      const dest = pino.destination?.({ dest: '/dev/null', sync: false }) ?? syncNull();
      const logger = pino.default({ level: 'trace' }, dest);
      return {
        log: (i) => logger.info({ i, ...FIELDS }, 'Hello world'),
        drained: () => new Promise((res) => { dest.flush ? dest.flush(() => res()) : res(); }),
        cleanup: () => new Promise((res) => { try { dest.end?.(); } catch { /* noop */ } res(); }),
      };
    }));
  }

  if (winston) {
    asyncResults.push(await runBenchAsync('Winston (JSON, async/buffered)', (n) => {
      const { stream, done } = countingNull(n);
      const logger = winston.default.createLogger({
        level: 'info',
        format: winston.default.format.json(),
        transports: [new winston.default.transports.Stream({ stream })],
      });
      return {
        log: (i) => logger.info('Hello world', { i, ...FIELDS }),
        drained: () => done,
        cleanup: () => new Promise((res) => { try { logger.close(); } catch { /* noop */ } res(); }),
      };
    }));
  }

  if (bunyan) {
    asyncResults.push(await runBenchAsync('Bunyan (JSON, async/buffered)', (n) => {
      const { stream, done } = countingNull(n);
      const logger = bunyan.default.createLogger({ name: 'bench', stream });
      return {
        log: (i) => logger.info({ i, ...FIELDS }, 'Hello world'),
        drained: () => done,
        cleanup: () => Promise.resolve(),
      };
    }));
  }

  if (consola?.createConsola) {
    asyncResults.push(await runBenchAsync('Consola (JSON, async/buffered)', (n) => {
      const { stream, done } = countingNull(n);
      const jsonReporter = { log(obj) { stream.write(JSON.stringify(obj) + '\n'); } };
      const logger = consola.createConsola({ level: 5, reporters: [jsonReporter] });
      return {
        log: (i) => logger.info('Hello world', { i, ...FIELDS }),
        drained: () => done,
        cleanup: () => Promise.resolve(),
      };
    }));
  }

  // ── Print results ────────────────────────────────────────────────────────

  console.log('');
  console.log('─── Throughput & Latency (strict: serialize + sync write per line) ─');
  console.log('');
  console.table(results.map(({ name, opsPerSec, p50, p95, p99, elapsed }) => ({
    Logger: name,
    'ops/sec': opsPerSec,
    'p50': p50,
    'p95': p95,
    'p99': p99,
    'Total': elapsed,
  })));

  console.log('');
  console.log('─── Realistic production: async / buffered JSON throughput ────────');
  console.log('');
  console.table(asyncResults.map(({ name, opsPerSec, elapsed }) => ({
    Logger: name,
    'ops/sec': opsPerSec,
    'Total (emit + flush)': elapsed,
  })));

  // ── Bundle size comparison ───────────────────────────────────────────────

  console.log('');
  console.log('─── Bundle / Install Size ───────────────────────────────────────');
  console.log('');

  const sizes = [
    { Logger: 'Konsole', 'ESM (min)': '34 KB', 'Gzip': '~10 KB', 'Dependencies': '0', 'Note': 'Zero-dep, ESM+UMD' },
  ];

  if (pino) sizes.push({ Logger: 'Pino', 'ESM (min)': 'N/A (CJS)', 'Gzip': '~32 KB', 'Dependencies': '5+', 'Note': 'sonic-boom, fast-redact, etc.' });
  if (winston) sizes.push({ Logger: 'Winston', 'ESM (min)': 'N/A (CJS)', 'Gzip': '~70 KB', 'Dependencies': '10+', 'Note': 'logform, triple-beam, etc.' });
  if (bunyan) sizes.push({ Logger: 'Bunyan', 'ESM (min)': 'N/A (CJS)', 'Gzip': '~45 KB', 'Dependencies': '3+', 'Note': 'dtrace-provider optional' });
  if (consola) sizes.push({ Logger: 'Consola', 'ESM (min)': 'ESM', 'Gzip': '~12 KB', 'Dependencies': '7+', 'Note': 'UnJS family, browser+Node' });

  sizes.push({ Logger: 'console.log', 'ESM (min)': '0 KB', 'Gzip': '0 KB', 'Dependencies': '0', 'Note': 'No structure, no levels, no transports' });

  console.table(sizes);

  // ── Memory benchmark ──────────────────────────────────────────────────

  console.log('');
  console.log('─── Memory Usage (100K entries) ─────────────────────────────────');
  console.log('');

  global.gc?.();
  const memBefore = process.memoryUsage().rss;

  const memLogger = new Konsole({ namespace: 'MemBench', format: 'silent', maxLogs: 100_000 });
  for (let i = 0; i < 100_000; i++) {
    memLogger.info('Memory test entry', { i, ...FIELDS });
  }

  global.gc?.();
  const memAfter = process.memoryUsage().rss;
  const memDelta = memAfter - memBefore;

  console.log(`  RSS before:  ${(memBefore / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  RSS after:   ${(memAfter / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Delta:       ${(memDelta / 1024 / 1024).toFixed(1)} MB for 100K entries`);
  console.log(`  Per entry:   ~${(memDelta / 100_000).toFixed(0)} bytes`);
  console.log('');

  // With circular buffer capping
  const memLogger2 = new Konsole({ namespace: 'MemBench2', format: 'silent', maxLogs: 10_000 });
  global.gc?.();
  const memCappedBefore = process.memoryUsage().rss;

  for (let i = 0; i < 100_000; i++) {
    memLogger2.info('Memory test capped', { i, ...FIELDS });
  }

  global.gc?.();
  const memCappedAfter = process.memoryUsage().rss;
  const memCappedDelta = memCappedAfter - memCappedBefore;

  console.log(`  With maxLogs=10K (100K writes, 10K retained):`);
  console.log(`  Delta:       ${(memCappedDelta / 1024 / 1024).toFixed(1)} MB`);
  console.log('');

  await memLogger.destroy();
  await memLogger2.destroy();

  // ── Write structured JSON for CI regression tracking ─────────────────────

  const jsonOut = {
    schemaVersion: 1,
    createdAt:     new Date().toISOString(),
    platform: {
      os:   os.platform(),
      arch: os.arch(),
      node: process.version,
      cpu:  os.cpus()[0]?.model ?? 'unknown',
    },
    iterations: ITERATIONS,
    throughput: results.map((r) => ({
      name:       r.name,
      opsPerSec:  r.opsPerSecRaw,
      p50ns:      r.p50ns,
      p95ns:      r.p95ns,
      p99ns:      r.p99ns,
      elapsedMs:  r.elapsedRaw,
    })),
    throughputAsync: asyncResults.map((r) => ({
      name:       r.name,
      opsPerSec:  r.opsPerSecRaw,
      elapsedMs:  r.elapsedRaw,
    })),
    memory: {
      uncappedDeltaBytes: memDelta,
      perEntryBytes:      memDelta / 100_000,
      cappedDeltaBytes:   memCappedDelta,
    },
  };

  const outPath = process.env.KONSOLE_BENCH_JSON
    ?? path.join(__dirname, '..', 'benchmark-throughput.json');
  await writeFile(outPath, JSON.stringify(jsonOut, null, 2) + '\n');
  console.log(`  → JSON results written to ${outPath}`);
  console.log('');

  console.log('Done.');
}

main().catch(console.error);
