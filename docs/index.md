---
layout: home
title: Console Logger — JavaScript Logger for Browser & Node.js
titleTemplate: false
description: Console Logger is a structured, namespaced JavaScript and TypeScript logger for browser and Node.js. Six log levels, child loggers, beautiful console output, configurable timestamps, redaction, and flexible HTTP/file transports — zero dependencies, ~10 KB gzipped.

hero:
  name: "Console Logger"
  text: "JavaScript Logger for Browser & Node.js"
  tagline: Structured, namespaced console logging with child loggers, beautiful terminal output, and flexible transports — TypeScript-first, zero dependencies, ~10 KB.
  image:
    src: /logo.svg
    alt: Console Logger
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/shakcho/console-logger

---

<div class="demo-wrap">

## A console logger that works everywhere

**Console Logger** is a TypeScript-first JavaScript logger built for both **browser** and **Node.js**. It replaces `console.log` with structured, namespaced logging — six numeric log levels (`trace`, `debug`, `info`, `warn`, `error`, `fatal`), child loggers that carry request context, beautiful ANSI terminal output, browser DevTools styling, redaction, and pluggable transports (HTTP, file, stream).

Where most loggers force you to pick a side — Pino, Winston, and Bunyan are Node-only, while `loglevel` and `debug` are browser-only — Console Logger is one library that runs in both. Same API. Same JSON schema. Auto-detects the environment and picks the right format: pretty ANSI in a TTY, NDJSON in CI, styled `%c` badges in the browser console.

```ts
import { Konsole } from 'konsole-logger';

const log = new Konsole({ namespace: 'App' });

log.info('Server started', { port: 3000 });   // INF [App] Server started port=3000
log.warn('Slow query', { ms: 812, sql });      // WRN [App] Slow query ms=812 sql=...
log.error(new Error('DB unreachable'));        // ERR [App] DB unreachable

const req = log.child({ requestId: 'r_42' });  // attaches requestId to every line
req.debug('Cache miss');                        // DBG [App] Cache miss requestId=r_42
```

</div>

<div class="demo-wrap feature-grid-wrap">

<div class="feature-grid">
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">🌐</span><h3>Browser &amp; Node.js</h3></div>
    <p>Same API on both. Auto-picks ANSI, NDJSON, or DevTools.</p>
  </div>
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">🏷️</span><h3>Child loggers</h3></div>
    <p><code>child({ requestId })</code> attaches context to every line.</p>
  </div>
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">📊</span><h3>Structured JSON</h3></div>
    <p>Pino-compatible schema with six numeric levels.</p>
  </div>
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">⏱️</span><h3>Timestamps</h3></div>
    <p>ISO, epoch, custom, or nanosecond — switchable at runtime.</p>
  </div>
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">🔒</span><h3>Redaction</h3></div>
    <p>Mask passwords &amp; PII with dot-notation paths.</p>
  </div>
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">🚚</span><h3>Transports</h3></div>
    <p>HTTP batching, file rotation + gzip, streams.</p>
  </div>
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">🧵</span><h3>Worker mode</h3></div>
    <p>Off-main-thread storage and HTTP batching.</p>
  </div>
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">📦</span><h3>TypeScript-first</h3></div>
    <p>Full types, zero runtime dependencies.</p>
  </div>
  <div class="feature-cell">
    <div class="feature-head"><span class="feature-icon">⚡</span><h3>~10 KB gzipped</h3></div>
    <p>On par with Pino; smaller than Winston and Bunyan.</p>
  </div>
</div>

</div>

<script setup>
import CodeTabs from './.vitepress/theme/components/CodeTabs.vue';
import BufferDrawer from './.vitepress/theme/components/BufferDrawer.vue';
import { FEATURE_SNIPPETS, USAGE_SNIPPETS } from './.vitepress/theme/components/snippets';
</script>

<div class="demo-wrap">

<CodeTabs title="Code Snippets" :snippets="FEATURE_SNIPPETS" />

<CodeTabs
  title="Usage Examples"
  intro="Console has no framework dependency — it works everywhere: React, plain HTML, and Node.js servers."
  :snippets="USAGE_SNIPPETS"
/>

## Benchmarks

Measured on Apple M5 Max, Node.js v24.15, 100K iterations. Pino, Winston, and Bunyan
are Node.js only; Consola runs in the browser but without worker offloading. Console
runs in both with worker offloading. Run `npm run benchmark` to reproduce.

**Production throughput** — async / buffered JSON, the path real apps use; time to emit + fully flush 100K lines to `/dev/null` (higher is better)

| Logger                  | ops/sec        |
| ----------------------- | -------------- |
| **Console**             | **~790K**      |
| Consola                 | ~750K          |
| Bunyan                  | ~655K          |
| Winston                 | ~615K          |
| Pino                    | ~500K          |

**Strict per-line cost** — every logger serializes and *synchronously* writes each line (worst-case; no batching). Pino's `sonic-boom` leads here; Console is a close second.

| Logger                  | ops/sec        | p50      |
| ----------------------- | -------------- | -------- |
| Pino                    | ~710K          | 1.10 µs  |
| **Console**             | **~595K**      | **1.42 µs** |
| Consola                 | ~580K          | 1.54 µs  |
| Bunyan                  | ~505K          | 1.70 µs  |
| Winston                 | ~435K          | 1.49 µs  |

**Disabled / silent** — microbenchmark for per-call overhead (not a realistic throughput; nobody ships silenced loggers)

| Mode                          | Console    | Pino     | Consola  | Winston  |
| ----------------------------- | ---------- | -------- | -------- | -------- |
| Silent / disabled             | 10.38M     | 12.23M   | 12.69M   | 2.45M    |
| Child (silent / disabled)     | 33.04M     | 34.47M   | 32.73M   | 2.32M    |

Console, Pino, and Consola are within run-to-run V8 noise on the silent path. On the buffered path real apps use, **Console is the fastest of the field** — and on the worst-case synchronous-per-line test it's a close second to Pino's `sonic-boom` — all with zero dependencies and native browser support.

**Browser-only**

| Scenario             | Console        |
| -------------------- | -------------- |
| Silent + buffer      | **6.15M**      |
| With Worker          | **non-blocking** |

**Bundle & install size** (smaller is better)

|              | Console     | Pino     | Winston | Bunyan  | Consola |
| ------------ | ----------- | -------- | ------- | ------- | ------- |
| Bundle (gzip)| **~10 KB**  | ~32 KB   | ~70 KB  | ~45 KB  | ~12 KB  |
| Install size | **135 KB**  | 1.17 MB  | 360 KB  | 212 KB  | 420 KB  |
| Dependencies | **0**       | 11       | 11      | 0       | 0       |

See the [Performance Guide](/guide/performance) for details.

<ClientOnly>
  <BufferDrawer />
</ClientOnly>

</div>

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --vp-home-hero-image-background-image: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --vp-home-hero-image-filter: blur(44px);
}

.dark {
  --vp-home-hero-image-background-image: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
</style>
