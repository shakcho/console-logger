import { isNode } from '../env';
import { type FileFormat } from './base';
import { StreamTransport, type StreamTransportOptions, type WritableLike } from './StreamTransport';
import type { LogEntry } from '../types';

export interface RotationOptions {
  /** Rotate when file exceeds this size in bytes. e.g. `10 * 1024 * 1024` for 10 MB. */
  maxSize?: number;
  /** Rotate on a time interval: `'daily'` | `'hourly'` | number (ms). */
  interval?: 'daily' | 'hourly' | number;
  /** Maximum number of rotated files to retain. Oldest are deleted. Default: 5. */
  maxFiles?: number;
  /** Gzip-compress rotated files. Default: false. */
  compress?: boolean;
}

export interface FileTransportOptions {
  /** Absolute or relative path of the log file. */
  path: string;
  /** Default: derived from path, e.g. `'file:/var/log/app.log'` */
  name?: string;
  /**
   * Line format.
   * - `'json'`  — newline-delimited JSON (default)
   * - `'text'`  — human-readable plain text
   */
  format?: FileFormat;
  /**
   * File open flag passed to `fs.createWriteStream`.
   * - `'a'`  — append (default, safe for long-running processes)
   * - `'w'`  — truncate on open
   */
  flags?: 'a' | 'w';
  /** Only write entries that pass this predicate. */
  filter?: (entry: LogEntry) => boolean;
  /** File rotation configuration. Omit to disable rotation. */
  rotation?: RotationOptions;
  /** Cap entries buffered while the stream is paused under backpressure (default: Infinity). */
  maxQueueSize?: number;
  /** Drop strategy when `maxQueueSize` is reached (default: `'drop-oldest'`). */
  overflowStrategy?: 'drop-oldest' | 'drop-newest';
  /** Called when entries are dropped due to backpressure-queue overflow. */
  onDrop?: (entries: LogEntry[], reason: string) => void;
}

/**
 * Appends log entries as serialized lines to a file on disk.
 *
 * Node.js only. Uses `fs.createWriteStream` internally — efficient for
 * high-throughput logging (writes are buffered by the OS).
 *
 * Entries written before the file handle is opened are buffered in memory
 * and flushed automatically once the stream is ready — no `await ready()`
 * needed for normal use.
 *
 * @example
 * ```ts
 * const logger = new Konsole({
 *   namespace: 'App',
 *   format: 'pretty',    // human-readable in terminal
 *   transports: [
 *     new FileTransport({ path: '/var/log/app.log' }),  // JSON to disk
 *   ],
 * });
 * ```
 *
 * @example
 * ```ts
 * // With rotation: 10 MB per file, keep 7 rotated files, compress old files
 * new FileTransport({
 *   path: '/var/log/app.log',
 *   rotation: { maxSize: 10 * 1024 * 1024, maxFiles: 7, compress: true },
 * });
 * ```
 */
