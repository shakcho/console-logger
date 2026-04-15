# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.5.0] - 2026-04-15

### Added

- **Serializers** — pluggable per-field transforms on `KonsoleOptions` and `KonsoleChildOptions`
  - New `serializers` option accepts a `Record<string, (value) => unknown>` map
  - Built-in `stdSerializers` for `err`, `req`, and `res` (Pino-compatible shapes)
  - `serializeError` flattens an `Error` to `{ type, message, stack, ...customProps, cause? }` — fixes the long-standing `JSON.stringify(err) === "{}"` foot-gun
  - `serializeRequest` / `serializeResponse` cover Node `http.IncomingMessage`, Express, and Fetch `Request`/`Response`
  - Child loggers inherit parent serializers and can override per key
  - New exports: `stdSerializers`, `serializeError`, `serializeRequest`, `serializeResponse`, `applySerializers`, `Serializer`, `Serializers`

- **Auto Error flattening** — `Konsole.addLog` now expands any field whose value is an `Error` even when no explicit serializer is configured, so logs never silently emit `"err":{}`

### Fixed

- `parseArgsSlow` multi-arg join no longer renders Errors as `{}`; they're expanded via `serializeError`
- `JsonFormatter`, `transports/base.toJsonLine`, and the pretty/text field renderer all expand nested `Error` values inside fields via a shared JSON replacer
- Cycle safety: `err.self = err`, mutual `cause` chains, and deeply nested cyclic graphs inside custom error props all serialize without throwing — replaced with `"[Circular]"` only on the current walk path
- Repeated non-cyclic references across sibling branches are preserved as full copies (not collapsed to `[Circular]`)
- `toJSON` passthrough — `URL`, `Buffer`, `Date`, Decimal, Moment, Temporal, etc. round-trip through their canonical form instead of becoming `{}`
- Own `__proto__` keys on parsed JSON payloads (e.g. `JSON.parse('{"__proto__":…}')`) survive serialization as own data properties without polluting `Object.prototype`
- `RegExp` values on custom error props serialize to `/pattern/flags` (or expand with `source`/`flags` plus custom props), with full cycle detection
- `applySerializers` only honors own keys on the serializer map, so a field literally named `hasOwnProperty` or `toString` no longer picks up `Object.prototype` methods
- Fetch `Headers`, subclasses, polyfills, and `Map`-like header containers are flattened by interface (`forEach`/`entries`) instead of by `constructor.name`, so redaction paths like `req.headers.authorization` see the actual values
- Header normalization preserves a header literally named `__proto__` as an own data property via null-prototype output objects

---

## [4.4.0] - 2026-04-05

### Added

- **File rotation** — New `rotation` option on `FileTransportOptions`
  - Size-based rotation: `maxSize` in bytes (e.g. `10 * 1024 * 1024` for 10 MB)
  - Time-based rotation: `interval` accepts `'daily'`, `'hourly'`, or a number (ms)
  - Retention: `maxFiles` caps the number of rotated files (default: 5); oldest are deleted
  - Compression: `compress: true` gzip-compresses rotated files asynchronously (`.gz` suffix)
  - Naming: numeric suffix — `app.log` → `app.log.1` → `app.log.2`; current file stays at configured path
  - No entry loss: writes during rotation are buffered and flushed after the new file opens
  - Byte counter seeded from existing file size on append mode — rotation triggers correctly on restart
  - New export: `RotationOptions` type

---

## [4.3.0] - 2026-03-30

### Added

- **Platform worker adapter** — `useWorker: true` now works on both browser and Node.js
  - Browser: Web Worker via Blob + Object URL (unchanged)
  - Node.js: `worker_threads` via dynamic import with `parentPort` shim
  - Unified `KonsoleWorker` interface in `src/workerAdapter.ts`
  - Messages sent before the Node.js worker is ready are buffered and flushed automatically
  - Falls back gracefully to main-thread processing if no worker API is available
  - New exports: `createPlatformWorker()`, `KonsoleWorker` type

- **Conditional `node` / `browser` exports** in `package.json` for better bundler support

### Changed

- `useWorker: true` is no longer browser-only — it is now supported in Node.js via `worker_threads`
- Removed the "Web Worker is not available" console warning in Node.js (worker is now created instead)

---

## [4.2.0] - 2026-03-28

### Added

- **Field redaction** — New `redact` option on `KonsoleOptions` and `KonsoleChildOptions`
  - Accepts dot-notation field paths: `redact: ['password', 'req.headers.authorization']`
  - Values replaced with `'[REDACTED]'` before any output, transport, or buffer
  - Children inherit parent redact paths (security invariant — cannot opt out) and can add more
  - Applied after bindings merge, before all consumers
  - Original caller objects are never mutated
  - New exports: `compileRedactPaths()`, `applyRedaction()`, `REDACTED`

- **Graceful shutdown** — New static methods for clean process exit
  - `Konsole.shutdown()` — flushes and destroys all registered loggers
  - `Konsole.enableShutdownHook()` — registers `SIGTERM`, `SIGINT`, and `beforeExit` handlers (Node.js only, no-op in browser)

