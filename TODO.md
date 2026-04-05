# Console — Improvement Roadmap

Goal: universal logging library (Browser + Node.js) competitive with Pino.js, with better DX.

---

## P0 — Blocking / Core Parity

- [x] **Node.js compatibility**
  - [x] Replace `window` usage with `globalThis`
  - [x] Guard `fetch` with environment detection; require Node 18+ or accept `fetchImpl` option
  - [x] Add clear warning when `useWorker: true` is set in Node.js (graceful fallback) — replaced by platform adapter in v4.3.0
  - [x] Add `@types/node` to devDependencies
  - [x] Add `engines: { node: ">=18.0.0" }` to `package.json`
  - [x] Replace browser `Worker` + Blob approach with platform adapter (browser Web Worker / Node.js `worker_threads`)
  - [x] Add conditional `node` / `browser` exports in `package.json`

- [x] **JSON structured output + numeric log levels**
  - [x] Add `trace()`, `debug()`, `fatal()` methods
  - [x] Assign numeric values: `trace=10, debug=20, info=30, warn=40, error=50, fatal=60`
  - [x] Add `level` option (minimum level threshold, replaces `criteria` for common case)
  - [x] Add `format: 'auto' | 'pretty' | 'json' | 'text' | 'browser' | 'silent'` option
  - [x] Use `process.stdout.write()` in Node.js (errors/fatal → stderr)
  - [x] Standardize log line schema: `{ level, levelName, time, namespace, msg, ...fields }`
  - [x] Built-in pretty formatter with ANSI colors (auto-enabled on TTY, respects NO_COLOR)
  - [x] Built-in browser formatter with CSS badge styling via `%c`
  - [x] Pino-style object-first calling convention: `logger.info({ msg: '...', key: val })`
  - [x] Structured field extraction: `logger.info('msg', { key: val })` → fields spread into output

- [x] **Configurable timestamps**
  - [x] Full date+time in all formatters by default (`YYYY-MM-DD HH:MM:SS.mmm`)
  - [x] `timestamp` option on `KonsoleOptions` and `KonsoleChildOptions`
  - [x] Preset formats: `'datetime'`, `'iso'`, `'time'`, `'date'`, `'unix'`, `'unixMs'`, `'none'`
  - [x] Custom function: `(date: Date, hrTime?: number) => string`
  - [x] High-resolution timestamps via `process.hrtime.bigint()` / `performance.now()`
  - [x] `setTimestamp()` for runtime changes
  - [x] Browser runtime control via `__Konsole.setTimestamp()`
  - [x] Child logger timestamp override
  - [x] `BrowserFormatter` now renders timestamps (was previously omitted)

---

## P1 — High Impact

- [x] **Child loggers with bindings**
  - [x] `logger.child({ requestId, userId })` returns a new logger inheriting parent config
  - [x] Bindings merged into every log entry automatically (call-site fields override bindings)
  - [x] Child inherits level, transports, format, buffer from parent
  - [x] Nested children accumulate bindings from all ancestor layers
  - [x] Optional `{ namespace, level }` overrides per child
  - [x] Children are ephemeral — not registered in `Konsole.instances`
  - [x] `child.addTransport()` does not affect parent (separate array, shared instances)

- [x] **Transport abstraction**
  - [x] Define `Transport` interface in `types.ts` (`write`, `flush?`, `destroy`)
  - [x] Rename `Transport` → `HttpTransport` (old `src/Transport.ts` is now a deprecated re-export)
  - [x] Add `ConsoleTransport` — wraps any `KonsoleFormat` formatter; useful with `format: 'silent'`
  - [x] Add `FileTransport` — appends to disk via `fs.createWriteStream`; buffers entries during async open
  - [x] Add `StreamTransport` — writes to any `WritableLike` (duck-typed, no `@types/node` required)
  - [x] `addTransport()` and `KonsoleOptions.transports` accept both `Transport` instances and `TransportConfig` objects
  - [x] `node:fs` and all `node:` builtins marked external in Rollup (no browser stubs)
  - [x] File rotation

- [x] **Test suite (Vitest)**
  - [x] Add `vitest` to devDependencies
  - [x] Add `"test": "vitest"`, `"test:run": "vitest run"`, `"test:coverage": "vitest run --coverage"` scripts
  - [x] Unit tests: `CircularBuffer` (capacity, eviction, retain, edge cases)
  - [x] Unit tests: `HttpTransport` (batching, flush, retry, backoff, filter, transform)
  - [x] Unit tests: log level filtering
  - [x] Unit tests: child logger binding inheritance
  - [x] Unit tests: `ConsoleTransport`, `StreamTransport`, `FileTransport`
  - [x] Unit tests: all formatters (Pretty, JSON, Text, Silent)
  - [x] Unit tests: timestamp configuration, `formatTimestamp`, `resolveTimestampConfig`, `setTimestamp`, high-resolution timestamps
  - [ ] Integration tests: Browser environment (happy-dom) — deferred