export class FileTransport extends StreamTransport {
  private isReady = false;
  private pendingEntries: LogEntry[] = [];
  private filePath: string;
  private fileFlags: string;
  private initialized: Promise<void>;
  private rotationOpts: RotationOptions | undefined;
  private bytesWritten = 0;
  private rotating = false;
  private rotationInProgress: Promise<void> | null = null;
  private rotationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: FileTransportOptions) {
    if (!isNode) {
      throw new Error('[Konsole FileTransport] FileTransport is only available in Node.js.');
    }

    super({
      stream:           createPlaceholder(),
      name:             options.name   ?? `file:${options.path}`,
      format:           options.format ?? 'json',
      filter:           options.filter,
      maxQueueSize:     options.maxQueueSize,
      overflowStrategy: options.overflowStrategy,
      onDrop:           options.onDrop,
    } satisfies StreamTransportOptions);

    this.filePath     = options.path;
    this.fileFlags    = options.flags ?? 'a';
    this.rotationOpts = options.rotation;
    this.initialized  = this.openFile(this.fileFlags);
  }

  /** Override write to buffer entries until the file stream is open. */
  override write(entry: LogEntry): void {
    if (this.filter && !this.filter(entry)) return;
    if (!this.isReady || this.rotating) {
      this.pendingEntries.push(entry);
      return;
    }
    if (this.paused) {
      this.enqueuePending(entry);
      return;
    }
    this.doStreamWrite(entry);
  }

  /** Track byte count + trigger size-based rotation after every successful write. */
  protected override afterWrite(_entry: LogEntry, line: string, _ok: boolean): void {
    this.bytesWritten += Buffer.byteLength(line, 'utf8');
    if (
      this.rotationOpts?.maxSize &&
      !this.rotating &&
      this.bytesWritten >= this.rotationOpts.maxSize
    ) {
      this.triggerRotation();
    }
  }

  /**
   * Resolves once the underlying file stream has been opened.
   * Not required for normal use — entries are buffered automatically.
   */
  ready(): Promise<void> {
    return this.initialized;
  }

  override async destroy(): Promise<void> {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
    if (this.rotationInProgress) await this.rotationInProgress;
    return new Promise((resolve) => {
      this.stream.end(() => resolve());
    });
  }

  // ─── Rotation ──────────────────────────────────────────────────────────────

  private triggerRotation(): void {
    if (this.rotating) return;
    this.rotating = true;
    this.rotationInProgress = this.rotate().finally(() => {
      this.rotationInProgress = null;
    });
  }

  private async rotate(): Promise<void> {
    // 1. Close current stream
    await new Promise<void>((resolve) => {
      this.stream.end(() => resolve());
    });

    const maxFiles = this.rotationOpts?.maxFiles ?? 5;

    // 2. Shift rotated files
    await shiftFiles(this.filePath, maxFiles);

    // 3. Compress the freshly rotated file if requested
    if (this.rotationOpts?.compress) {
      // Fire-and-forget — compression runs in background
      compressFile(`${this.filePath}.1`).catch(() => {
        // Compression failure is non-fatal
      });
    }

    // 4. Open a new file stream
    await this.openFile('a');

    // 5. Resume — isReady set by openFile, pending flushed there
    this.rotating = false;
    this.bytesWritten = 0;

    // Flush entries that arrived during rotation. Route through the
    // backpressure-aware path so a slow new stream doesn't drop logs.
    const queued = this.pendingEntries;
    this.pendingEntries = [];
    for (const entry of queued) {
      if (this.paused) {
        this.enqueuePending(entry);
      } else {
        this.doStreamWrite(entry);
      }
    }

    // Reschedule timer-based rotation
    this.scheduleTimerRotation();
  }

  private scheduleTimerRotation(): void {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
    const interval = this.rotationOpts?.interval;
    if (!interval) return;

    let delayMs: number;
    const now = Date.now();

    if (interval === 'daily') {
      const next = new Date();
      next.setHours(24, 0, 0, 0);
      delayMs = next.getTime() - now;
    } else if (interval === 'hourly') {
      const next = new Date();
      next.setMinutes(60, 0, 0);
      delayMs = next.getTime() - now;
    } else {
      delayMs = interval;
    }

    this.rotationTimer = setTimeout(() => {
      this.rotationTimer = null;
      if (!this.rotating) this.triggerRotation();
    }, delayMs);

    // Don't keep the process alive just for rotation
    if (typeof this.rotationTimer === 'object' && 'unref' in this.rotationTimer) {
      this.rotationTimer.unref();
    }
  }

  // ─── File open ─────────────────────────────────────────────────────────────

  private async openFile(flags: string): Promise<void> {
    // Vite externalizes node:fs as a CJS module — named-export destructuring
    // may fail in the bundle. Access via .default as a fallback.
    const fsModule = await import('node:fs');
    const createWriteStream =
      fsModule.createWriteStream ??
      (fsModule as unknown as { default?: typeof import('node:fs') }).default?.createWriteStream;

    if (typeof createWriteStream !== 'function') {
      throw new Error('[Konsole FileTransport] Failed to load node:fs.createWriteStream');
    }

    const fileStream = createWriteStream(this.filePath, { flags }) as unknown as WritableLike;

    this.stream  = fileStream;
    this.paused  = false; // fresh stream — discard any stale paused state from prior rotation
    this.isReady = true;
    // Attach base error + drain listeners to the new stream so backpressure works
    // across rotations.
    this.attachStreamListeners(fileStream);

    // Seed bytesWritten from existing file size when appending
    if (flags === 'a' && this.rotationOpts) {
      try {
        const fsp = await import('node:fs/promises');
        const stat =
          fsp.stat ?? (fsp as unknown as { default?: typeof import('node:fs/promises') }).default?.stat;
        if (typeof stat === 'function') {
          const st = await stat(this.filePath);
          this.bytesWritten = st.size;
        }
      } catch {
        // File may not exist yet — that's fine, start at 0
      }
    }

    // Flush entries that arrived before the stream was ready. Use the
    // backpressure-aware write path so byte counts + drain are honoured.
    const queued = this.pendingEntries;
    this.pendingEntries = [];
    for (const entry of queued) {
      if (this.paused) {
        this.enqueuePending(entry);
      } else {
        this.doStreamWrite(entry);
      }
    }

    // Schedule time-based rotation
    this.scheduleTimerRotation();
  }
}

