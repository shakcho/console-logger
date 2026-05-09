---
title: Getting Started
description: Install Console Logger and write your first structured log line in browser or Node.js. Six log levels, child loggers, namespaces, and zero configuration.
---

# Getting Started with Console Logger

Install `konsole-logger` and write your first structured log line in under a minute. Works in browser and Node.js with zero configuration.

## Installation

::: code-group

```bash [npm]
npm install konsole-logger
```

```bash [yarn]
yarn add konsole-logger
```

```bash [pnpm]
pnpm add konsole-logger
```

:::

::: info Node.js requirement
Node.js **≥ 18** is required for server-side use (requires native `fetch` for HTTP transports). For older Node.js versions, pass a `fetchImpl` option — see [Transports](/guide/transports).
:::

## Quick Start

### Basic Usage

```typescript
import { Konsole } from 'konsole-logger';

const logger = new Konsole({ namespace: 'MyApp' });

// Six numeric log levels
logger.trace('Entering function');        // level 10
logger.debug('Loading config...');        // level 20
logger.info('Server started', { port: 3000 }); // level 30
logger.warn('Config file missing, using defaults');  // level 40
logger.error('Database connection failed', { err }); // level 50
logger.fatal('Out of memory');            // level 60
```

Console automatically selects the best output format for the environment:
- **Terminal (TTY)** → colorized, human-readable pretty output
- **CI / pipes** → newline-delimited JSON (compatible with Datadog, Loki, CloudWatch)
- **Browser** → styled badges in DevTools via `%c`

### Terminal Output

In a TTY terminal you'll see:

```
2024-06-15 10:23:45.123  INF  [MyApp]  Server started  port=3000
2024-06-15 10:23:45.124  ERR  [MyApp]  Database connection failed  err="Connection refused"
```

### JSON Output (pipes / CI)

When stdout is piped, you get NDJSON:

```json
{"level":30,"levelName":"info","time":"2024-06-15T10:23:45.123Z","namespace":"MyApp","msg":"Server started","port":3000}
{"level":50,"levelName":"error","time":"2024-06-15T10:23:45.124Z","namespace":"MyApp","msg":"Database connection failed"}
```

### Force a Specific Format

```typescript
const logger = new Konsole({
  namespace: 'MyApp',
  format: 'pretty',  // always colorized, even in pipes
  // format: 'json'  // always NDJSON
  // format: 'silent' // no output, logs stored in memory only
});
```

## Structured Logging

All three calling styles work — Console handles them automatically:

```typescript
// 1. Simple string
logger.info('Server started');

// 2. String + fields object (recommended)
logger.info('Request received', { method: 'GET', path: '/users', ms: 42 });

// 3. Object-first with msg key
logger.info({ msg: 'Request received', method: 'GET', path: '/users' });

// 4. Error — message extracted automatically
logger.error(new Error('Connection refused'));
```

## Setting a Log Level

By default all levels pass through. Set `level` to discard everything below it:

```typescript
const logger = new Konsole({
  namespace: 'App',
  level: 'info',     // trace and debug are discarded entirely
});

logger.trace('ignored');  // discarded — below threshold
logger.debug('ignored');  // discarded — below threshold
logger.info('processed'); // ✅ passes
logger.error('processed'); // ✅ passes
```

Change the level at runtime:

```typescript
logger.setLevel('debug'); // now debug and above pass
```

## Redacting Sensitive Fields

Mask sensitive data before it reaches any output, transport, or buffer:

```typescript
const logger = new Konsole({
  namespace: 'API',
  redact: ['password', 'token', 'req.headers.authorization'],
});

logger.info('Login', { user: 'alice', password: 'hunter2' });
// → password=[REDACTED]  user=alice
```

See the [Redaction Guide](/guide/redaction) for nested paths, child inheritance, and more.

## Child Loggers

Child loggers inherit the parent's config and automatically attach context fields to every log entry — no need to manually pass request IDs:

```typescript
// Root logger for your service
const logger = new Konsole({ namespace: 'API' });

// Per-request child — bindings attached to every line
const req = logger.child({ requestId: 'req_abc', userId: 42 });

req.info('Request started', { path: '/users' });
// → INF  [API]  Request started  requestId=req_abc userId=42 path=/users

req.error('Query failed', { ms: 120 });
// → ERR  [API]  Query failed  requestId=req_abc userId=42 ms=120

// Nest deeper for subsystem context
const db = req.child({ component: 'postgres' });
db.debug('Query executed', { sql: 'SELECT...', rows: 10 });
// → DBG  [API]  Query executed  requestId=req_abc userId=42 component=postgres sql="SELECT..." rows=10
```

Call-site fields always override bindings on key collision.

## Sending Logs to a File (Node.js)

```typescript
import { Konsole, FileTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  format: 'pretty',      // pretty in terminal
  transports: [
    new FileTransport({ path: '/var/log/app.log' }), // JSON to disk
  ],
});
```

## Sending Logs to an HTTP Endpoint

```typescript
const logger = new Konsole({
  namespace: 'App',
  transports: [{
    name: 'backend',
    url: 'https://logs.example.com/ingest',
    batchSize: 50,
    headers: { 'Authorization': 'Bearer your-token' },
  }],
});
```

## Browser Debugging

Expose Console to the browser console for production debugging:

```typescript
// In your app initialization
Konsole.exposeToWindow();
```

Then in the browser console:

```javascript
__Konsole.getLogger('App').viewLogs()
__Konsole.listLoggers()
__Konsole.enableAll()
```

## Next Steps

- Learn about [Namespaces & Child Loggers](/guide/namespaces) for organizing logs and attaching request context
- Explore [Log Levels & Output](/guide/conditional-logging) for controlling what gets logged and how
- Configure [Redaction](/guide/redaction) to mask passwords, tokens, and PII
- Set up [Transports](/guide/transports) for file, stream, and HTTP log destinations
- Set up [Browser Debugging](/guide/browser-debugging) for production use
- Optimize with [Performance Tips](/guide/performance)
