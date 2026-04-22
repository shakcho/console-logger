# Async Context Propagation

Bind request-scoped fields — `requestId`, `traceId`, `userId` — to an async scope once, and every log inside auto-includes them. No need to thread a child logger through every function call.

Powered by Node.js's built-in [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage). Node-only; in the browser, `runWithContext` calls your function directly and context is a no-op.

## Why this exists

Without it, propagating request metadata looks like this:

```typescript
app.use((req, _res, next) => {
  req.log = logger.child({ requestId: req.id, userId: req.user?.id });
  next();
});

async function chargeCustomer(req, amount) {
  req.log.info('charging', { amount });                  // plumb `req.log`
  await db.charge(req.log, amount);                      // ...and keep plumbing
}
```

Every service, repo, and helper has to accept the child logger as a parameter. With `runWithContext`, the plumbing disappears:

```typescript
app.use((req, _res, next) => {
  Konsole.runWithContext({ requestId: req.id, userId: req.user?.id }, () => next());
});

async function chargeCustomer(amount: number) {
  logger.info('charging', { amount });
  // → { msg: 'charging', amount, requestId: 'r_abc', userId: 42 }
}
```

## Setup

Call `Konsole.enableContext()` once during app startup. It lazily loads `node:async_hooks` and returns a Promise — await it before using `runWithContext`:

```typescript
import { Konsole } from 'konsole-logger';

await Konsole.enableContext();

// Now runWithContext is usable anywhere in the process.
```

`enableContext()` is idempotent — calling it multiple times returns the same promise. Safe to call from multiple modules.

## Binding context

`Konsole.runWithContext(store, fn)` runs `fn` inside a scope where `store` is merged into every log entry. Returns `fn`'s result.

### Express / Fastify / Hono middleware

```typescript
app.use((req, _res, next) => {
  Konsole.runWithContext(
    { requestId: req.id, userId: req.user?.id, method: req.method, path: req.path },
    () => next(),
  );
});
```

### Around any async unit of work

```typescript
async function processJob(job: Job) {
  await Konsole.runWithContext({ jobId: job.id, queue: job.queue }, async () => {
    logger.info('processing');
    await doWork(job);
    logger.info('done');
  });
}
```

### Inside a scope, logs pick it up automatically

```typescript
Konsole.runWithContext({ requestId: 'r1' }, async () => {
  logger.info('start');                // includes requestId
  await someAsyncWork();
  logger.info('end');                  // still includes requestId (ALS survives await)
});
```

## Precedence

Context merges with existing bindings and call-site fields in a strict order. **Most specific wins:**

```
ALS context  <  child bindings  <  call-site fields
```

```typescript
const child = logger.child({ component: 'db' });

Konsole.runWithContext({ requestId: 'r1', component: 'ctx' }, () => {
  child.info('query', { component: 'call', sql: 'SELECT 1' });
  // → fields: { requestId: 'r1', component: 'call', sql: 'SELECT 1' }
  //           ^ from ALS          ^ call-site wins over bindings & context
});
```

## Nested scopes merge

Inner scopes inherit outer keys. `runWithContext` wraps `AsyncLocalStorage.run` to spread the parent store, so middleware stacking produces the union of all active contexts:

```typescript
Konsole.runWithContext({ requestId: 'r1' }, () => {
  Konsole.runWithContext({ userId: 'u1' }, () => {
    logger.info('both apply');
    // → fields: { requestId: 'r1', userId: 'u1' }
  });
});
```

Inner keys shadow outer keys on collision:

```typescript
Konsole.runWithContext({ tier: 'outer' }, () => {
  Konsole.runWithContext({ tier: 'inner' }, () => {
    logger.info('inner wins'); // tier: 'inner'
  });
  logger.info('back to outer'); // tier: 'outer'
});
```

## Reading the current context

`Konsole.getContext()` returns the active store, or `undefined` outside any scope. Useful for debugging and bridging into systems that aren't logging-aware:

```typescript
Konsole.runWithContext({ requestId: 'r1' }, () => {
  const ctx = Konsole.getContext(); // { requestId: 'r1' }
  metrics.tag(ctx);
});

Konsole.getContext(); // undefined
```