// ─── Rotation helpers ──────────────────────────────────────────────────────────

async function shiftFiles(basePath: string, maxFiles: number): Promise<void> {
  const fsp = await import('node:fs/promises');
  const rename = fsp.rename ?? (fsp as unknown as { default?: typeof import('node:fs/promises') }).default?.rename;
  const unlink = fsp.unlink ?? (fsp as unknown as { default?: typeof import('node:fs/promises') }).default?.unlink;

  if (typeof rename !== 'function' || typeof unlink !== 'function') return;

  // Delete the oldest files that exceed retention
  for (const ext of ['', '.gz']) {
    try { await unlink(`${basePath}.${maxFiles}${ext}`); } catch { /* ENOENT ok */ }
  }

  // Shift remaining: .{n-1} → .{n}
  for (let i = maxFiles - 1; i >= 1; i--) {
    for (const ext of ['', '.gz']) {
      try { await rename(`${basePath}.${i}${ext}`, `${basePath}.${i + 1}${ext}`); } catch { /* ENOENT ok */ }
    }
  }

  // Rotate current → .1
  try { await rename(basePath, `${basePath}.1`); } catch { /* ENOENT ok */ }
}

async function compressFile(filePath: string): Promise<void> {
  const fs = await import('node:fs');
  const zlib = await import('node:zlib');
  const { pipeline } = await import('node:stream/promises');

  const createReadStream =
    fs.createReadStream ?? (fs as unknown as { default?: typeof import('node:fs') }).default?.createReadStream;
  const createWriteStream =
    fs.createWriteStream ?? (fs as unknown as { default?: typeof import('node:fs') }).default?.createWriteStream;
  const createGzip =
    zlib.createGzip ?? (zlib as unknown as { default?: typeof import('node:zlib') }).default?.createGzip;

  if (typeof createReadStream !== 'function' || typeof createWriteStream !== 'function' || typeof createGzip !== 'function') return;

  await pipeline(
    createReadStream(filePath),
    createGzip(),
    createWriteStream(filePath + '.gz'),
  );

  const fsp = await import('node:fs/promises');
  const unlink = fsp.unlink ?? (fsp as unknown as { default?: typeof import('node:fs/promises') }).default?.unlink;
  if (typeof unlink === 'function') {
    await unlink(filePath);
  }
}

/** A no-op stream used as a placeholder during async file open. */
function createPlaceholder(): WritableLike {
  return {
    write: () => true,
    end:   (cb) => { cb?.(); },
    on:    function(this: WritableLike) { return this; },
  };
}
