/**
 * Platform-agnostic worker adapter.
 *
 * - **Browser** → Web Worker via Blob + Object URL
 * - **Node.js** → `worker_threads` via dynamic `import('node:worker_threads')`
 *
 * Both return a unified {@link KonsoleWorker} interface so `Konsole.ts`
 * doesn't need platform-specific branching.
 */

import { isBrowser, isNode } from './env';

// ─── Public interface ────────────────────────────────────────────────────────

/** Minimal worker surface used by Konsole. */
export interface KonsoleWorker {
  postMessage(data: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  terminate(): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a worker for the current platform.
 * Returns `null` when no worker API is available.
 *
 * @param code  Raw JavaScript source for the worker body.
 *              Must use `self.onmessage` / `self.postMessage` conventions.
 */
export function createPlatformWorker(code: string): KonsoleWorker | null {
  if (isBrowser && typeof Worker !== 'undefined') {
    return createBrowserWorker(code);
  }
  if (isNode) {
    return createNodeWorker(code);
  }
  return null;
}

// ─── Browser implementation ──────────────────────────────────────────────────

function createBrowserWorker(code: string): KonsoleWorker {
  const blob = new Blob([code], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  const adapter: KonsoleWorker = {
    postMessage: (data) => worker.postMessage(data),
    onmessage: null,
    terminate() {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };

  worker.onmessage = (event: MessageEvent) => {
    adapter.onmessage?.(event);
  };

  return adapter;
}

// ─── Node.js implementation ──────────────────────────────────────────────────

/**
 * Node.js shim prepended to the worker code string.
 * Maps `worker_threads.parentPort` onto the `self.onmessage` / `self.postMessage`
 * convention that the shared worker source already uses.
 */
const NODE_WORKER_PREAMBLE = `
const { parentPort } = require('node:worker_threads');
const self = { onmessage: null, postMessage: (d) => parentPort.postMessage(d) };
parentPort.on('message', (data) => { if (self.onmessage) self.onmessage({ data }); });
`;

function createNodeWorker(code: string): KonsoleWorker | null {
  // Messages are buffered until the async import resolves.
  const pending: unknown[] = [];
  let nodeWorker: import('node:worker_threads').Worker | null = null;
  let handler: ((event: { data: unknown }) => void) | null = null;
  let failed = false;

  import('node:worker_threads')
    .then(({ Worker: NodeWorker }) => {
      const fullCode = NODE_WORKER_PREAMBLE + code;
      nodeWorker = new NodeWorker(fullCode, { eval: true });

      nodeWorker.on('message', (data: unknown) => {
        if (handler) handler({ data });
      });

      // Flush any messages that arrived before the worker was ready
      for (const msg of pending) nodeWorker.postMessage(msg);
      pending.length = 0;
    })
    .catch(() => {
      failed = true;
    });

  return {
    postMessage(data: unknown) {
      if (failed) return;
      if (nodeWorker) nodeWorker.postMessage(data);
      else pending.push(data);
    },
    get onmessage() {
      return handler;
    },
    set onmessage(fn: ((event: { data: unknown }) => void) | null) {
      handler = fn;
    },
    terminate() {
      nodeWorker?.terminate();
      nodeWorker = null;
      pending.length = 0;
    },
  };
}
