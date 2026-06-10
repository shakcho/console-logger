import { isNode } from '../env';
import { toLine, type FileFormat } from './base';
import type { LogEntry, Transport } from '../types';

/**
 * Minimal writable-stream contract — duck-typed so it works with Node.js
 * `stream.Writable`, `fs.WriteStream`, and any compatible implementation
 * without requiring `@types/node` in the consumer's project.
 */
export interface WritableLike {
  /** Returns `false` when the internal buffer is full. Listen for `'drain'` to resume. */
  write(chunk: string): boolean;
  end(cb?: (err?: Error | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'drain', listener: () => void): this;
}

export interface StreamTransportOptions {
  /** The writable stream to pipe entries into. */
  stream: WritableLike;
  /** Default: 'stream' */
  name?: string;
  /**
   * Line format written to the stream.
   * - `'json'`  — newline-delimited JSON (default, best for log aggregators)
   * - `'text'`  — human-readable plain text
   */
  format?: FileFormat;
  /** Only write entries that pass this predicate. */
  filter?: (entry: LogEntry) => boolean;
  /**
   * Cap the number of entries buffered while the stream is paused under
   * backpressure. When the queue reaches this size, entries are dropped per
   * `overflowStrategy` and surfaced via `onDrop`.
   * @default Infinity (unbounded — matches pre-backpressure behaviour)
   */
  maxQueueSize?: number;
  /**
   * What to drop when `maxQueueSize` is reached during backpressure.
   * - `'drop-oldest'` — discard the oldest queued entry (default; favours fresh data)
   * - `'drop-newest'` — discard the incoming entry (favours older data)
   * @default 'drop-oldest'
   */
  overflowStrategy?: 'drop-oldest' | 'drop-newest';
  /**
   * Called when entries are dropped due to backpressure-queue overflow.
   * Use this to surface dropped logs (alerting, metrics).
   */
  onDrop?: (entries: LogEntry[], reason: string) => void;
  /**
   * How many queued entries to flush into the stream on each `'drain'` event.
   *
   * The stream signals backpressure (its `write()` returns `false`) once its
   * internal buffer hits the high-water mark — typically after only ~16 KB.
   * If we stopped feeding it at that first signal and waited for the buffer to
   * fully empty before refilling, the write pipeline would idle for half of
   * every drain cycle, capping throughput far below the stream's real capacity.
   *
   * Instead we keep feeding the stream past the high-water mark, up to this many
   * entries per drain, so its buffer stays deep and the OS write path stays
   * saturated. Memory is still bounded: at most `flushBatchSize` entries sit in
   * the stream's buffer, and the rest wait in the (capped) `pending` queue.
   * @default 4096
   */
  flushBatchSize?: number;
}

/**
 * Writes log entries as serialized lines into any `WritableLike` stream.
 *
 * Respects backpressure: when `stream.write()` returns `false`, subsequent
 * entries are queued in memory until the stream emits `'drain'`. The queue is
 * unbounded by default — set `maxQueueSize` to cap memory growth in
 * pathological cases (e.g. a permanently slow consumer).
 *
 * @example
 * ```ts
 * import { createWriteStream } from 'node:fs';
 *
 * const logger = new Konsole({
 *   namespace: 'App',
 *   transports: [
 *     new StreamTransport({
 *       stream: createWriteStream('/tmp/debug.log', { flags: 'a' }),
 *       format: 'json',
 *       maxQueueSize: 10000,
 *       onDrop: (entries, reason) => metrics.increment('log.dropped', entries.length, { reason }),
 *     }),
 *   ],
 * });
 * ```
 */
export class StreamTransport implements Transport {
  readonly name: string;
  protected stream: WritableLike;
  protected format: FileFormat;
  protected filter?: (entry: LogEntry) => boolean;

  // ── Backpressure plumbing ──────────────────────────────────────────────────
  /** True when the stream's internal buffer is full and we're waiting on 'drain'. */
  protected paused = false;
  /** Entries deferred while paused. */
  protected pending: LogEntry[] = [];
  protected maxQueueSize: number;
  protected overflowStrategy: 'drop-oldest' | 'drop-newest';
  protected onDrop?: (entries: LogEntry[], reason: string) => void;
  protected flushBatchSize: number;

