# Namespaces & Child Loggers

Namespaces organize your logs by component. Child loggers automatically attach context — request IDs, user IDs, trace IDs — to every line without passing them manually.

## Namespaced Loggers

Each `Konsole` instance is identified by a namespace shown in every output line:

```typescript
import { Konsole } from 'konsole-logger';

const authLogger = new Konsole({ namespace: 'Auth' });
const apiLogger  = new Konsole({ namespace: 'API' });
const dbLogger   = new Konsole({ namespace: 'DB' });

authLogger.info('User logged in', { userId: 42 });
// → INF  [Auth]  User logged in  userId=42

apiLogger.warn('Rate limit approaching', { remaining: 10 });
// → WRN  [API]   Rate limit approaching  remaining=10
```

## Retrieving Loggers

Once created, a logger is accessible from anywhere by namespace:

```typescript
// In another file
const auth = Konsole.getLogger('Auth');
auth.info('Password changed');

// If the namespace doesn't exist yet, a new logger is created with a warning
const unknown = Konsole.getLogger('DoesNotExist');
```

List all registered namespaces:

```typescript
const namespaces = Konsole.getNamespaces();
// ['Auth', 'API', 'DB']
```

## Child Loggers

`logger.child(bindings, options?)` creates a derived logger that:
- Inherits the parent's level, format, transports, and buffer
- Automatically merges `bindings` into every log entry it produces
- Is **not** registered in `Konsole.instances` — it is ephemeral

```typescript
const logger = new Konsole({ namespace: 'API' });

// Attach request context
const req = logger.child({ requestId: 'req_abc', ip: '1.2.3.4' });

req.info('Request started', { path: '/users' });
// → INF  [API]  Request started  requestId=req_abc ip=1.2.3.4 path=/users

req.error('Auth failed');
// → ERR  [API]  Auth failed  requestId=req_abc ip=1.2.3.4
```

### Nested children

Bindings accumulate through the chain. Call-site fields override bindings on key collision (most specific wins):

```typescript
const root = new Konsole({ namespace: 'App' });

const req = root.child({ requestId: 'r1' });
const db  = req.child({ component: 'postgres' }, { namespace: 'App:DB' });

db.debug('Query', { sql: 'SELECT...', ms: 4 });
// → DBG  [App:DB]  Query  requestId=r1 component=postgres sql="SELECT..." ms=4
```

### Overriding namespace, level, or timestamp

```typescript
// Override namespace for a subsystem
const db = logger.child({ component: 'db' }, { namespace: 'API:DB' });

// Override level — can only be more restrictive than parent
const noisy = logger.child({}, { level: 'error' });

// Override timestamp format for a child
const audit = logger.child({ type: 'audit' }, { timestamp: 'iso' });
```

### Child isolation

A child logger has a **separate `transports` array**. Adding a transport to a child does not affect the parent:

```typescript
const child = logger.child({ tag: 'audit' });
child.addTransport(new FileTransport({ path: '/var/log/audit.log' }));
// Parent's transport list is unchanged
```

Both parent and child share the same **circular buffer** — `parent.getLogs()` includes entries from all children.

## Best Practices

### Use descriptive names

```typescript
// ✅ Good
new Konsole({ namespace: 'PaymentGateway' });
new Konsole({ namespace: 'UserAuthentication' });

// ❌ Too vague
new Konsole({ namespace: 'pg' });
new Konsole({ namespace: 'misc' });
```

### Namespace hierarchy

```typescript
// Feature-based
new Konsole({ namespace: 'Auth.Login' });
new Konsole({ namespace: 'Auth.Register' });

// Layer-based
new Konsole({ namespace: 'API.Users' });
new Konsole({ namespace: 'API.Products' });
```

### Create loggers at module level, children per-request

```typescript
// auth.ts — module-level logger created once
const logger = new Konsole({ namespace: 'Auth' });

export async function login(req: Request) {
  // Per-request child — automatically attaches requestId to every line
  const log = logger.child({ requestId: req.id, ip: req.ip });

  log.info('Login attempt', { user: req.body.email });

  try {
    const user = await db.findUser(req.body.email);
    log.info('Login success', { userId: user.id });
    return user;
  } catch (err) {
    log.error('Login failed', { err });
    throw err;
  }
}
```

::: tip When to use child loggers vs. async context
Child loggers are great for **explicit, component-scoped** context that travels with a logger reference (like `component: 'db'`). For **request-scoped** fields that should follow execution across `await` boundaries without threading a logger through every call, use [async context propagation](./async-context) instead.
:::
