import { getGlobalFetch } from '../env';
import { LEVELS } from '../levels';
import type { LogEntry, Transport, TransportConfig } from '../types';

/**
 * Batches log entries and POSTs them to an HTTP endpoint.
 *
 * Features:
 * - Configurable batch size and flush interval
 * - Exponential-backoff retry on failure
 * - `onError(err, droppedEntries)` callback when a batch is permanently dropped
 *   (retries exhausted or evicted by `maxQueueSize`)
 * - `maxQueueSize` + `overflowStrategy` to bound the pending-batch queue
 * - Optional per-entry filter and transform
 * - Works in browser and Node.js ≥ 18 (or pass `fetchImpl` for older Node)
 */
export class HttpTransport implements Transport {
  readonly name: string;

  private config: Required<Omit<TransportConfig, 'filter' | 'transform' | 'fetchImpl' | 'onError'>> &
    Pick<TransportConfig, 'filter' | 'transform' | 'onError'>;
  private fetchFn: typeof fetch;
  private batch: LogEntry[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;
  private retryQueue: LogEntry[][] = [];
  private isProcessing = false;

  constructor(config: TransportConfig) {
    const fetchFn = config.fetchImpl ?? getGlobalFetch();
    if (typeof fetchFn !== 'function') {
      throw new Error(
        `[Konsole HttpTransport: ${config.name}] fetch is not available. ` +
        'Requires Node.js >= 18, or pass fetchImpl (e.g. from "node-fetch").',
      );
    }
    this.fetchFn = fetchFn;
    this.name    = config.name;

    this.config = {
      name:             config.name,
      url:              config.url,
      method:           config.method           ?? 'POST',
      headers:          config.headers          ?? {},
      batchSize:        config.batchSize        ?? 50,
      flushInterval:    config.flushInterval    ?? 10000,
      retryAttempts:    config.retryAttempts    ?? 3,
      maxQueueSize:     config.maxQueueSize     ?? Infinity,
      overflowStrategy: config.overflowStrategy ?? 'drop-oldest',
      filter:           config.filter,
      transform:        config.transform,
      onError:          config.onError,
    };

    this.flushTimer = setInterval(() => this.flush(), this.config.flushInterval);
  }

  write(entry: LogEntry): void {
    if (this.config.filter && !this.config.filter(entry)) return;

    this.batch.push(entry);
    if (this.batch.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    const toSend  = this.batch.splice(0);
    await this.sendBatch(toSend, this.config.retryAttempts);
  }

  async destroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }

  private async sendBatch(entries: LogEntry[], retriesLeft: number): Promise<void> {
    if (this.isProcessing) {
      this.enqueue(entries);
      return;
    }
    this.isProcessing = true;

    try {
      const payload = entries.map((e) => {
        if (this.config.transform) return this.config.transform(e);
        return {
          level:     LEVELS[e.level],
          levelName: e.level,
          time:      e.timestamp.toISOString(),
          namespace: e.namespace,
          msg:       e.msg,
          ...e.fields,
        };
      });

      const res = await this.fetchFn(this.config.url, {
        method:  this.config.method,
        headers: { 'Content-Type': 'application/json', ...this.config.headers },
        body:    JSON.stringify({ transport: this.config.name, logs: payload, sentAt: new Date().toISOString() }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[Konsole HttpTransport: ${this.config.name}]`, err);

      if (retriesLeft > 0) {
        const delay = 2 ** (this.config.retryAttempts - retriesLeft) * 1000;
        setTimeout(() => void this.sendBatch(entries, retriesLeft - 1), delay);
      } else {
        // Retries exhausted — surface to onError so callers can handle it
        // (alerting, DLQ, metrics). Without this, the batch is lost silently.
        this.notifyDropped(entries, err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.isProcessing = false;
      if (this.retryQueue.length > 0) {
        const next = this.retryQueue.shift()!;
        void this.sendBatch(next, this.config.retryAttempts);
      }
    }
  }

  /**
   * Append a batch to the pending queue, dropping per overflow strategy
   * when the queue is full. Drops fire `onError` so they aren't silent.
   */
  private enqueue(entries: LogEntry[]): void {
    if (this.retryQueue.length < this.config.maxQueueSize) {
      this.retryQueue.push(entries);
      return;
    }
    if (this.config.overflowStrategy === 'drop-newest') {
      this.notifyDropped(
        entries,
        new Error(`HttpTransport queue overflow (drop-newest, maxQueueSize=${this.config.maxQueueSize})`),
      );
      return;
    }
    // drop-oldest (default)
    const dropped = this.retryQueue.shift();
    if (dropped) {
      this.notifyDropped(
        dropped,
        new Error(`HttpTransport queue overflow (drop-oldest, maxQueueSize=${this.config.maxQueueSize})`),
      );
    }
    this.retryQueue.push(entries);
  }

  /** Invoke onError with the dropped entries; swallow any user-thrown exceptions. */
  private notifyDropped(entries: LogEntry[], err: Error): void {
    if (!this.config.onError) return;
    try {
      this.config.onError(err, entries);
    } catch (cbErr) {
      console.warn(`[Konsole HttpTransport: ${this.config.name}] onError callback threw:`, cbErr);
    }
  }
}
