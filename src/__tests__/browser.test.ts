// @vitest-environment happy-dom
//
// Integration tests for browser-specific code paths. Runs under happy-dom so
// `window`, `document`, `Worker`, `Blob`, and `URL.createObjectURL` are all
// available. The `// @vitest-environment` pragma above overrides the global
// `node` environment in `vitest.config.ts` for this file only.
//
// Note: BrowserFormatter binds `console.info/warn/error/debug` once at module
// load time. We use `vi.hoisted()` to install recording wrappers BEFORE the
// formatter module imports run, so the bound references resolve to our
// recorders.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const consoleCalls = vi.hoisted(() => {
  const calls: Record<'info' | 'warn' | 'error' | 'debug', unknown[][]> = {
    info: [], warn: [], error: [], debug: [],
  };
  console.info  = (...args: unknown[]) => { calls.info.push(args);  };
  console.warn  = (...args: unknown[]) => { calls.warn.push(args);  };
  console.error = (...args: unknown[]) => { calls.error.push(args); };
  console.debug = (...args: unknown[]) => { calls.debug.push(args); };
  return calls;
});

import { Konsole } from '../Konsole';
import { isBrowser } from '../env';
import { BrowserFormatter, createAutoFormatter } from '../formatter';

function clearConsoleCalls() {
  consoleCalls.info.length  = 0;
  consoleCalls.warn.length  = 0;
  consoleCalls.error.length = 0;
  consoleCalls.debug.length = 0;
}

async function resetState() {
  const ns = Konsole.getNamespaces();
  for (const n of ns) {
    await Konsole.getLogger(n).destroy();
  }
  Konsole.enableGlobalPrint(false);
  delete (window as unknown as Record<string, unknown>).__Konsole;
  clearConsoleCalls();
}

beforeEach(resetState);
afterEach(resetState);

