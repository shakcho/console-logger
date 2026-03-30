import { describe, it, expect, afterEach } from 'vitest';
import { createPlatformWorker, type KonsoleWorker } from '../workerAdapter';

/**
 * Simple worker code that echoes back any message it receives,
 * wrapped in a { type: 'ECHO', payload } envelope.
 */
const ECHO_WORKER_CODE = `
  self.onmessage = ({ data }) => {
    self.postMessage({ type: 'ECHO', payload: data });
  };
`;

describe('createPlatformWorker (Node.js)', () => {
  let worker: KonsoleWorker | null = null;

  afterEach(() => {
    worker?.terminate();
    worker = null;
  });

  it('returns a KonsoleWorker in Node.js', () => {
    worker = createPlatformWorker(ECHO_WORKER_CODE);
    expect(worker).not.toBeNull();
    expect(worker!.postMessage).toBeInstanceOf(Function);
    expect(worker!.terminate).toBeInstanceOf(Function);
  });

  it('echoes messages back via onmessage', async () => {
    worker = createPlatformWorker(ECHO_WORKER_CODE);
    expect(worker).not.toBeNull();

    const response = await new Promise<unknown>((resolve) => {
      worker!.onmessage = (event) => resolve(event.data);
      // Small delay to let the async worker_threads import resolve
      setTimeout(() => worker!.postMessage({ hello: 'world' }), 50);
    });

    expect(response).toEqual({ type: 'ECHO', payload: { hello: 'world' } });
  });

  it('buffers messages sent before the worker is ready', async () => {
    worker = createPlatformWorker(ECHO_WORKER_CODE);
    expect(worker).not.toBeNull();

    const response = await new Promise<unknown>((resolve) => {
      worker!.onmessage = (event) => resolve(event.data);
      // Send immediately — the adapter should buffer this
      worker!.postMessage({ buffered: true });
    });

    expect(response).toEqual({ type: 'ECHO', payload: { buffered: true } });
  });

  it('handles terminate gracefully', () => {
    worker = createPlatformWorker(ECHO_WORKER_CODE);
    expect(worker).not.toBeNull();
    // Should not throw
    worker!.terminate();
    // Should be safe to call postMessage after terminate (no-op / no throw)
    worker!.postMessage({ after: 'terminate' });
    worker = null; // already terminated
  });

  it('supports the full worker code used by Konsole', async () => {
    // Minimal version of the actual Konsole worker code
    const konsoleWorkerCode = `
      const buffers = new Map();

      self.onmessage = ({ data: { type, payload, namespace: ns, requestId } }) => {
        switch (type) {
          case 'CONFIGURE':
            buffers.set(ns, { cfg: payload, logs: [] });
            break;
          case 'ADD_LOG':
            if (ns && payload) {
              const b = buffers.get(ns);
              if (b) b.logs.push(payload);
            }
            break;
          case 'GET_LOGS':
            if (ns) {
              const b = buffers.get(ns);
              self.postMessage({
                type: 'LOGS_RESPONSE',
                payload: b ? b.logs : [],
                requestId,
              });
            }
            break;
        }
      };
    `;

    worker = createPlatformWorker(konsoleWorkerCode);
    expect(worker).not.toBeNull();

    // Wait for worker to be ready, then configure + add + get
    await new Promise((resolve) => setTimeout(resolve, 50));

    worker!.postMessage({
      type: 'CONFIGURE',
      namespace: 'test',
      payload: { maxLogs: 100 },
    });

    worker!.postMessage({
      type: 'ADD_LOG',
      namespace: 'test',
      payload: { msg: 'hello', level: 'info' },
    });

    const logs = await new Promise<unknown>((resolve) => {
      worker!.onmessage = (event) => {
        const data = event.data as { type: string; payload: unknown };
        if (data.type === 'LOGS_RESPONSE') resolve(data.payload);
      };
      worker!.postMessage({
        type: 'GET_LOGS',
        namespace: 'test',
        requestId: 'req-1',
      });
    });

    expect(logs).toEqual([{ msg: 'hello', level: 'info' }]);
  });
});
