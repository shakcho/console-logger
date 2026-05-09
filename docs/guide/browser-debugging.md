---
title: Browser Debugging
description: Debug live JavaScript apps from the browser console. Console Logger exposes window.__Konsole — change log levels, view buffered logs, and toggle output without redeploying.
---

# Browser Debugging

Console can expose itself to the browser window, allowing you to debug production applications from the developer console.

## Setup

Call `exposeToWindow()` early in your application:

```typescript
import { Konsole } from 'konsole-logger';

// Expose to window for debugging
Konsole.exposeToWindow();

// Create your loggers as usual
const appLogger = new Konsole({ namespace: 'App' });
const apiLogger = new Konsole({ namespace: 'API' });
```

## Browser Console Commands

Once exposed, you can use these commands in the browser console:

### View Logs

```javascript
// Get a logger and view its logs
__Konsole.getLogger('App').viewLogs()

// Specify batch size
__Konsole.getLogger('API').viewLogs(50)
```

### List All Loggers

```javascript
__Konsole.listLoggers()
// Returns: ['App', 'API', ...]
```

### Enable/Disable All Logging

```javascript
// Enable console output for all loggers
__Konsole.enableAll()

// Disable console output
__Konsole.disableAll()
```

### Disable Redaction (Debug Only)

```javascript
// Temporarily show real values instead of [REDACTED]
__Konsole.disableRedaction(true)

// Re-enable redaction
__Konsole.disableRedaction(false)
```

::: warning
This toggle is only available in the browser. In Node.js, redaction is always enforced and cannot be disabled.
:::

### Change Timestamp Format

```javascript
// Change timestamp format for all loggers
__Konsole.setTimestamp('iso')
__Konsole.setTimestamp('unixMs')

// Change for a specific logger
__Konsole.getLogger('Auth').setTimestamp('time')

// Custom format function
__Konsole.setTimestamp((d) => d.toLocaleString())
```

## Production Debugging Workflow

1. **User reports an issue**

2. **Open browser console on their machine**

3. **Check what loggers are available:**
   ```javascript
   __Konsole.listLoggers()
   ```

4. **View logs from relevant namespace:**
   ```javascript
   __Konsole.getLogger('PaymentGateway').viewLogs()
   ```

5. **Enable live logging if needed:**
   ```javascript
   __Konsole.enableAll()
   // Have user reproduce the issue
   // Watch logs in real-time
   ```

## Security Considerations

::: warning
Exposing Console to the window gives anyone with console access the ability to view logs. Consider:

- Only expose in development/staging environments
- Use the [`redact` option](/guide/redaction) to mask sensitive fields (passwords, tokens, PII)
- Use environment checks before exposing
:::

```typescript
// Only expose in non-production
if (process.env.NODE_ENV !== 'production') {
  Konsole.exposeToWindow();
}

// Or use a feature flag
if (window.ENABLE_DEBUG_TOOLS) {
  Konsole.exposeToWindow();
}
```

## Example: Debug Button

Add a hidden debug mode for support staff:

```typescript
let clickCount = 0;
let lastClick = 0;

document.getElementById('logo')?.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastClick > 1000) clickCount = 0;
  lastClick = now;
  clickCount++;
  
  if (clickCount >= 5) {
    Konsole.exposeToWindow();
    console.log('Debug mode enabled! Use __Konsole in console.');
    clickCount = 0;
  }
});
```





