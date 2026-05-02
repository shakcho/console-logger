import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpTransport } from '../../transports/HttpTransport';
import type { LogEntry } from '../../types';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    msg: 'test message',
    messages: ['test message'],
    fields: { key: 'val' },
    timestamp: new Date('2024-06-01T12:00:00.000Z'),
    namespace: 'Test',
    level: 'info',
    levelValue: 30,
    ...overrides,
  };
}

function makeFetch(ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
  } as Response);
}

describe('HttpTransport', () => {
  let fetchMock: ReturnType<typeof makeFetch>;

  beforeEach(() => {
    fetchMock = makeFetch();
  });

  it('requires fetch to be available', () => {
    // Temporarily remove globalThis.fetch to simulate an environment without it
    const originalFetch = globalThis.fetch;
    // @ts-expect-error — deliberately deleting for testing
    delete globalThis.fetch;
    try {
      expect(() =>
        new HttpTransport({ name: 't', url: 'http://x' }),
      ).toThrow(/fetch is not available/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses fetchImpl if provided', () => {
    const t = new HttpTransport({ name: 't', url: 'http://x', fetchImpl: fetchMock });
    expect(t.name).toBe('t');
  });

  it('batches entries and flushes when batchSize is reached', async () => {
    const t = new HttpTransport({
      name: 'batch-test',
      url: 'http://localhost/logs',
      batchSize: 2,
      flushInterval: 999999,
      fetchImpl: fetchMock,
    });

    t.write(makeEntry({ msg: 'first' }));
    expect(fetchMock).not.toHaveBeenCalled();

    t.write(makeEntry({ msg: 'second' })); // triggers auto-flush
    // Wait one microtask for the async flush
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.logs).toHaveLength(2);
    expect(body.transport).toBe('batch-test');

    await t.destroy();
  });

  it('sends Pino-compatible payload schema', async () => {
    const t = new HttpTransport({
      name: 'schema-test',
      url: 'http://localhost/logs',
      batchSize: 1,
      fetchImpl: fetchMock,
    });

    t.write(makeEntry({ msg: 'hello', fields: { userId: 42 } }));
    await Promise.resolve();

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const entry = body.logs[0];
    expect(entry.level).toBe(30);
    expect(entry.levelName).toBe('info');
    expect(entry.msg).toBe('hello');
    expect(entry.userId).toBe(42);
    expect(typeof entry.time).toBe('string');

    await t.destroy();
  });

  it('applies a filter predicate', async () => {
    const t = new HttpTransport({
      name: 'filter-test',
      url: 'http://localhost/logs',
      batchSize: 10,
      flushInterval: 999999,
      filter: (e) => e.level === 'error',
      fetchImpl: fetchMock,
    });

    t.write(makeEntry({ level: 'info' }));
    t.write(makeEntry({ level: 'error', msg: 'critical' }));

    await t.flush();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].msg).toBe('critical');

    await t.destroy();
  });

  it('uses a transform function when provided', async () => {
    const t = new HttpTransport({
      name: 'transform-test',
      url: 'http://localhost/logs',
      batchSize: 1,
      fetchImpl: fetchMock,
      transform: (e) => ({ custom: true, msg: e.msg }),
    });

    t.write(makeEntry({ msg: 'transformed' }));
    await Promise.resolve();

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.logs[0]).toEqual({ custom: true, msg: 'transformed' });

    await t.destroy();
  });

  it('flush does nothing when batch is empty', async () => {
    const t = new HttpTransport({
      name: 'empty-flush',
      url: 'http://localhost/logs',
      fetchImpl: fetchMock,
    });
    await t.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    await t.destroy();
  });

  it('logs a warning on HTTP error and schedules retry', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failFetch = makeFetch(false, 500);

    const t = new HttpTransport({
      name: 'retry-test',
      url: 'http://localhost/logs',
      batchSize: 1,
      retryAttempts: 1,
      fetchImpl: failFetch,
    });

    t.write(makeEntry());
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    await t.destroy();
  });

  it('fires onError when retries are exhausted', async () => {
    const warnSpy   = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failFetch = makeFetch(false, 500);
    const onError   = vi.fn();

    const t = new HttpTransport({
      name: 'on-error',
      url: 'http://localhost/logs',
      batchSize: 1,
      retryAttempts: 0, // exhaust immediately
      fetchImpl: failFetch,
      onError,
    });

    const entry = makeEntry({ msg: 'will-be-dropped' });
    t.write(entry);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
    const [err, dropped] = onError.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/HTTP 500/);
    expect(dropped).toEqual([entry]);

    warnSpy.mockRestore();
    await t.destroy();
  });

  it('does not fire onError while retries are still pending', async () => {
    const warnSpy   = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failFetch = makeFetch(false, 500);
    const onError   = vi.fn();

    const t = new HttpTransport({
      name: 'retries-remaining',
      url: 'http://localhost/logs',
      batchSize: 1,
      retryAttempts: 3,
      fetchImpl: failFetch,
      onError,
    });

    t.write(makeEntry());
    await Promise.resolve();
    // First attempt failed; retries are scheduled via setTimeout — onError must
    // remain silent until they too are exhausted.
    expect(onError).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    await t.destroy();
  });

  it('drops oldest queued batch when maxQueueSize is exceeded (default strategy)', async () => {
    // Make fetch hang so isProcessing stays true and pushes pile up in retryQueue.
    let resolveFirst!: () => void;
    const hangingFetch = vi.fn().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = () => resolve({ ok: true, status: 200 } as Response);
        }),
    ).mockResolvedValue({ ok: true, status: 200 } as Response);

    const onError = vi.fn();
    const t = new HttpTransport({
      name: 'queue-overflow',
      url: 'http://localhost/logs',
      batchSize: 1,
      flushInterval: 999999,
      maxQueueSize: 1, // queue holds 1 batch besides the in-flight one
      retryAttempts: 0,
      fetchImpl: hangingFetch,
      onError,
    });

    t.write(makeEntry({ msg: 'in-flight' })); // becomes the in-flight batch
    await Promise.resolve();

    // Two more writes — second one evicts the first from the queue
    t.write(makeEntry({ msg: 'queued-1' }));
    await Promise.resolve();
    t.write(makeEntry({ msg: 'queued-2' }));
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
    const [err, dropped] = onError.mock.calls[0];
    expect((err as Error).message).toMatch(/queue overflow.*drop-oldest/);
    expect(dropped[0].msg).toBe('queued-1');

    resolveFirst();
    await t.destroy();
  });

  it('drops the new batch when overflowStrategy is drop-newest', async () => {
    let resolveFirst!: () => void;
    const hangingFetch = vi.fn().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = () => resolve({ ok: true, status: 200 } as Response);
        }),
    ).mockResolvedValue({ ok: true, status: 200 } as Response);

    const onError = vi.fn();
    const t = new HttpTransport({
      name: 'queue-overflow-newest',
      url: 'http://localhost/logs',
      batchSize: 1,
      flushInterval: 999999,
      maxQueueSize: 1,
      overflowStrategy: 'drop-newest',
      retryAttempts: 0,
      fetchImpl: hangingFetch,
      onError,
    });

    t.write(makeEntry({ msg: 'in-flight' }));
    await Promise.resolve();
    t.write(makeEntry({ msg: 'queued-1' }));
    await Promise.resolve();
    t.write(makeEntry({ msg: 'queued-2' })); // dropped
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
    const [err, dropped] = onError.mock.calls[0];
    expect((err as Error).message).toMatch(/queue overflow.*drop-newest/);
    expect(dropped[0].msg).toBe('queued-2');

    resolveFirst();
    await t.destroy();
  });

  it('swallows exceptions thrown from onError callback', async () => {
    const warnSpy   = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failFetch = makeFetch(false, 500);

    const t = new HttpTransport({
      name: 'onerror-throws',
      url: 'http://localhost/logs',
      batchSize: 1,
      retryAttempts: 0,
      fetchImpl: failFetch,
      onError: () => { throw new Error('user code blew up'); },
    });

    expect(() => t.write(makeEntry())).not.toThrow();
    // Allow the async send + onError invocation to settle
    await Promise.resolve();
    await Promise.resolve();

    warnSpy.mockRestore();
    await t.destroy();
  });

  it('sends custom headers', async () => {
    const t = new HttpTransport({
      name: 'header-test',
      url: 'http://localhost/logs',
      batchSize: 1,
      headers: { 'X-Api-Key': 'secret' },
      fetchImpl: fetchMock,
    });

    t.write(makeEntry());
    await Promise.resolve();

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('secret');
    expect(headers['Content-Type']).toBe('application/json');

    await t.destroy();
  });
});