describe('browser env detection', () => {
  it('reports isBrowser=true under happy-dom', () => {
    expect(isBrowser).toBe(true);
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('createAutoFormatter returns a BrowserFormatter', () => {
    const formatter = createAutoFormatter();
    expect(formatter).toBeInstanceOf(BrowserFormatter);
  });

  it('Konsole defaults the buffer to enabled in browser', () => {
    const logger = new Konsole({ namespace: 'BufferDefault', format: 'silent' });
    logger.info('first');
    logger.info('second');
    expect(logger.getLogs()).toHaveLength(2);
  });
});

describe('BrowserFormatter via console %c styling', () => {
  it('format:auto routes info logs to console.info with %c styles', () => {
    const logger = new Konsole({ namespace: 'Auth', format: 'auto' });
    logger.info('hello world');

    expect(consoleCalls.info).toHaveLength(1);
    const [fmt, ...rest] = consoleCalls.info[0] as [string, ...string[]];
    expect(fmt).toContain('%c');
    expect(fmt).toContain('INF');
    expect(fmt).toContain('[Auth]');
    expect(fmt).toContain('hello world');
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.some((s) => typeof s === 'string' && s.includes('background:'))).toBe(true);
  });

  it('routes warn to console.warn and error/fatal to console.error', () => {
    const logger = new Konsole({ namespace: 'Routing', format: 'auto' });
    logger.warn('careful');
    logger.error('boom');
    logger.fatal('dead');

    expect(consoleCalls.warn).toHaveLength(1);
    expect(consoleCalls.error).toHaveLength(2);
  });

  it('passes object args through as expandable DevTools args', () => {
    const logger = new Konsole({ namespace: 'Obj', format: 'auto' });
    const obj = { userId: 7 };
    logger.info('payload', obj);

    expect(consoleCalls.info).toHaveLength(1);
    const args = consoleCalls.info[0];
    // BrowserFormatter appends raw object args verbatim so DevTools renders
    // them as expandable trees. The object is the LAST arg.
    expect(args[args.length - 1]).toBe(obj);
  });

  it('renders a leading timestamp when timestamp preset is set', () => {
    const logger = new Konsole({ namespace: 'TS', format: 'auto', timestamp: 'iso' });
    logger.info('msg');

    const [fmt] = consoleCalls.info[0] as [string];
    expect(fmt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('omits the timestamp prefix when timestamp:none', () => {
    const logger = new Konsole({ namespace: 'NoTs', format: 'auto', timestamp: 'none' });
    logger.info('msg');

    const [fmt] = consoleCalls.info[0] as [string];
    // Format string starts with the badge %c, not a timestamp %c.
    expect(fmt.startsWith('%c ')).toBe(true);
  });
});

describe('Konsole.exposeToWindow', () => {
  it('attaches a __Konsole debug handle to window', () => {
    Konsole.exposeToWindow();
    const handle = (window as unknown as { __Konsole?: Record<string, unknown> }).__Konsole;
    expect(handle).toBeDefined();
    expect(typeof handle!.getLogger).toBe('function');
    expect(typeof handle!.listLoggers).toBe('function');
    expect(typeof handle!.enableAll).toBe('function');
    expect(typeof handle!.disableAll).toBe('function');
    expect(typeof handle!.setTimestamp).toBe('function');
    expect(typeof handle!.disableRedaction).toBe('function');
  });

  it('listLoggers returns all registered namespaces', () => {
    new Konsole({ namespace: 'One',   format: 'silent' });
    new Konsole({ namespace: 'Two',   format: 'silent' });
    new Konsole({ namespace: 'Three', format: 'silent' });
    Konsole.exposeToWindow();

    const handle = (window as unknown as {
      __Konsole: { listLoggers: () => string[] };
    }).__Konsole;
    const namespaces = handle.listLoggers();
    expect(namespaces).toEqual(expect.arrayContaining(['One', 'Two', 'Three']));
  });

  it('enableAll/disableAll toggles the global print flag and unsilences silent loggers', () => {
    new Konsole({ namespace: 'Silenced', format: 'silent' });
    Konsole.exposeToWindow();
    const handle = (window as unknown as {
      __Konsole: { enableAll: () => void; disableAll: () => void };
    }).__Konsole;

    // format:'silent' uses SilentFormatter — even with enableAll, the silent
    // formatter is the one called, so console is not invoked. Instead, assert
    // on the global flag directly.
    handle.enableAll();
    expect(
      (globalThis as Record<string, unknown>).__KonsolePrintEnabled__,
    ).toBe(true);

    handle.disableAll();
    expect(
      (globalThis as Record<string, unknown>).__KonsolePrintEnabled__,
    ).toBe(false);
  });

  it('disableRedaction(true) reveals redacted values, false re-enables', () => {
    new Konsole({
      namespace: 'Redact',
      format: 'silent',
      redact: ['password'],
    });
    Konsole.exposeToWindow();
    const handle = (window as unknown as {
      __Konsole: { disableRedaction: (b: boolean) => void };
    }).__Konsole;

    Konsole.getLogger('Redact').info('login', { password: 'hunter2' });
    expect(Konsole.getLogger('Redact').getLogs()[0].fields).toEqual({
      password: '[REDACTED]',
    });

    handle.disableRedaction(true);
    Konsole.getLogger('Redact').info('login', { password: 'hunter2' });
    expect(Konsole.getLogger('Redact').getLogs()[1].fields).toEqual({
      password: 'hunter2',
    });

    handle.disableRedaction(false);
    Konsole.getLogger('Redact').info('login', { password: 'hunter2' });
    expect(Konsole.getLogger('Redact').getLogs()[2].fields).toEqual({
      password: '[REDACTED]',
    });
  });

  it('setTimestamp updates every registered logger', () => {
    const a = new Konsole({ namespace: 'A', format: 'silent' });
    const b = new Konsole({ namespace: 'B', format: 'silent' });
    const aSpy = vi.spyOn(a, 'setTimestamp');
    const bSpy = vi.spyOn(b, 'setTimestamp');

    Konsole.exposeToWindow();
    const handle = (window as unknown as {
      __Konsole: { setTimestamp: (fmt: 'iso') => void };
    }).__Konsole;
    handle.setTimestamp('iso');

    expect(aSpy).toHaveBeenCalledWith('iso');
    expect(bSpy).toHaveBeenCalledWith('iso');
  });

  it('getLogger().setLevel changes the level on the underlying instance', () => {
    const logger = new Konsole({ namespace: 'LvlTest', format: 'silent', level: 'trace' });
    Konsole.exposeToWindow();
    const handle = (window as unknown as {
      __Konsole: { getLogger: (ns: string) => { setLevel: (lvl: 'warn') => void } };
    }).__Konsole;

    handle.getLogger('LvlTest').setLevel('warn');
    expect(logger.level).toBe('warn');
    expect(logger.isLevelEnabled('info')).toBe(false);
    expect(logger.isLevelEnabled('warn')).toBe(true);
  });

  it('exposeToWindow is a no-op when window is missing (sanity branch)', () => {
    // happy-dom always defines window; the no-op branch is a runtime guard
    // for non-browser environments. We only assert the call doesn't throw.
    expect(() => Konsole.exposeToWindow()).not.toThrow();
  });
});
