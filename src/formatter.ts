import { isNode, isTTY, isBrowser } from './env';
import { LEVELS, LEVEL_LABELS, type LogLevelName } from './levels';
import { serializeError } from './serializers';
import type { LogEntry, TimestampFormat, TimestampOptions } from './types';

/**
 * JSON.stringify replacer that expands Errors into plain objects. Without
 * this, nested Errors (e.g. `{ err: new Error() }`) stringify to `"{}"`
 * because Error's own properties are non-enumerable.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  return value;
}

/** Stringify any value safely, expanding Errors and tolerating circular refs. */
export function safeStringify(val: unknown): string {
  try { return JSON.stringify(val, jsonReplacer) ?? String(val); }
  catch { return '[Circular]'; }
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const R = '\x1b[0m'; // reset

const A = {
  bold:      '\x1b[1m',
  dim:       '\x1b[2m',
  gray:      '\x1b[90m',
  red:       '\x1b[31m',
  brightRed: '\x1b[91m',
  green:     '\x1b[32m',
  yellow:    '\x1b[33m',
  cyan:      '\x1b[36m',
} as const;

// Computed once at import time — zero per-call overhead.
const USE_COLORS: boolean = (() => {
  if (!isNode) return false;
  if (typeof process.env['NO_COLOR'] !== 'undefined') return false;
  if (process.env['FORCE_COLOR'] === '0') return false;
  if (process.env['FORCE_COLOR'] === '1') return true;
  return isTTY();
})();

function paint(codes: string, text: string): string {
  return USE_COLORS ? `${codes}${text}${R}` : text;
}

// ─── Level badge styling ──────────────────────────────────────────────────────

const LEVEL_PAINT: Record<LogLevelName, (s: string) => string> = {
  trace: (s) => paint(A.dim + A.gray, s),
  debug: (s) => paint(A.cyan, s),
  info:  (s) => paint(A.bold + A.green, s),
  warn:  (s) => paint(A.bold + A.yellow, s),
  error: (s) => paint(A.bold + A.red, s),
  fatal: (s) => paint(A.bold + A.brightRed, s),
};

// ─── Timestamp utilities ─────────────────────────────────────────────────────

/** Format local time as HH:MM:SS.mmm */
function formatTimeHMS(date: Date): string {
  const h  = String(date.getHours()).padStart(2, '0');
  const m  = String(date.getMinutes()).padStart(2, '0');
  const s  = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/** Format local date as YYYY-MM-DD */
function formatDateLocal(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Normalize a shorthand `TimestampFormat | TimestampOptions` value into a
 * resolved `{ format, highResolution }` pair.
 */
export function resolveTimestampConfig(
  opt?: TimestampFormat | TimestampOptions,
): { format: TimestampFormat; highResolution: boolean } {
  if (opt === undefined) return { format: 'datetime', highResolution: false };
  if (typeof opt === 'string' || typeof opt === 'function') {
    return { format: opt, highResolution: false };
  }
  return { format: opt.format ?? 'datetime', highResolution: opt.highResolution ?? false };
}

/**
 * Format a `Date` (and optional high-res nanosecond offset) according to a `TimestampFormat`.
 */
export function formatTimestamp(
  date: Date,
  format: TimestampFormat,
  hrTime?: number,
): string {
  if (format === 'none') return '';
  if (typeof format === 'function') return format(date, hrTime);

  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'datetime':
      return `${formatDateLocal(date)} ${formatTimeHMS(date)}`;
    case 'date':
      return formatDateLocal(date);
    case 'time':
      return formatTimeHMS(date);
    case 'unix':
      return String(Math.floor(date.getTime() / 1000));
    case 'unixMs':
      return String(date.getTime());
    default:
      return formatTimeHMS(date);
  }
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

function serializeValue(val: unknown): string {
  if (val instanceof Error) return safeStringify(serializeError(val));
  if (typeof val === 'string') return val.includes(' ') ? `"${val}"` : val;
  if (typeof val === 'object' && val !== null) return safeStringify(val);
  return String(val);
}

function renderFields(fields: Record<string, unknown>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${serializeValue(v)}`).join(' ');
}

function isStdout(level: LogLevelName): boolean {
  return level !== 'error' && level !== 'fatal';
}

// ─── Formatter interface ──────────────────────────────────────────────────────

export interface Formatter {
  write(entry: LogEntry): void;
}

export interface FormatterOptions {
  timestampFormat?: TimestampFormat;
}

// ─── PrettyFormatter ─────────────────────────────────────────────────────────
//
// Output (colors illustrated with brackets):
//
//   [gray]2024-06-15 10:23:45.123[/]  [green bold]INF[/]  [dim][Auth][/]  message  [gray]key=val[/]
//

export class PrettyFormatter implements Formatter {
  private tsFormat: TimestampFormat;

  constructor(opts?: FormatterOptions) {
    this.tsFormat = opts?.timestampFormat ?? 'datetime';
  }

  write(entry: LogEntry): void {
    const ts     = formatTimestamp(entry.timestamp, this.tsFormat, entry.hrTime);
    const time   = ts ? paint(A.gray, ts) : '';
    const badge  = LEVEL_PAINT[entry.level](LEVEL_LABELS[entry.level]);
    const ns     = paint(A.dim, `[${entry.namespace}]`);
    const fields = renderFields(entry.fields);
    const tail   = fields ? paint(A.gray, fields) : '';

    const line = [time, badge, ns, entry.msg, tail].filter(Boolean).join('  ');

    if (isNode) {
      const dest = isStdout(entry.level) ? process.stdout : process.stderr;
      dest.write(line + '\n');
    } else {
      console.log(line);
    }
  }
}

// ─── JsonFormatter ────────────────────────────────────────────────────────────
//
// Newline-delimited JSON — compatible with Datadog, Loki, CloudWatch, etc.
//
//   {"level":30,"levelName":"info","time":"2024-01-01T10:23:45.123Z","namespace":"Auth","msg":"...","userId":1}
//

export class JsonFormatter implements Formatter {
  private tsFormat: TimestampFormat;

  constructor(opts?: FormatterOptions) {
    this.tsFormat = opts?.timestampFormat ?? 'iso';
  }

  write(entry: LogEntry): void {
    const time = formatTimestamp(entry.timestamp, this.tsFormat, entry.hrTime);
    const obj: Record<string, unknown> = {
      level:     LEVELS[entry.level],
      levelName: entry.level,
      time,
      namespace: entry.namespace,
      msg:       entry.msg,
      ...entry.fields,
    };
    if (entry.hrTime !== undefined) {
      obj.hrTime = entry.hrTime;
    }

    const line = JSON.stringify(obj, jsonReplacer);

    if (isNode) {
      const dest = isStdout(entry.level) ? process.stdout : process.stderr;
      dest.write(line + '\n');
    } else {
      console.log(line);
    }
  }
}

// ─── TextFormatter ────────────────────────────────────────────────────────────
//
// Plain text, no ANSI — for CI environments or log files that don't need color.
//

export class TextFormatter implements Formatter {
  private tsFormat: TimestampFormat;

  constructor(opts?: FormatterOptions) {
    this.tsFormat = opts?.timestampFormat ?? 'datetime';
  }

  write(entry: LogEntry): void {
    const ts     = formatTimestamp(entry.timestamp, this.tsFormat, entry.hrTime);
    const fields = renderFields(entry.fields);
    const parts  = [
      ts,
      LEVEL_LABELS[entry.level],
      `[${entry.namespace}]`,
      entry.msg,
      fields,
    ].filter(Boolean);

    console.log(parts.join('  '));
  }
}

// ─── BrowserFormatter ─────────────────────────────────────────────────────────
//
// Uses console %c CSS styling for a polished DevTools experience:
//
//   2024-06-15 10:23:45.123  [ INF ] [Auth]  message  key=val
//

const BROWSER_BADGE: Record<LogLevelName, string> = {
  trace: 'background:#9E9E9E;color:#fff;border-radius:2px;padding:1px 5px;font-size:11px;font-weight:700',
  debug: 'background:#00BCD4;color:#fff;border-radius:2px;padding:1px 5px;font-size:11px;font-weight:700',
  info:  'background:#4CAF50;color:#fff;border-radius:2px;padding:1px 5px;font-size:11px;font-weight:700',
  warn:  'background:#FF9800;color:#fff;border-radius:2px;padding:1px 5px;font-size:11px;font-weight:700',
  error: 'background:#F44336;color:#fff;border-radius:2px;padding:1px 5px;font-size:11px;font-weight:700',
  fatal: 'background:#880E4F;color:#fff;border-radius:2px;padding:1px 5px;font-size:11px;font-weight:700',
};

const BROWSER_CONSOLE: Record<LogLevelName, (...args: unknown[]) => void> = {
  trace: console.debug.bind(console),
  debug: console.debug.bind(console),
  info:  console.info.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
  fatal: console.error.bind(console),
};

export class BrowserFormatter implements Formatter {
  private tsFormat: TimestampFormat;

  constructor(opts?: FormatterOptions) {
    this.tsFormat = opts?.timestampFormat ?? 'datetime';
  }

  write(entry: LogEntry): void {
    const ts     = formatTimestamp(entry.timestamp, this.tsFormat, entry.hrTime);
    const fields = renderFields(entry.fields);

    // Any object args passed directly (shown as expandable in DevTools)
    const expandable = entry.messages.filter(
      (m): m is object => typeof m === 'object' && m !== null,
    );

    let fmt = '';
    const styles: string[] = [];

    // Timestamp (shown in a dim gray before the badge)
    if (ts) {
      fmt += `%c${ts} `;
      styles.push('color:#9E9E9E;font-size:11px');
    }

    fmt += `%c ${LEVEL_LABELS[entry.level]} %c [${entry.namespace}] %c${entry.msg}`;
    styles.push(
      BROWSER_BADGE[entry.level],
      'color:#9E9E9E;font-weight:normal',
      'color:inherit;font-weight:normal',
    );

    if (fields) {
      fmt += ` %c${fields}`;
      styles.push('color:#9E9E9E;font-style:italic');
    }

    const fn = BROWSER_CONSOLE[entry.level];
    fn(fmt, ...styles, ...expandable);
  }
}

// ─── SilentFormatter ─────────────────────────────────────────────────────────
//
// Stores logs in the circular buffer but produces no output.
// Equivalent to the old `criteria: false` default.
//

export class SilentFormatter implements Formatter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  write(_entry: LogEntry): void { /* noop */ }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Picks the best formatter for the current runtime:
 *   browser            → BrowserFormatter  (styled DevTools output)
 *   Node.js + TTY      → PrettyFormatter   (colorized, human-readable)
 *   Node.js + non-TTY  → JsonFormatter     (newline-delimited JSON)
 */
export function createAutoFormatter(tsFormat?: TimestampFormat): Formatter {
  if (isBrowser) return new BrowserFormatter({ timestampFormat: tsFormat });
  if (isTTY())   return new PrettyFormatter({ timestampFormat: tsFormat });
  return new JsonFormatter({ timestampFormat: tsFormat });
}

export function createFormatter(format: KonsoleFormat, tsFormat?: TimestampFormat): Formatter {
  const opts: FormatterOptions = { timestampFormat: tsFormat };
  switch (format) {
    case 'pretty':  return new PrettyFormatter(opts);
    case 'json':    return new JsonFormatter(opts);
    case 'text':    return new TextFormatter(opts);
    case 'browser': return new BrowserFormatter(opts);
    case 'silent':  return new SilentFormatter();
    default:        return createAutoFormatter(tsFormat); // 'auto'
  }
}

export type KonsoleFormat = 'auto' | 'pretty' | 'json' | 'text' | 'browser' | 'silent';