---

## P2 — DX Wins

- [x] **Performance benchmarks vs. existing loggers**
  - [x] Benchmark script comparing Console vs Pino vs Winston vs Bunyan
  - [x] Throughput: ops/sec for simple string log, string + fields, child logger log
  - [x] Latency: p50/p95/p99 per log call (silent mode, JSON mode, pretty mode)
  - [x] Bundle size comparison: minified, gzipped, dependency count, install size
  - [x] Memory: RSS growth over 100k/1M log entries (with and without circular buffer)
  - [x] Startup time: time to first log (import + construct + first `.info()`)
  - [x] File transport: write throughput (NDJSON lines/sec to disk)
  - [x] Publish results in `docs/guide/performance.md` and `benchmarks/README.md`
  - [x] Add `npm run benchmark` script
  - [ ] CI job to track regressions (optional)

- [x] **Hot path optimization (close gap with Pino)**
  - [x] Lazy Date via `Object.create(ENTRY_PROTO)` — prototype getter materializes Date on first access
  - [x] `_hasBindings` flag — skip `{ ...bindings, ...fields }` spread for root loggers
  - [x] `_isNoop` fast path — single boolean short-circuit before arg parsing (matches Pino disabled)
  - [x] `buffer: false` default in Node.js — skip circular buffer push entirely
  - [x] Inlined `parseArgs` for `(string)` and `(string, object)` — skip polymorphic cascade
  - [x] `EMPTY_FIELDS` shared frozen object — avoid `{}` allocation for simple string logs
  - [x] Removed deprecated `logtype` from entry construction
  - [x] `_isSilent` / `_hasTransports` / `_bufferEnabled` cached flags
  - [x] **Pino-style method replacement** — `.info()` etc. replaced with `noop` when level is above threshold or logger is silent; `setLevel()` / `addTransport()` re-bind all 7 methods
  - [x] Target achieved: 7M ops/sec silent, 13.7M child-no-buffer (was 3.1M / 5.1M)
  - [ ] Make `messages: args` storage opt-in or remove — costs ~20-30 bytes per entry in buffer mode

- [ ] **OpenTelemetry transport (OTLP/HTTP)**
  - [ ] `OtlpTransport` that speaks OTLP/HTTP JSON protocol (no gRPC dependency)
  - [ ] POST to `http://localhost:4318/v1/logs` (OTel Collector default) or custom endpoint
  - [ ] Map `LogEntry` to OTLP `LogRecord` schema: `timeUnixNano`, `severityNumber`, `severityText`, `body`, `attributes`
  - [ ] Map Console levels to OTLP severity numbers (trace=1, debug=5, info=9, warn=13, error=17, fatal=21)
  - [ ] Include `hrTime` as `timeUnixNano` when available for nanosecond precision
  - [ ] Resource attributes: `service.name` from namespace, configurable extra attributes
  - [ ] Batching and retry (reuse `HttpTransport` patterns)
  - [ ] Works with OTel Collector → fan out to Kibana/Elasticsearch, Grafana Loki, Prometheus, Datadog, Jaeger, etc.

- [ ] **Elasticsearch bulk API transport**
  - [ ] Direct ingest to Elasticsearch without OTel Collector middleman
  - [ ] NDJSON bulk format: `{ "index": { "_index": "logs" } }\n{ ...logEntry }\n`
  - [ ] Configurable index name/pattern (e.g., `logs-YYYY.MM.DD`)
  - [ ] Authentication: API key, basic auth, bearer token

- [x] **Redaction**
  - [x] `redact: string[]` option accepting dot-path field names
  - [x] Replace matched values with `[REDACTED]` before any output or transport
  - [x] Child loggers inherit parent redact paths (union merge, security invariant)
  - [x] Browser-only `disableRedaction()` runtime toggle via `exposeToWindow()`
  - [x] Exported utilities: `compileRedactPaths()`, `applyRedaction()`, `REDACTED`

- [ ] **Serializers**
  - [ ] `serializers` option: `{ err: ..., req: ..., res: ... }`
  - [ ] Ship built-in `stdSerializers` for `Error`, HTTP `req`/`res`

