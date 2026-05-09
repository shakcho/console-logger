---
title: Viewing Logs
description: Inspect in-memory logs from the browser console with getLogs() and viewLogs(). Filter by level, namespace, or any field — perfect for debugging in production.
---

# Viewing Logs

Console stores all logs in memory, allowing you to inspect them later.

## Using viewLogs()

The `viewLogs()` method displays logs in batches using `console.table`:

```typescript
const logger = new Konsole({ namespace: 'App' });

// Log some messages
logger.log('Message 1');
logger.log('Message 2');
logger.log('Message 3');
// ... many more logs

// View first 100 logs (default batch size)
logger.viewLogs();

// Call again to see the next batch
logger.viewLogs();

// Custom batch size
logger.viewLogs(50);
```

### Resetting the Batch

When you reach the end of logs, calling `viewLogs()` will reset automatically:

```typescript
logger.viewLogs(); // Shows logs 1-100
logger.viewLogs(); // Shows logs 101-200
logger.viewLogs(); // "End of logs. Call viewLogs() again to restart."
logger.viewLogs(); // Shows logs 1-100 again

// Manually reset
logger.resetBatch();
```

## Programmatic Access

Get all logs as an array:

```typescript
const logs = logger.getLogs();

// Filter logs
const errors = logs.filter(log => log.logtype === 'error');
const recent = logs.filter(log => 
  log.timestamp > new Date(Date.now() - 3600000)
);

// Export to JSON
const json = JSON.stringify(logs, null, 2);
```

## Clearing Logs

Remove all stored logs:

```typescript
logger.clearLogs();
```

## Log Retention

By default, logs older than 48 hours are automatically removed. Customize this:

```typescript
const logger = new Konsole({
  namespace: 'App',
  retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
  cleanupInterval: 30 * 60 * 1000,      // Check every 30 minutes
});
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `defaultBatchSize` | 100 | Number of logs per viewLogs() call |
| `retentionPeriod` | 48 hours | How long to keep logs |
| `cleanupInterval` | 1 hour | How often to clean old logs |





