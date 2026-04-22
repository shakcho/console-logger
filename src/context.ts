/**
 * AsyncLocalStorage-backed context propagation for log entries.
 *
 * Node.js-only. In browsers, `runWithContext` just calls the provided function.
 *
 * Usage:
 * ```ts
 *   await Konsole.enableContext();              // once, at app startup
 *
 *   app.use((req, _res, next) => {
 *     Konsole.runWithContext({ requestId: req.id }, () => next());
 *   });
 *
 *   // Anywhere inside the async scope:
 *   logger.info('handling request');            // entry.fields.requestId is set
 * ```
 *
 * Precedence: `{ ...alsContext, ...childBindings, ...callSiteFields }` — call-site wins.
 * Nested scopes merge (outer keys survive unless the inner scope shadows them).
 */

import { isNode } from './env';
import type { ContextStore } from './types';

interface ALSLike {
  getStore(): ContextStore | undefined;
  run<T>(store: ContextStore, fn: () => T): T;
}

let als: ALSLike | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Idempotent loader for `node:async_hooks`. Returns the same promise on
 * repeated calls so callers can await it safely at startup.
 */
function loadAls(): Promise<void> {
  if (!isNode) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = import('node:async_hooks')
    .then((mod) => {
      als = new (mod as { AsyncLocalStorage: new () => ALSLike }).AsyncLocalStorage();
    })
    .catch(() => {
      // Graceful degradation: `als` stays null — `runWithContext` will throw
      // when called, pointing the user at the explicit init.
    });
  return initPromise;
}

/**
 * Initialize async context propagation. Call during app startup:
 *
 * ```ts
 *   await Konsole.enableContext();
 * ```
 *
 * No-op in browsers. Safe to call multiple times.
 */
export function enableContext(): Promise<void> {
  return loadAls();
}

/**
 * Run `fn` inside a scope where `store` is merged into every log entry.
 * Nested scopes inherit outer keys; inner keys shadow outer on collision.
 *
 * Node.js only — in browsers, `fn` runs directly with no context binding.
 *
 * @throws If called in Node.js before `enableContext()` has resolved.
 */
export function runWithContext<T>(store: ContextStore, fn: () => T): T {
  if (!als) {
    if (!isNode) return fn();
    loadAls();
    throw new Error(
      '[Konsole] Context not initialized. Call `await Konsole.enableContext()` during app startup before using `runWithContext`.'
    );
  }
  const parent = als.getStore();
  return als.run(parent ? { ...parent, ...store } : store, fn);
}

/**
 * Returns the current context store, or `undefined` if none is active.
 * Useful for debugging and tests.
 */
export function getContext(): ContextStore | undefined {
  return als === null ? undefined : als.getStore();
}

/**
 * Internal hot-path accessor used by `Konsole.addLog`.
 * Null-fast: returns `undefined` with no ALS call when context was never enabled.
 */
export function getActiveContext(): ContextStore | undefined {
  return als === null ? undefined : als.getStore();
}
