export interface Snippet {
  title: string;
  description: string;
  code: string;
}

export const FEATURE_SNIPPETS: Snippet[] = [
  {
    title: 'Six log levels',
    description: 'Six numeric log levels — discard everything below your threshold.',
    code: `const logger = new Konsole({
  namespace: 'App',
  level: 'info',    // trace + debug discarded
});

logger.trace('→ entering loop');   // 10 — dropped
logger.debug('Cache miss');         // 20 — dropped
logger.info('Server started', { port: 3000 }); // 30 ✅
logger.warn('Memory at 80%');       // 40 ✅
logger.error(new Error('timeout')); // 50 ✅
logger.fatal('Out of memory');      // 60 ✅`,
  },
  {
    title: 'Child loggers',
    description: 'Attach request context once — every log line carries it automatically.',
    code: `const logger = new Konsole({ namespace: 'API' });

// Per-request child — bindings on every line
const req = logger.child({
  requestId: 'req_abc',
  userId: 42,
});

req.info('Request started', { path: '/users' });
// → INF [API] Request started requestId=req_abc userId=42 path=/users

// Nest for subsystem context
const db = req.child({ component: 'postgres' });
db.debug('Query', { sql: 'SELECT...', ms: 4 });
// → DBG [API] Query requestId=req_abc userId=42 component=postgres`,
  },
  {
    title: 'Output formats',
    description: 'auto picks the best format for the environment — or force one explicitly.',
    code: `// Terminal (TTY) → ANSI-colored pretty output
// CI / pipes    → newline-delimited JSON
// Browser       → styled badges via %c
new Konsole({ namespace: 'App', format: 'auto' });

// Force formats
new Konsole({ format: 'pretty'  }); // always ANSI colored
new Konsole({ format: 'json'    }); // always NDJSON
new Konsole({ format: 'silent'  }); // no output — logs stored in memory
new Konsole({ format: 'browser' }); // DevTools badge styling`,
  },
  {
    title: 'Timestamps',
    description:
      'Full date+time by default. ISO 8601, epoch, nanosecond precision, or custom functions. Change at runtime.',
    code: `// ISO timestamps
new Konsole({ namespace: 'App', timestamp: 'iso' });
// → 2025-03-16T10:23:45.123Z  INF  [App]  ...

// High-resolution nanosecond timestamps
new Konsole({
  namespace: 'App',
  timestamp: { format: 'iso', highResolution: true },
});

// Custom function
new Konsole({
  namespace: 'App',
  timestamp: (date) => date.toLocaleString('ja-JP'),
});

// Change at runtime
logger.setTimestamp('unixMs');

// Change from browser DevTools
// __Konsole.setTimestamp('iso')
// __Konsole.getLogger('App').setTimestamp('time')`,
  },
  {
    title: 'Transports',
    description:
      'Ship logs to files (with rotation + gzip), streams, or HTTP endpoints with batching and retry.',
    code: `import { Konsole, FileTransport } from 'konsole-logger';

const logger = new Konsole({
  namespace: 'App',
  format: 'pretty',         // pretty in terminal
  transports: [
    new FileTransport({     // JSON to disk with rotation
      path: '/var/log/app.log',
      rotation: {
        maxSize: 10 * 1024 * 1024, // 10 MB per file
        interval: 'daily',         // also rotate at midnight
        maxFiles: 7,               // keep 7 old files
        compress: true,            // gzip rotated files
      },
    }),
    {                       // HTTP — batched POST
      name: 'datadog',
      url: 'https://http-intake.logs.datadoghq.com/v1/input',
      headers: { 'DD-API-KEY': process.env.DD_API_KEY },
      filter: (e) => e.levelValue >= 40, // warn+ only
    },
  ],
});`,
  },
  {
    title: 'Worker Transport',
    description:
      'Offload log storage and HTTP transport to a background worker (Web Worker in browsers, worker_threads in Node.js) — keep the main thread free.',
    code: `const logger = new Konsole({
  namespace: 'App',
  useWorker: true,         // logs processed off main thread
  transports: [{
    name: 'backend',
    url: '/api/logs',
    batchSize: 50,          // batched in the worker
    flushInterval: 10000,   // flushed from the worker
  }],
});

// Main thread stays responsive — logging never blocks UI
logger.info('User clicked', { button: 'checkout' });
logger.info('Animation frame', { fps: 60, dt: 16.2 });

// Retrieve logs from worker asynchronously
const logs = await logger.getLogsAsync();

// Expose to DevTools for production debugging
Konsole.exposeToWindow();
// → __Konsole.getLogger('App').viewLogs()`,
  },
];

export const USAGE_SNIPPETS: Snippet[] = [
  {
    title: 'Browser (React)',
    description: 'Import as a module in any React app — works with Next.js, Vite, and CRA.',
    code: `import { Konsole } from 'konsole-logger';

// Create loggers at module level
const logger = new Konsole({ namespace: 'App', format: 'silent' });
const api    = new Konsole({ namespace: 'API', level: 'warn' });

function Dashboard() {
  const handleClick = () => {
    const req = logger.child({ requestId: crypto.randomUUID() });
    req.info('Dashboard loaded', { userId: 42 });
  };

  return <button onClick={handleClick}>Load</button>;
}

// Expose for DevTools debugging
Konsole.exposeToWindow();`,
  },
  {
    title: 'Browser (Vanilla)',
    description: 'Drop into any HTML page — no bundler, no build step.',
    code: `<script type="module">
  import { Konsole } from 'https://esm.sh/konsole-logger';

  const logger = new Konsole({ namespace: 'App' });

  logger.info('Page loaded', { href: location.href });
  logger.warn('Config missing, using defaults');
  logger.error(new Error('Network request failed'));

  // Inspect stored logs at any time
  logger.getLogs(); // → LogEntry[]

  // Expose for DevTools debugging
  Konsole.exposeToWindow();
  // → window.__Konsole.getLogger('App').viewLogs()
</script>`,
  },
  {
    title: 'Node.js',
    description: 'Works in Node.js ≥ 18 with no extra config — auto-selects pretty or NDJSON.',
    code: `import { Konsole, FileTransport } from 'konsole-logger';

const logger = new Konsole({ namespace: 'Server' });
// TTY  → colorized pretty output
// pipe → newline-delimited JSON

logger.info('Server started', { port: 3000 });

// Per-request child logger
app.use((req, res, next) => {
  req.log = logger.child({
    requestId: crypto.randomUUID(),
    method: req.method,
    path: req.path,
  });
  next();
});

// Flush to disk on shutdown
const file = new FileTransport({
  path: './logs/app.log',
  rotation: { maxSize: 10 * 1024 * 1024, maxFiles: 5 },
});
logger.addTransport(file);

process.on('SIGTERM', async () => {
  await logger.flushTransports();
  process.exit(0);
});`,
  },
];
