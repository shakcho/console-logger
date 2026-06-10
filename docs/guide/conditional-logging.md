---
title: Log Levels & Output
description: Six numeric log levels (trace, debug, info, warn, error, fatal) plus three output formats — pretty ANSI, NDJSON, browser. Conditional logging without runtime overhead.
---

# Log Levels & Output

Console gives you two orthogonal controls:

- **`level`** — what gets *stored and processed* (threshold filter)
- **`format`** — how stored entries are *rendered*

## Setting a Level Threshold

Use the `level` option (or `setLevel()`) to discard entries below a certain severity. Discarded entries never reach the buffer, formatters, or transports.

```typescript
import { Konsole } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  level: 'info',  // trace and debug are silently dropped
});

logger.trace('skipped — below threshold');
logger.debug('skipped — below threshold');
logger.info('processed ✅');
logger.warn('processed ✅');
logger.error('processed ✅');
logger.fatal('processed ✅');
```

### Level values

| Method | Level value | Typical use |
|--------|-------------|-------------|
| `.trace()` | 10 | Function entry/exit, loop iterations |
| `.debug()` | 20 | Internal state, dev-facing detail |
| `.info()` | 30 | Operational events |
| `.warn()` | 40 | Unexpected but recoverable |
| `.error()` | 50 | Operation failed (→ stderr) |
| `.fatal()` | 60 | Unrecoverable failure (→ stderr) |

### Runtime level change

```typescript
// Start permissive in dev
logger.setLevel('trace');

// Tighten in production
logger.setLevel('warn');
```

### Environment-based level

```typescript
const logger = new Konsole({
  namespace: 'App',
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
});
```

## Controlling Output Format

The `format` option controls how entries are rendered — independently of the level threshold.

```typescript
// Silent: store everything, print nothing (good for production + transport)
const logger = new Konsole({
  namespace: 'App',
  level: 'info',
  format: 'silent',
  transports: [{ name: 'backend', url: 'https://logs.example.com/ingest' }],
});

// Always pretty regardless of environment
const logger = new Konsole({ namespace: 'App', format: 'pretty' });

// Always NDJSON (useful under PM2 or when piping)
const logger = new Konsole({ namespace: 'App', format: 'json' });
```

See [Configuration](/guide/configuration#format) for the full list of format options.

## Global Enable/Disable

`Konsole.enableGlobalPrint()` overrides all per-logger format/criteria settings and forces output on or off for every logger.

```typescript
// Enable — useful for unsilencing all loggers temporarily in production
Konsole.enableGlobalPrint(true);

// Restore normal per-logger rules
Konsole.enableGlobalPrint(false);
```

::: tip Production debugging
Combine `Konsole.exposeToWindow()` with `enableGlobalPrint` to turn on verbose logging from the browser DevTools console without a code deploy. See [Browser Debugging](/guide/browser-debugging).
:::

## criteria *(deprecated)*

The `criteria` option is still supported but deprecated in favour of `level` + `format`.

::: warning
`criteria: false` suppresses *output only* — entries are still stored in the buffer and forwarded to transports. This differs from `level`, which discards entries completely before any processing.
:::

```typescript
// Old way (still works)
const logger = new Konsole({
  namespace: 'App',
  criteria: (entry) => entry.level === 'error',
});

// New way (preferred)
const logger = new Konsole({
  namespace: 'App',
  level: 'error',
});
```

Update function criteria with `setCriteria()` at runtime:

```typescript
logger.setCriteria((entry) => entry.level === 'fatal'); // runtime update
```

## LogEntry structure

Every log entry forwarded to transport filters, `criteria` functions, and `getLogs()` has this shape:

```typescript
type LogEntry = {
  msg: string;                      // primary message
  messages?: unknown[];             // original arguments — only when keepMessages: true
  fields: Record<string, unknown>;  // structured key-value pairs (includes bindings)
  timestamp: Date;
  hrTime?: number;                  // high-res nanosecond offset (when highResolution: true)
  namespace: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  levelValue: number;               // 10 | 20 | 30 | 40 | 50 | 60
};
```

### Filtering by level in a transport

```typescript
logger.addTransport({
  name: 'errors-only',
  url: 'https://errors.example.com/ingest',
  filter: (entry) => entry.levelValue >= 50, // error and fatal
});
```

### Filtering by field value

```typescript
logger.addTransport({
  name: 'api-logs',
  url: 'https://logs.example.com/api',
  filter: (entry) => entry.namespace.startsWith('API'),
});
```