- [x] **Graceful shutdown**
  - [x] `Konsole.shutdown()` flushes and destroys all registered loggers
  - [x] `Konsole.enableShutdownHook()` registers `SIGTERM`/`SIGINT`/`beforeExit` handlers (Node.js only)
  - [x] Idempotent — safe to call `enableShutdownHook()` multiple times

- [ ] **`DEBUG=*` namespace filtering**
  - [ ] Support `DEBUG=konsole:*` env var pattern (like the `debug` npm package)
  - [ ] Allows namespace-level enable/disable without code changes — drop-in upgrade path for teams using `debug`
  - [ ] Glob/wildcard matching: `DEBUG=konsole:http,konsole:db` or `DEBUG=*`

- [ ] **Transport error observability**
  - [ ] `HttpTransport` `onError(err, droppedEntries)` callback option — currently silent on failure after retries
  - [ ] `maxQueueSize` option on `HttpTransport` — retry queue is currently unbounded; cap with `'drop-oldest'` / `'drop-newest'` overflow strategy
  - [ ] `StreamTransport`: check `stream.write()` return value and handle backpressure — currently ignored, can lose logs under high throughput

- [ ] **Input validation**
  - [ ] `setLevel()` should throw (or warn) on invalid level strings — currently silent undefined behavior
  - [ ] Guard `child()` against non-serializable bindings (circular refs will throw in worker `postMessage`)

- [ ] **Auto metadata in Node.js** *(moved from P3 — low effort, high aggregator compat)*
  - [ ] Include `pid` and `hostname` in JSON log entries automatically (Pino parity, used by Datadog/Loki for routing)
  - [ ] Opt-out via `{ pid: false, hostname: false }` on `KonsoleOptions`

- [ ] **Numeric epoch timestamps in JSON**
  - [ ] Option to emit `"time": 1718448225123` (epoch ms) instead of ISO string in JSON output for fast parsing (Pino parity)
  - [ ] Already possible via `timestamp: 'unixMs'` — document as a recommended pattern

---

## P3 — Advanced

- [ ] **AsyncLocalStorage context propagation** (Node.js)
  - [ ] `Konsole.runWithContext(store, fn)` to bind context to async scope
  - [ ] Auto-merge context store into every log entry within the scope
  - [ ] Enables automatic `requestId` propagation in Express/Fastify middleware without passing child loggers manually

- [ ] **API ergonomics cleanup**
  - [ ] Rename `criteria` → keep as advanced `filter` option, `level` handles common case
  - [ ] `viewLogs()` moved to a dev-only utility / debug helper, not core API
  - [ ] Expand `KonsolePublic` interface to expose all logging methods

- [ ] **Replace inline worker string**
  - [ ] Move worker logic to `src/worker.ts` as a proper TypeScript module
  - [ ] Bundle with Vite `?worker` import or separate entry point
  - [ ] Remove `getWorkerCode()` string template from `Konsole.ts`

- [x] **File rotation**
  - [x] Size-based rotation (e.g., 10MB per file)
  - [x] Time-based rotation (daily, hourly)
  - [x] Configurable max retained files
  - [x] Optional gzip compression of rotated files
  - [ ] Smart filename patterns based on rotation type:
    - Time-based → date suffix: `app-2026-04-05.log` (daily), `app-2026-04-05-14.log` (hourly)
    - Size-based → numeric suffix: `app.log.1`, `app.log.2` (current behavior)
    - Combined → time suffix with counter: `app-2026-04-05.log`, `app-2026-04-05-1.log`
    - `maxFiles` cleanup by oldest date (glob + parse) instead of highest index
    - Insert date before extension (`app-2026-04-05.log` not `app.log.2026-04-05`)

- [ ] **Loki push API transport**
  - [ ] Native Grafana Loki ingest format (labels + log lines)
  - [ ] Map namespace to Loki label, structured fields to JSON body

- [ ] **Syslog transport (RFC 5424)**
  - [ ] For legacy SIEM/syslog infrastructure integration

---

## Done

- [x] **Platform worker adapter** (v4.3.0)
  - [x] `createPlatformWorker()` factory in `src/workerAdapter.ts` with unified `KonsoleWorker` interface
  - [x] Browser: Web Worker via Blob + Object URL
  - [x] Node.js: `worker_threads` via dynamic import with `parentPort` shim
  - [x] Message buffering for async Node.js worker initialization
  - [x] Graceful fallback to main thread if no worker API available
  - [x] Conditional `node` / `browser` exports in `package.json`
  - [x] Tests: creation, echo, buffering, terminate, full Konsole worker code
  - [x] Updated all docs, site, README, CLAUDE.md, and changelog
