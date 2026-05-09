---
title: Timestamps
description: Configure log timestamps in Console Logger — ISO 8601, epoch seconds/ms, time-only, custom function, or nanosecond precision. Change format at runtime.
---

# Timestamps

Every log entry includes a timestamp. By default, Console uses `datetime` format — a full local date and time with millisecond precision:

```
2025-03-16 10:23:45.123  INF  [App]  Server started  port=3000
```

You can configure the format per-logger, change it at runtime, and even enable nanosecond-precision high-resolution timing.

## Timestamp Formats

| Preset | Output | Notes |
|--------|--------|-------|
| `'datetime'` | `2025-03-16 10:23:45.123` | Default for pretty, text, and browser |
| `'iso'` | `2025-03-16T10:23:45.123Z` | Default for JSON; UTC, ISO 8601 |
| `'time'` | `10:23:45.123` | Time only, local timezone |
| `'date'` | `2025-03-16` | Date only, local timezone |
| `'unix'` | `1710583425` | Epoch seconds |
| `'unixMs'` | `1710583425123` | Epoch milliseconds |
| `'none'` | *(omitted)* | No timestamp in output |

## Setting the Format

### At construction time

```typescript
import { Konsole } from 'konsole-logger';

// ISO timestamps
const logger = new Konsole({ namespace: 'App', timestamp: 'iso' });

// Epoch milliseconds (useful for JSON log pipelines)
const logger = new Konsole({ namespace: 'App', timestamp: 'unixMs' });

// No timestamps
const logger = new Konsole({ namespace: 'App', timestamp: 'none' });
```

### At runtime

```typescript
logger.setTimestamp('iso');
logger.setTimestamp('unixMs');
logger.setTimestamp('none');
```

This is especially useful in browsers where you might want to switch formats during a debugging session.

## Custom Format Functions

Pass a function for full control over timestamp formatting:

```typescript
const logger = new Konsole({
  namespace: 'App',
  timestamp: (date) => date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
  }),
});
```

Custom functions receive the `Date` object and an optional `hrTime` (nanoseconds) when high-resolution is enabled:

```typescript
const logger = new Konsole({
  namespace: 'App',
  timestamp: {
    format: (date, hrTime) => {
      const iso = date.toISOString();
      return hrTime ? `${iso} [hr:${hrTime}ns]` : iso;
    },
    highResolution: true,
  },
});
```

## High-Resolution Timestamps

For sub-millisecond timing, enable high-resolution mode:

```typescript
const logger = new Konsole({
  namespace: 'App',
  timestamp: { format: 'iso', highResolution: true },
});

logger.info('request started');
logger.info('request completed');
```

When enabled:
- Each `LogEntry` gets an `hrTime` field containing nanoseconds from a monotonic clock
- **Node.js** uses `process.hrtime.bigint()` (true nanosecond precision)
- **Browsers** use `performance.now()` (microsecond precision, converted to nanoseconds)
- The JSON formatter includes `hrTime` in output: `{"hrTime": 123456789, ...}`

::: tip When to use high-resolution timestamps
High-resolution timestamps are useful for:
- Measuring latency between operations (e.g., request start → DB query → response)
- Performance profiling in production
- Correlating logs with high-precision tracing systems

The standard `Date` timestamp is still the source of truth for wall-clock time. `hrTime` is relative to process/page start — useful for intervals, not absolute time.
:::

## Per-Formatter Defaults

Each formatter has a sensible default:

| Formatter | Default | Reason |
|-----------|---------|--------|
| `PrettyFormatter` | `'datetime'` | Human-readable with full context |
| `TextFormatter` | `'datetime'` | Same as pretty, without colors |
| `BrowserFormatter` | `'datetime'` | Visible in DevTools alongside the styled badge |
| `JsonFormatter` | `'iso'` | Machine-parseable, UTC, Pino-compatible |

When you set `timestamp` on the constructor, it overrides these defaults for all formatters.

## Child Logger Timestamp Override

Child loggers inherit the parent's timestamp config by default. Override it per-child:

```typescript
const logger = new Konsole({ namespace: 'App', timestamp: 'datetime' });

// This child uses ISO timestamps
const audit = logger.child({ type: 'audit' }, { timestamp: 'iso' });

// This child uses epoch milliseconds
const metrics = logger.child({ type: 'metrics' }, { timestamp: 'unixMs' });
```

::: info
When a child overrides the timestamp format, it gets its own formatter instance (normally children share the parent's formatter).
:::

## Browser Runtime Control

After calling `Konsole.exposeToWindow()`, you can change timestamps from the browser DevTools console:

```javascript
// Change all loggers at once
__Konsole.setTimestamp('iso')
__Konsole.setTimestamp('time')
__Konsole.setTimestamp('none')

// Change a specific logger
__Konsole.getLogger('Auth').setTimestamp('unixMs')

// Custom function
__Konsole.setTimestamp((d) => d.toLocaleString('ja-JP'))
```

This is useful for debugging — switch to ISO timestamps when correlating with server logs, or to `'none'` to reduce noise.

## JSON Output

The JSON formatter outputs timestamps in the `time` field:

```json
{"level":30,"levelName":"info","time":"2025-03-16T10:23:45.123Z","namespace":"App","msg":"hello"}
```

With `timestamp: 'unixMs'`:
```json
{"level":30,"levelName":"info","time":"1710583425123","namespace":"App","msg":"hello"}
```

With `highResolution: true`, the `hrTime` field is added:
```json
{"level":30,"levelName":"info","time":"2025-03-16T10:23:45.123Z","hrTime":48291537284,"namespace":"App","msg":"hello"}
```

## File and Stream Transports

`FileTransport` and `StreamTransport` use their own serialization:
- **JSON format** (`toJsonLine`): Always uses ISO 8601 for the `time` field, includes `hrTime` when present
- **Text format** (`toTextLine`): Uses `YYYY-MM-DD HH:MM:SS.mmm` (datetime format)

These are independent of the main logger's timestamp setting to ensure consistent, parseable output in log files.
