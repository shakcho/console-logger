import { LEVELS, LEVEL_LABELS } from '../levels';
import { serializeError } from '../serializers';
import type { LogEntry } from '../types';

export type FileFormat = 'json' | 'text';

// ─── Shared serialization used by file / stream transports ───────────────────

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  return value;
}

function serializeValue(val: unknown): string {
  if (val instanceof Error) return JSON.stringify(serializeError(val));
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null) {
    try { return JSON.stringify(val, jsonReplacer); } catch { return '[Circular]'; }
  }
  return String(val);
}

/**
 * Serialize a log entry to a single-line JSON string.
 * Schema is compatible with Pino / Datadog / Loki ingest formats.
 */
export function toJsonLine(entry: LogEntry): string {
  const obj: Record<string, unknown> = {
    level:     LEVELS[entry.level],
    levelName: entry.level,
    time:      entry.timestamp.toISOString(),
    namespace: entry.namespace,
    msg:       entry.msg,
    ...entry.fields,
  };
  if (entry.hrTime !== undefined) {
    obj.hrTime = entry.hrTime;
  }
  return JSON.stringify(obj, jsonReplacer);
}

/** Format local date+time as YYYY-MM-DD HH:MM:SS.mmm */
function formatDatetime(date: Date): string {
  const y  = String(date.getFullYear());
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  const h  = String(date.getHours()).padStart(2, '0');
  const m  = String(date.getMinutes()).padStart(2, '0');
  const s  = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${d} ${h}:${m}:${s}.${ms}`;
}

/** Serialize a log entry to a human-readable text line (no ANSI). */
export function toTextLine(entry: LogEntry): string {
  const fields = Object.entries(entry.fields)
    .map(([k, v]) => `${k}=${serializeValue(v)}`)
    .join(' ');

  return [
    formatDatetime(entry.timestamp),
    LEVEL_LABELS[entry.level],
    `[${entry.namespace}]`,
    entry.msg,
    fields,
  ].filter(Boolean).join('  ');
}

export function toLine(entry: LogEntry, format: FileFormat): string {
  return format === 'json' ? toJsonLine(entry) : toTextLine(entry);
}
