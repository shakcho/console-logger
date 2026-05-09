---
title: What is Console Logger?
description: Console Logger is a structured, namespaced JavaScript and TypeScript logger that works in both browser and Node.js. Learn what it does and why developers choose it over plain console.log, Pino, Winston, or Bunyan.
---

# What is Console Logger?

**Console Logger** (npm: `konsole-logger`) is a structured, namespaced JavaScript and TypeScript logger that works in both **browser** and **Node.js**. It's a drop-in upgrade from `console.log` that adds log levels, child loggers, structured JSON output, and pluggable transports — beautiful ANSI in your terminal, styled `%c` badges in DevTools, NDJSON in CI.

- **Structured logging** with a consistent JSON schema
- **Namespaced logging** for organized, component-specific logs
- **Child loggers** that inherit config and attach request-scoped context
- **Async context propagation** — `runWithContext()` auto-binds `requestId`/`traceId` across async boundaries (Node.js)
- **Beautiful terminal output** with ANSI colors and human-readable formatting
- **Field redaction** — mask sensitive data before it reaches any destination
- **Multiple transports** — HTTP, file, stream, or console
- **Memory-efficient storage** with circular buffers
- **Worker support** for background processing (Web Worker in browsers, `worker_threads` in Node.js)
- **Node.js and browser** — works in both without any configuration

## Why Console?

Traditional `console.log` statements have several limitations:

1. **No organization** — Logs from different parts of your app mix together
2. **No levels** — No trace/debug/info/warn/error/fatal distinction
3. **No structure** — Can't easily parse logs or send them to aggregators
4. **No context** — No way to attach request IDs or user context automatically
5. **No history** — Once a log scrolls off screen, it's gone
6. **No backend** — You can't send logs to a server for analysis

Console solves all of these while remaining lightweight and dependency-free.

## Comparison

| Feature | console.log | Console |
|---------|-------------|---------|
| Namespacing | ❌ | ✅ |
| Child loggers | ❌ | ✅ |
| Numeric log levels | ❌ | ✅ |
| Structured JSON output | ❌ | ✅ |
| Pretty terminal output | ❌ | ✅ built-in |
| Configurable timestamps | ❌ | ✅ (ISO, epoch, custom, nanosecond) |
| Field redaction | ❌ | ✅ (dot-notation paths, inherited by children) |
| Browser DevTools styling | ❌ | ✅ |
| Log storage / history | ❌ | ✅ |
| Multiple transports | ❌ | ✅ |
| File transport | ❌ | ✅ |
| Worker transport | ❌ | ✅ (non-blocking logging in browser and Node.js) |
| Type safety | ❌ | ✅ |
| Zero dependencies | ✅ | ✅ |
| Browser + Node.js | ✅ (basic) | ✅ (structured, with DevTools tooling) |
| Bundle (gzip) | 0 KB | ~10 KB (vs Pino ~32 KB, Winston ~70 KB) |

## Philosophy

- **Zero dependencies** — No bloat, no supply chain risk
- **TypeScript first** — Full type safety out of the box
- **DX over config** — Works beautifully out of the box; sensible defaults for every environment
- **Production-ready** — Structured output for log aggregators; debug tooling for production incidents

## Guides

- [Getting Started](/guide/getting-started) — Installation and basic usage
- [Configuration](/guide/configuration) — All available options
- [Namespaces & Child Loggers](/guide/namespaces) — Organizing logs and attaching context
- [Async Context Propagation](/guide/async-context) — Automatic `requestId` / `traceId` via `AsyncLocalStorage`
- [Log Levels & Output](/guide/conditional-logging) — Controlling what gets logged
- [Timestamps](/guide/timestamps) — Format presets, custom functions, and nanosecond precision
- [Redaction](/guide/redaction) — Masking passwords, tokens, and PII
- [Transports](/guide/transports) — Sending logs to files, streams, and backends
- [Browser Debugging](/guide/browser-debugging) — Production debugging tools
- [Viewing Logs](/guide/viewing-logs) — Batch viewing and filtering
- [Performance](/guide/performance) — Optimization tips