## Exceptions clear the scope cleanly

Thrown errors propagate through `runWithContext` and the scope is cleared on the way out. Your `catch` block runs with whatever parent context was active, not the inner scope:

```typescript
try {
  Konsole.runWithContext({ requestId: 'r1' }, () => {
    throw new Error('boom');
  });
} catch (err) {
  Konsole.getContext(); // undefined
  logger.error('handler failed', { err });
}
```

## Interaction with other features

### Redaction

Context fields go through the same redaction pipeline as any other field — a `password` injected via `runWithContext` will be masked:

```typescript
const logger = new Konsole({ namespace: 'App', redact: ['password'] });

Konsole.runWithContext({ password: 'hunter2', requestId: 'r1' }, () => {
  logger.info('event');
  // password: '[REDACTED]', requestId: 'r1'
});
```

### Serializers

Serializers apply to context-sourced fields too, letting you reshape objects placed in the store:

```typescript
const logger = new Konsole({
  namespace: 'App',
  serializers: { user: (u) => ({ id: u.id }) }, // strip everything but id
});

Konsole.runWithContext({ user: { id: 7, email: 'a@b.co' } }, () => {
  logger.info('event');
  // user: { id: 7 }
});
```

### Child loggers

Children inherit the same global ALS scope automatically — no wiring:

```typescript
const child = logger.child({ component: 'db' });

Konsole.runWithContext({ requestId: 'r1' }, () => {
  child.info('query');
  // fields: { requestId: 'r1', component: 'db' }
});
```

### Level filtering

Below-threshold calls are still dropped before any field merge — ALS context does not leak into discarded entries:

```typescript
const logger = new Konsole({ namespace: 'App', level: 'warn' });

Konsole.runWithContext({ requestId: 'r1' }, () => {
  logger.debug('skipped');   // dropped
  logger.warn('kept');       // includes requestId
});
```

## Performance

`AsyncLocalStorage` is **lazy-loaded** — apps that never call `enableContext()` pay a single null check per log call. The fast path is unaffected.

Once enabled, each log does one native `getStore()` call (returns `undefined` outside any scope) and one object spread when a store is active. On typical Node 20+ hardware this adds &lt;100 ns per call.

## Browser behavior

`runWithContext(store, fn)` invokes `fn()` directly in the browser — your function still runs, but fields are not merged. This lets you write shared code that works in both environments without environment checks:

```typescript
// Works in both Node and browser; only Node merges context
Konsole.runWithContext({ requestId }, () => logger.info('ready'));
```

`enableContext()` resolves immediately in the browser and is a no-op. `getContext()` returns `undefined`.

## API

| Method | Description |
|--------|-------------|
| `await Konsole.enableContext()` | One-time init. Loads `node:async_hooks`. Idempotent. |
| `Konsole.runWithContext(store, fn)` | Run `fn` with `store` merged into log entries inside the async scope. Returns `fn`'s result. |
| `Konsole.getContext()` | Read the current store, or `undefined` if no scope is active. |

All three are also exported as named functions:

```typescript
import { enableContext, runWithContext, getContext } from 'konsole-logger';
```

## Common pitfalls

### Forgetting to await `enableContext()`

`runWithContext` throws a clear error in Node if called before the ALS module has loaded:

```
[Konsole] Context not initialized. Call `await Konsole.enableContext()`
during app startup before using `runWithContext`.
```

Fix: `await Konsole.enableContext()` at the top of your entry file.

### Leaking context across tests

If your test runner shares a process, context from one test can bleed into another if assertions run inside a `runWithContext` callback that never exits (e.g. a dangling Promise). Always `await` the callback or use `try/finally`.

### Storing huge objects

Context is spread into every log entry in the scope — keep it small. `requestId`, `userId`, `traceId` are ideal. Don't stuff whole request bodies or ORM models into the store.

## See also

- [Namespaces & Child Loggers](./namespaces) — when to use child loggers vs. async context
- [Redaction](./redaction) — masking sensitive fields (including those sourced from context)
