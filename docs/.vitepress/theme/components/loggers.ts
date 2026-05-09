import { ref } from 'vue';
import { Konsole } from 'konsole-logger';

export const NAMESPACES = ['App', 'Auth', 'API'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export const LEVELS: Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

// Created at module load — Konsole is SSR-safe (it guards access to window).
export const loggers: Record<Namespace, Konsole> = {
  App:  new Konsole({ namespace: 'App',  format: 'silent', level: 'trace', maxLogs: 1000 }),
  Auth: new Konsole({ namespace: 'Auth', format: 'silent', level: 'trace', maxLogs: 1000 }),
  API:  new Konsole({ namespace: 'API',  format: 'silent', level: 'trace', maxLogs: 1000 }),
};

// Reactive counter — incremented after every log so consumers re-render.
export const logTick = ref(0);

export function bumpTick() {
  logTick.value++;
}

export function exposeOnce() {
  if (typeof window === 'undefined') return;
  Konsole.exposeToWindow();
}

export const LEVEL_MESSAGES: Record<Level, string[]> = {
  trace: ['→ enterFunction', '← exitFunction', 'loop i=0', 'loop i=1', 'allocated 4kb'],
  debug: ['Config loaded', 'Cache miss — fetching', 'Query plan generated', 'Token refreshed', 'Feature flag: on'],
  info:  ['Server started', 'User logged in', 'Order placed', 'Payment processed', 'Session initialized'],
  warn:  ['Slow response >500ms', 'Rate limit at 80%', 'Deprecated API used', 'Retrying request', 'Memory at 75%'],
  error: ['Database unreachable', 'Auth failed', 'Network timeout', 'Invalid payload', 'Permission denied'],
  fatal: ['Out of memory', 'Disk full', 'Unrecoverable crash', 'Segmentation fault', 'Stack overflow'],
};

export function formatTime(d: Date) {
  const y = String(d.getFullYear());
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${day} ${h}:${m}:${sec}.${ms}`;
}

export function formatFields(fields: Record<string, unknown>) {
  const entries = Object.entries(fields);
  if (!entries.length) return '';
  return entries
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('  ');
}
