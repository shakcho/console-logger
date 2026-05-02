import { describe, it, expect, vi } from 'vitest';
import { StreamTransport, type WritableLike } from '../../transports/StreamTransport';
import type { LogEntry } from '../../types';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    msg: 'hello',
    messages: ['hello'],
    fields: {},
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
    namespace: 'Test',
    level: 'info',
    levelValue: 30,
    ...overrides,
  };
}

function makeStream(): { stream: WritableLike; lines: string[] } {
  const lines: string[] = [];
  const stream: WritableLike = {
    write(chunk: string) { lines.push(chunk); return true; },
    end(cb?: (err?: Error | null) => void) { cb?.(); },
    on(this: WritableLike) { return this; },
  };
  return { stream, lines };
}

/**
 * A controllable stream used for backpressure tests:
 * - `setReady(false)` makes subsequent `write()` return `false` (paused)
 * - `setReady(true)` flips back to `true` and emits `'drain'`
 */
function makeControllableStream(): {
  stream: WritableLike;
  lines: string[];
  setReady: (ready: boolean) => void;
} {
  const lines: string[] = [];
  const drainListeners: Array<() => void> = [];
  let ready = true;

  const stream: WritableLike = {
    write(chunk: string) { lines.push(chunk); return ready; },
    end(cb?: (err?: Error | null) => void) { cb?.(); },
    on(event: 'error' | 'drain', listener: ((err: Error) => void) | (() => void)) {
      if (event === 'drain') drainListeners.push(listener as () => void);
      return this;
    },
  };

  return {
    stream,
    lines,
    setReady(next: boolean) {
      const wasPaused = !ready;
      ready = next;
      if (next && wasPaused) drainListeners.forEach((l) => l());
    },
  };
}

describe('StreamTransport', () => {
  it('writes a JSON line for each entry', () => {
    const { stream, lines } = makeStream();
    const t = new StreamTransport({ stream, format: 'json' });

    t.write(makeEntry({ msg: 'first', fields: { n: 1 } }));
    t.write(makeEntry({ msg: 'second' }));

    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0].trim());
    expect(parsed.msg).toBe('first');
    expect(parsed.n).toBe(1);
    expect(parsed.level).toBe(30);
    expect(parsed.levelName).toBe('info');
  });

  it('writes a text line when format is text', () => {
    const { stream, lines } = makeStream();
    const t = new StreamTransport({ stream, format: 'text' });

    t.write(makeEntry({ msg: 'plain text', level: 'warn' }));

    expect(lines[0]).toContain('WRN');
    expect(lines[0]).toContain('plain text');
    expect(lines[0]).toContain('[Test]');
    expect(lines[0]).not.toMatch(/\{/); // no JSON
  });

  it('appends a newline to each written chunk', () => {
    const { stream, lines } = makeStream();
    const t = new StreamTransport({ stream });
    t.write(makeEntry());
    expect(lines[0]).toMatch(/\n$/);
  });

  it('applies a filter — skips entries that fail the predicate', () => {
    const { stream, lines } = makeStream();
    const t = new StreamTransport({
      stream,
      filter: (e) => e.level === 'error',
    });

    t.write(makeEntry({ level: 'info' }));
    t.write(makeEntry({ level: 'error', msg: 'boom' }));

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0].trim());
    expect(parsed.msg).toBe('boom');
  });

  it('uses the name provided in options', () => {
    const { stream } = makeStream();
    const t = new StreamTransport({ stream, name: 'my-stream' });
    expect(t.name).toBe('my-stream');
  });

  it('defaults name to stream', () => {
    const { stream } = makeStream();
    const t = new StreamTransport({ stream });
    expect(t.name).toBe('stream');
  });

  it('calls stream.end on destroy', async () => {
    const { stream } = makeStream();
    const endSpy = vi.spyOn(stream, 'end');
    const t = new StreamTransport({ stream });
    await t.destroy();
    expect(endSpy).toHaveBeenCalledOnce();
  });

  describe('backpressure', () => {
    it('queues entries when stream.write returns false and flushes on drain', () => {
      const { stream, lines, setReady } = makeControllableStream();
      const t = new StreamTransport({ stream });

      // First write fills the buffer — stream returns false, transport pauses.
      setReady(false);
      t.write(makeEntry({ msg: 'first' }));   // written to stream, but stream is now paused
      t.write(makeEntry({ msg: 'second' }));  // queued in the transport
      t.write(makeEntry({ msg: 'third' }));   // queued in the transport

      // Only the first write reached the stream — the rest are pending.
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0].trim()).msg).toBe('first');

      // Drain — pending entries flush in order.
      setReady(true);
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[1].trim()).msg).toBe('second');
      expect(JSON.parse(lines[2].trim()).msg).toBe('third');
    });

    it('drops oldest entry when maxQueueSize is exceeded (default)', () => {
      const { stream, setReady } = makeControllableStream();
      const onDrop = vi.fn();
      const t = new StreamTransport({ stream, maxQueueSize: 1, onDrop });

      setReady(false);
      t.write(makeEntry({ msg: 'first' }));   // goes to stream
      t.write(makeEntry({ msg: 'queued-1' })); // pending[0]
      t.write(makeEntry({ msg: 'queued-2' })); // evicts queued-1

      expect(onDrop).toHaveBeenCalledOnce();
      const [entries, reason] = onDrop.mock.calls[0];
      expect(entries[0].msg).toBe('queued-1');
      expect(reason).toMatch(/drop-oldest/);
    });

    it('drops the new entry when overflowStrategy is drop-newest', () => {
      const { stream, setReady } = makeControllableStream();
      const onDrop = vi.fn();
      const t = new StreamTransport({
        stream,
        maxQueueSize: 1,
        overflowStrategy: 'drop-newest',
        onDrop,
      });

      setReady(false);
      t.write(makeEntry({ msg: 'first' }));
      t.write(makeEntry({ msg: 'queued-1' }));
      t.write(makeEntry({ msg: 'queued-2' })); // dropped

      expect(onDrop).toHaveBeenCalledOnce();
      const [entries, reason] = onDrop.mock.calls[0];
      expect(entries[0].msg).toBe('queued-2');
      expect(reason).toMatch(/drop-newest/);
    });

    it('does not call onDrop when queue is unbounded', () => {
      const { stream, setReady } = makeControllableStream();
      const onDrop = vi.fn();
      const t = new StreamTransport({ stream, onDrop });

      setReady(false);
      for (let i = 0; i < 100; i++) t.write(makeEntry({ msg: `m-${i}` }));

      expect(onDrop).not.toHaveBeenCalled();
    });

    it('swallows exceptions thrown from onDrop callback', () => {
      const { stream, setReady } = makeControllableStream();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const t = new StreamTransport({
        stream,
        maxQueueSize: 1,
        onDrop: () => { throw new Error('user code blew up'); },
      });

      setReady(false);
      t.write(makeEntry({ msg: 'first' }));
      t.write(makeEntry({ msg: 'queued-1' }));
      expect(() => t.write(makeEntry({ msg: 'queued-2' }))).not.toThrow();

      warnSpy.mockRestore();
    });
  });

  it('logs a console error when stream.write throws', () => {
    const errorStream: WritableLike = {
      write() { throw new Error('write failed'); },
      end(cb) { cb?.(); },
      on(this: WritableLike) { return this; },
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = new StreamTransport({ stream: errorStream });
    t.write(makeEntry());
    expect(errSpy).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });
});