- **Browser runtime redaction toggle** — `__Konsole.disableRedaction(true/false)` via `exposeToWindow()`
  - Temporarily bypass redaction in DevTools for debugging
  - Not available in Node.js — server-side redaction is always enforced

---

## [4.0.0] - 2026-03-19

### Added

- **Configurable timestamps** — New `timestamp` option on `KonsoleOptions` and `KonsoleChildOptions`
  - Preset formats: `'datetime'` (default), `'iso'`, `'time'`, `'date'`, `'unix'`, `'unixMs'`, `'none'`
  - Custom function: `(date: Date, hrTime?: number) => string`
  - Full options object: `{ format: TimestampFormat, highResolution: boolean }`
  - New `TimestampFormat` and `TimestampOptions` types exported

- **Full date in timestamps** — Pretty, text, and browser formatters now show `YYYY-MM-DD HH:MM:SS.mmm` by default (was time-only `HH:MM:SS.mmm`)

- **Browser formatter timestamps** — `BrowserFormatter` now renders timestamps in DevTools output (previously omitted, relying on DevTools built-in timestamps)

- **High-resolution timestamps** — `{ highResolution: true }` captures nanosecond-precision monotonic timing
  - `LogEntry.hrTime` field (nanoseconds via `process.hrtime.bigint()` in Node.js, `performance.now()` in browsers)
  - Included in JSON output when present
  - Custom timestamp functions receive `hrTime` as the second argument

- **Runtime timestamp control** — New `setTimestamp()` instance method
  - Accepts preset strings, custom functions, or `TimestampOptions` objects
  - Recreates the internal formatter with the new format

- **Browser runtime timestamp control** — `exposeToWindow()` now exposes:
  - `__Konsole.setTimestamp(format)` — change all loggers
  - `__Konsole.getLogger(ns).setTimestamp(format)` — change a specific logger
  - `__Konsole.getLogger(ns).setLevel(level)` — change level from DevTools

- **Child logger timestamp override** — `child(bindings, { timestamp })` can override the parent's timestamp format

- **New exports** — `resolveTimestampConfig()`, `formatTimestamp()`, `getHrTime()`, `FormatterOptions`

- **Performance optimizations** — on par with Pino on per-call overhead, faster on JSON serialization
  - `buffer` option: defaults to `false` in Node.js (no circular buffer overhead), `true` in browsers
  - Disabled log levels add zero overhead
  - Optimized argument parsing and field merging on the hot path
  - Removed deprecated `logtype` field from entry construction

- **Benchmark suite** — `npm run benchmark` compares against Pino, Winston, and Bunyan
  - Throughput (ops/sec), latency (p50/p95/p99), bundle size, and memory usage
  - Daily CI benchmark via GitHub Actions (`.github/workflows/benchmark.yml`)

### Changed

- Default timestamp format changed from time-only (`HH:MM:SS.mmm`) to `datetime` (`YYYY-MM-DD HH:MM:SS.mmm`) for pretty, text, and browser formatters
- `toTextLine()` in file/stream transports now outputs `YYYY-MM-DD HH:MM:SS.mmm` (was time-only)
- `createFormatter()` and `createAutoFormatter()` accept an optional `tsFormat` parameter
- All formatter classes now accept `FormatterOptions` with an optional `timestampFormat` field
- Child loggers get their own formatter instance when overriding `timestamp` (previously always shared with parent)
- In Node.js, `buffer` defaults to `false` — `getLogs()` / `viewLogs()` return empty unless `buffer: true` is set explicitly
- Disabled log levels add zero per-call overhead in Node.js

### Breaking Changes

- **Default timestamp format changed** — Pretty, Text, and Browser formatters now output `YYYY-MM-DD HH:MM:SS.mmm` (was `HH:MM:SS.mmm`). Restore old behavior with `timestamp: 'time'`.
- **BrowserFormatter now renders timestamps** — DevTools output includes a timestamp prefix. Use `timestamp: 'none'` to omit.
- **`buffer` defaults to `false` in Node.js** — `getLogs()`, `viewLogs()`, and `getStats()` return empty unless `buffer: true` is set. Browser default is unchanged (`true`).
- **`logtype` field removed from entries** — The deprecated `LogEntry.logtype` is no longer set. Use `entry.level` instead (available since v3.0.0).
- **`toTextLine()` output changed** — File and stream transport text format now includes the full date (`YYYY-MM-DD HH:MM:SS.mmm`), matching the formatter default.

### Migration from v3

```typescript
// Restore v3 timestamp format
new Konsole({ timestamp: 'time' });

// Restore v3 buffer behavior in Node.js
new Konsole({ buffer: true });

// Replace logtype usage
entry.logtype  // ❌ undefined in v4
entry.level    // ✅ 'info', 'error', etc.
```

---

## [3.0.0] - 2025-03-14

### Added

- **Node.js compatibility** — Works in both browser and Node.js ≥ 18
  - Replaced `window` usage with `globalThis` throughout
  - `fetch` is detected via `globalThis.fetch`; pass `fetchImpl` for Node.js < 18
  - Graceful warning when `useWorker: true` is set in Node.js (removed in v4.3.0 — now supported natively)

