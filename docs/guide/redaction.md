# Redaction

Redaction automatically masks sensitive field values before they reach any output, transport, or buffer. Passwords, tokens, credit card numbers, and other PII are replaced with `'[REDACTED]'` — nothing leaks.

## Basic Usage

Pass an array of field paths to the `redact` option:

```typescript
import { Konsole } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'API',
  redact: ['password', 'token', 'user.creditCard'],
});

logger.info('Login attempt', { user: 'alice', password: 'hunter2' });
// → INF  [API]  Login attempt  user=alice  password=[REDACTED]
```

The original caller object is **never mutated** — redaction produces a new entry with masked values.

## Nested Fields

Use dot-notation to redact fields at any depth:

```typescript
const logger = new Konsole({
  namespace: 'App',
  redact: ['req.headers.authorization', 'user.billing.cardNumber'],
});

logger.info('Request', {
  req: {
    method: 'POST',
    headers: { authorization: 'Bearer tok_abc', 'content-type': 'application/json' },
  },
});
// authorization → [REDACTED], content-type → untouched
```

### Path behavior

| Scenario | Behavior |
|----------|----------|
| Path exists | Value replaced with `'[REDACTED]'` |
| Path does not exist | Silently ignored — no error |
| Intermediate key is `null` or primitive | Walk stops, value left as-is |
| Intermediate key is an array | Walk stops, value left as-is |
| Intermediate key is an `Error` | Walk stops, Error left as-is |
| Terminal points to an object | The entire object is replaced with `'[REDACTED]'` |

## Child Logger Inheritance

Children always inherit their parent's redact paths. A child can add more paths but can **never** redact fewer fields than its parent — this is a security invariant:

```typescript
const parent = new Konsole({
  namespace: 'App',
  redact: ['password'],
});

// Child adds 'token' on top of parent's 'password'
const child = parent.child({ service: 'auth' }, { redact: ['token'] });

child.info('event', { password: 'secret', token: 'abc' });
// → both password and token are [REDACTED]

parent.info('event', { password: 'secret', token: 'abc' });
// → only password is [REDACTED] — parent is unaffected by child paths
```

Nested children accumulate redact paths through the chain, just like bindings.

## Redaction of Bindings

Redaction applies after bindings are merged, so it works on values that come from `child()` bindings:

```typescript
const parent = new Konsole({
  namespace: 'App',
  redact: ['apiKey'],
});

const child = parent.child({ apiKey: 'sk_live_abc', service: 'payments' });
child.info('charge processed');
// → apiKey=[REDACTED]  service=payments
```

## Where Redaction Happens

Redaction is applied in the `addLog()` pipeline **before** any consumer:

1. Entry is built (fields merged with bindings)
2. **Redaction applied here**
3. Entry stored in circular buffer
4. Entry forwarded to worker (if enabled)
5. Entry forwarded to transports
6. Entry written to formatter (console output)

This means redacted values never appear in:
- `getLogs()` / `getLogsAsync()` results
- Transport payloads (HTTP, file, stream)
- Console output (pretty, JSON, browser)
- Worker messages

::: info msg is not redacted
Only `entry.fields` is inspected. The `entry.msg` string is never modified by redaction. If you log `logger.info('password is hunter2')`, the message text is not masked. Use structured fields for sensitive data.
:::

## Disable Redaction at Runtime (Browser Only)

For debugging in DevTools, you can temporarily disable redaction to see the real values. This toggle is **only available in the browser** via `window.__Konsole` — it cannot be disabled in Node.js:

```js
// In DevTools console (after Konsole.exposeToWindow()):
__Konsole.disableRedaction(true)   // show real values
__Konsole.disableRedaction(false)  // restore redaction
```

::: warning Security
This toggle is intentionally **not available in Node.js**. In server environments, redaction is always enforced — there is no API to bypass it.
:::

## Using Redaction Utilities Directly

The redaction functions are exported for use in custom transports or external tooling:

```typescript
import { compileRedactPaths, applyRedaction, REDACTED } from 'konsole-logger';

// Pre-compile paths once (avoid re-splitting on every call)
const paths = compileRedactPaths(['password', 'req.headers.authorization']);

// Apply to any LogEntry
const redactedEntry = applyRedaction(entry, paths);

// The sentinel value
console.log(REDACTED); // '[REDACTED]'
```

## Full Example

```typescript
import { Konsole, FileTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'PaymentService',
  level: 'info',
  format: 'json',
  redact: [
    'password',
    'token',
    'user.ssn',
    'user.creditCard',
    'req.headers.authorization',
    'req.headers.cookie',
  ],
  transports: [
    new FileTransport({ path: '/var/log/payments.log' }),
    {
      name: 'datadog',
      url: 'https://http-intake.logs.datadoghq.com/v1/input',
      headers: { 'DD-API-KEY': process.env.DD_API_KEY },
    },
  ],
});

// All sensitive fields are masked in every destination:
// console output, file, HTTP transport, and in-memory buffer
logger.info('Payment processed', {
  user: { id: 42, ssn: '123-45-6789', creditCard: '4111111111111111' },
  amount: 99.99,
  token: 'tok_live_abc',
});
```
