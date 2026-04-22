# API Reference

Detailed documentation for all Console exports.

## Exports

```typescript
import {
  // Main class
  Konsole,

  // Transport classes
  HttpTransport,
  ConsoleTransport,
  FileTransport,
  StreamTransport,

  // Formatter utilities
  resolveTimestampConfig,
  formatTimestamp,

  // Redaction utilities
  compileRedactPaths,
  applyRedaction,
  REDACTED,

  // Async context propagation
  enableContext,
  runWithContext,
  getContext,

  // Types
  LogEntry,
  Transport,          // interface
  TransportConfig,
  KonsoleOptions,
  KonsoleChildOptions,
  KonsolePublic,
  TimestampFormat,
  TimestampOptions,
  ContextStore,
  Criteria,
  FileFormat,
} from 'konsole-logger';

// Default export
import Konsole from 'konsole-logger';
```

## Quick Reference

### Static Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `Konsole.getLogger(namespace?)` | `Konsole` | Get or create a logger by namespace |
| `Konsole.getNamespaces()` | `string[]` | List all registered namespaces |
| `Konsole.exposeToWindow()` | `void` | Expose debug handle to `window.__Konsole` |
| `Konsole.enableGlobalPrint(enabled)` | `void` | Override output for all loggers |
| `Konsole.addGlobalTransport(config)` | `void` | Add transport to every logger |
| `Konsole.shutdown()` | `Promise<void>` | Flush and destroy all registered loggers |
| `Konsole.enableShutdownHook()` | `void` | Register SIGTERM/SIGINT/beforeExit handlers |
| `Konsole.enableContext()` | `Promise<void>` | Initialize `AsyncLocalStorage` for async context propagation (Node.js) |
| `Konsole.runWithContext(store, fn)` | `T` | Run `fn` with `store` merged into log entries in the async scope |
| `Konsole.getContext()` | `ContextStore \| undefined` | Read the current async context store |

### Instance Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `trace(...args)` | `void` | Level 10 — verbose tracing |
| `debug(...args)` | `void` | Level 20 — developer detail |
| `info(...args)` | `void` | Level 30 — general messages |
| `log(...args)` | `void` | Alias for `info()` |
| `warn(...args)` | `void` | Level 40 — unexpected but recoverable |
| `error(...args)` | `void` | Level 50 — operation failed (stderr) |
| `fatal(...args)` | `void` | Level 60 — unrecoverable failure (stderr) |
| `child(bindings, options?)` | `Konsole` | Create a child logger with bound fields |
| `setLevel(level)` | `void` | Change minimum log level at runtime |
| `setTimestamp(format)` | `void` | Change timestamp format at runtime |
| `setCriteria(criteria)` | `void` | Change output filter at runtime *(deprecated)* |
| `addTransport(transport)` | `void` | Add a transport to this logger |
| `flushTransports()` | `Promise<void>` | Force-flush all transport batches |
| `getLogs()` | `ReadonlyArray<LogEntry>` | Get all stored entries |
| `getLogsAsync()` | `Promise<ReadonlyArray<LogEntry>>` | Get entries (worker-aware) |
| `clearLogs()` | `void` | Empty the circular buffer |
| `viewLogs(batchSize?)` | `void` | Print entries via `console.table` |
| `resetBatch()` | `void` | Reset `viewLogs()` pagination cursor |
| `getStats()` | `object` | Memory usage stats |
| `destroy()` | `Promise<void>` | Flush, stop timers, deregister |

## Pages

- [Konsole Class](/api/konsole) — Full class documentation
- [Types](/api/types) — Type definitions