  constructor(options: StreamTransportOptions) {
    if (!isNode) {
      throw new Error('[Konsole StreamTransport] StreamTransport is only available in Node.js.');
    }
    this.name             = options.name             ?? 'stream';
    this.stream           = options.stream;
    this.format           = options.format           ?? 'json';
    this.filter           = options.filter;
    this.maxQueueSize     = options.maxQueueSize     ?? Infinity;
    this.overflowStrategy = options.overflowStrategy ?? 'drop-oldest';
    this.onDrop           = options.onDrop;
    this.flushBatchSize   = options.flushBatchSize   ?? 4096;

    this.attachStreamListeners(this.stream);
  }

  write(entry: LogEntry): void {
    if (this.filter && !this.filter(entry)) return;
    if (this.paused) {
      this.enqueuePending(entry);
      return;
    }
    this.doStreamWrite(entry);
  }

  async destroy(): Promise<void> {
    return new Promise((resolve) => {
      this.stream.end(() => resolve());
    });
  }

  /** Attach 'error' and 'drain' listeners. Call again after swapping the stream (e.g. file rotation). */
  protected attachStreamListeners(stream: WritableLike): void {
    stream.on('error', (err) => {
      console.error(`[Konsole StreamTransport: ${this.name}] Stream error: ${err.message}`);
    });
    stream.on('drain', () => {
      this.paused = false;
      this.flushPending();
    });
  }

  /**
   * Serialize and write one entry. Returns the stream's backpressure signal
   * (`false` once the buffer is past its high-water mark). Does not touch the
   * paused flag — callers decide what to do with the signal.
   */
  protected rawWrite(entry: LogEntry): boolean {
    try {
      const line = toLine(entry, this.format) + '\n';
      const ok   = this.stream.write(line);
      this.afterWrite(entry, line, ok);
      return ok;
    } catch (err) {
      console.error(`[Konsole StreamTransport: ${this.name}] Write error:`, err);
      return true; // treat a write error as "keep going" rather than wedging the queue
    }
  }

  /**
   * Write one entry on the live path, pausing the producer if the stream is now
   * backpressured. Subclasses may override to track additional state, but should
   * preserve the paused-flag side effect.
   */
  protected doStreamWrite(entry: LogEntry): void {
    if (!this.rawWrite(entry)) this.paused = true;
  }

  /** Hook for subclasses to react to a successful (or attempted) write. */
  protected afterWrite(_entry: LogEntry, _line: string, _ok: boolean): void {}

  /** Hook: subclasses return true to halt an in-progress batch flush (e.g. mid-rotation). */
  protected shouldHaltFlush(): boolean { return false; }

  /** Append to the pending queue, dropping per overflow strategy when full. */
  protected enqueuePending(entry: LogEntry): void {
    if (this.pending.length < this.maxQueueSize) {
      this.pending.push(entry);
      return;
    }
    if (this.overflowStrategy === 'drop-newest') {
      this.notifyDropped([entry], 'backpressure overflow (drop-newest)');
      return;
    }
    const dropped = this.pending.shift()!;
    this.notifyDropped([dropped], 'backpressure overflow (drop-oldest)');
    this.pending.push(entry);
  }

  /**
   * Flush queued entries on `'drain'`. We deliberately keep writing past the
   * stream's high-water mark — up to `flushBatchSize` entries — so the stream's
   * buffer stays deep and the OS write path never idles between drain cycles.
   * (Stopping at the first backpressure signal lets the buffer fully empty
   * before refilling, which roughly halves throughput.) The producer resumes
   * only once the backlog is gone and the stream has room again.
   */
  protected flushPending(): void {
    const queue = this.pending;
    const limit = Math.min(queue.length, this.flushBatchSize);
    let i = 0;
    let ok = true;
    while (i < limit && !this.shouldHaltFlush()) {
      ok = this.rawWrite(queue[i]);
      i++;
    }
    // Drop the flushed prefix in a single O(remaining) slice. Using
    // `queue.shift()` per entry would make a full-batch flush O(n²) — fatal
    // for a large backlog.
    this.pending = i >= queue.length ? [] : queue.slice(i);
    this.paused = this.pending.length > 0 || !ok;
  }

  protected notifyDropped(entries: LogEntry[], reason: string): void {
    if (!this.onDrop) return;
    try {
      this.onDrop(entries, reason);
    } catch (err) {
      console.warn(`[Konsole StreamTransport: ${this.name}] onDrop callback threw:`, err);
    }
  }
}