- **Numeric log levels** — Six-level numeric system
  - New methods: `trace()` (10), `debug()` (20), `fatal()` (60)
  - `log()` kept as an alias for `info()` (30)
  - New `level` constructor option — minimum threshold; entries below are discarded entirely
  - New `setLevel()` instance method for runtime changes
  - `LogEntry` now includes `level` and `levelValue` fields

- **Structured logging** — Consistent JSON schema
  - Log entries now carry `msg` and `fields` (structured key-value pairs) in addition to `messages`
  - Fields spread into the top level of JSON output: `{ level, levelName, time, namespace, msg, ...fields }`
  - Object-first calling convention: `logger.info({ msg: '...', key: val })`
  - String + fields object: `logger.info('msg', { key: val })`
  - `Error` as first argument: `msg` = `err.message`, `fields.err` = the Error

- **Output formatters** — `format` constructor option (`'auto' | 'pretty' | 'json' | 'text' | 'browser' | 'silent'`)
  - `PrettyFormatter` — ANSI-colored human-readable output for TTY terminals; respects `NO_COLOR` / `FORCE_COLOR`
  - `JsonFormatter` — Newline-delimited JSON for pipes, CI, and log aggregators
  - `TextFormatter` — Plain text, no ANSI, for CI environments
  - `BrowserFormatter` — `%c` CSS badge styling in browser DevTools
  - `SilentFormatter` — No output; entries still stored in buffer and forwarded to transports
  - `auto` selects the best formatter for the current environment automatically
  - Errors and fatals always route to `stderr`; all other levels to `stdout`

- **Child loggers** — `logger.child(bindings, options?)`
  - Bindings automatically merged into every entry the child produces
  - Bindings accumulate through nested children; call-site fields override on collision
  - Optional `{ namespace, level }` overrides per child
  - Children share parent's circular buffer and formatter
  - Children are not registered in `Konsole.instances` (ephemeral)
  - `child.addTransport()` does not affect parent

- **Transport abstraction** — New `Transport` interface with `write`, `flush?`, `destroy`
  - `HttpTransport` — renamed from `Transport`; updated payload to structured JSON schema
  - `ConsoleTransport` — wraps a Formatter; useful with `format: 'silent'`
  - `FileTransport` — appends NDJSON/text to a file; Node.js only; buffers entries during async open
  - `StreamTransport` — writes to any `WritableLike`; duck-typed for compatibility
  - `addTransport()` and `transports` option now accept both `Transport` instances and `TransportConfig` objects

- **Vitest test suite** — 92 tests across 8 files covering all core components and transports

### Changed

- `criteria` is now **deprecated** — use `level` for threshold filtering and `format: 'silent'` to suppress output
- `TransportConfig` no longer the only type accepted by `transports`/`addTransport()` — both `Transport` instances and `TransportConfig` plain objects are accepted
- `LogEntry.logtype` is deprecated — use `LogEntry.level`
- Rollup now externalizes all `node:` built-ins to prevent browser stubs

### Breaking Changes

- `LogEntry` shape changed: added `msg`, `fields`, `level`, `levelValue`; `logtype` is now `@deprecated`
- Old `Transport` class is now `HttpTransport`; `src/Transport.ts` is a deprecated re-export
- `criteria: false` (the old default) is superseded by `format: 'silent'`

---

## [2.0.0] - 2024-12-27

### Added

- **Circular Buffer Storage** — Memory-efficient log storage with configurable `maxLogs` limit
  - Automatically evicts oldest logs when capacity is reached
  - New `CircularBuffer` class exported for custom use

- **Web Worker Support** — Offload log processing to background thread
  - Enable with `useWorker: true` option
  - New `getLogsAsync()` method for async log retrieval

- **Transport System** — Send logs to external services
  - Configurable `batchSize`, `flushInterval`, retry with exponential backoff
  - Filter and transform per entry
  - New `addTransport()` and `flushTransports()` methods

- **Memory Statistics** — `getStats()` returns log count and buffer usage

- **Global Transport** — `Konsole.addGlobalTransport()` static method

### Changed

- `destroy()` method is now async and returns a Promise
- Log storage uses `CircularBuffer` instead of a plain array

### Fixed

- `viewLogs()` no longer shows "Array(1)" — messages are correctly formatted

---

## [1.0.0] - 2024-01-01

### Added

- Initial release
- Namespaced logging with `Konsole` class
- Log levels: `log`, `error`, `warn`, `info`
- In-memory log storage with automatic cleanup
- Conditional logging with boolean and function criteria
- `viewLogs()` for batch viewing of stored logs
- `getLogs()` for programmatic access
- `clearLogs()` to remove all stored logs
- `Konsole.getLogger()`, `exposeToWindow()`, `enableGlobalPrint()`
- Configurable retention period and cleanup interval
- Full TypeScript support with exported types
- Zero dependencies

### Security

- Window exposure is opt-in and can be conditionally enabled
