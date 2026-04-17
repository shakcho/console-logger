import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isNamespaceEnabled, hasDebugFilter, _resetDebugFilter } from '../debugFilter';
import { Konsole } from '../Konsole';
import type { Transport, LogEntry } from '../types';

// ─── SpyTransport ─────────────────────────────────────────────────────────────

class SpyTransport implements Transport {
  readonly name = 'spy';
  entries: LogEntry[] = [];
  write(entry: LogEntry): void { this.entries.push(entry); }
  async destroy(): Promise<void> { this.entries = []; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const originalDebug = process.env.DEBUG;

function setDebug(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.DEBUG;
  } else {
    process.env.DEBUG = value;
  }
  _resetDebugFilter();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('debugFilter', () => {
  beforeEach(() => {
    _resetDebugFilter();
  });

  afterEach(() => {
    // Restore original DEBUG env var
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
    _resetDebugFilter();
  });

  describe('isNamespaceEnabled', () => {
    it('returns true for all namespaces when DEBUG is not set', () => {
      setDebug(undefined);
      expect(isNamespaceEnabled('anything')).toBe(true);
      expect(isNamespaceEnabled('App:http')).toBe(true);
    });

    it('returns true for all namespaces when DEBUG is empty string', () => {
      setDebug('');
      expect(isNamespaceEnabled('anything')).toBe(true);
    });

    it('DEBUG=* enables all namespaces', () => {
      setDebug('*');
      expect(isNamespaceEnabled('App')).toBe(true);
      expect(isNamespaceEnabled('App:http')).toBe(true);
      expect(isNamespaceEnabled('other')).toBe(true);
    });

    it('exact match — only specified namespace enabled', () => {
      setDebug('App:http');
      expect(isNamespaceEnabled('App:http')).toBe(true);
      expect(isNamespaceEnabled('App:db')).toBe(false);
      expect(isNamespaceEnabled('App')).toBe(false);
    });

    it('comma-separated matches', () => {
      setDebug('App:http,App:db');
      expect(isNamespaceEnabled('App:http')).toBe(true);
      expect(isNamespaceEnabled('App:db')).toBe(true);
      expect(isNamespaceEnabled('App:auth')).toBe(false);
    });

    it('wildcard matching', () => {
      setDebug('App:*');
      expect(isNamespaceEnabled('App:http')).toBe(true);
      expect(isNamespaceEnabled('App:db')).toBe(true);
      expect(isNamespaceEnabled('App:')).toBe(true);
      expect(isNamespaceEnabled('Other:http')).toBe(false);
      expect(isNamespaceEnabled('App')).toBe(false); // no colon, doesn't match "App:*"
    });

    it('negation — disable specific namespaces', () => {
      setDebug('*,-App:verbose');
      expect(isNamespaceEnabled('App:http')).toBe(true);
      expect(isNamespaceEnabled('App:verbose')).toBe(false);
      expect(isNamespaceEnabled('Other')).toBe(true);
    });

    it('negation with wildcard', () => {
      setDebug('*,-App:internal:*');
      expect(isNamespaceEnabled('App:http')).toBe(true);
      expect(isNamespaceEnabled('App:internal:debug')).toBe(false);
      expect(isNamespaceEnabled('App:internal:trace')).toBe(false);
    });

    it('disabled patterns take precedence over enabled', () => {
      setDebug('App:*,-App:secret');
      expect(isNamespaceEnabled('App:http')).toBe(true);
      expect(isNamespaceEnabled('App:secret')).toBe(false);
    });

    it('space-separated patterns work', () => {
      setDebug('App:http App:db');
      expect(isNamespaceEnabled('App:http')).toBe(true);
      expect(isNamespaceEnabled('App:db')).toBe(true);
      expect(isNamespaceEnabled('App:auth')).toBe(false);
    });
  });

  describe('hasDebugFilter', () => {
    it('returns false when DEBUG is not set', () => {
      setDebug(undefined);
      expect(hasDebugFilter()).toBe(false);
    });

    it('returns true when DEBUG is set', () => {
      setDebug('App:*');
      expect(hasDebugFilter()).toBe(true);
    });

    it('returns true for negation-only patterns', () => {
      setDebug('-App:verbose');
      expect(hasDebugFilter()).toBe(true);
    });
  });
});

describe('Konsole + DEBUG integration', () => {
  const originalDebug = process.env.DEBUG;

  afterEach(async () => {
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
    _resetDebugFilter();

    // Clean up static registry
    const ns = Konsole.getNamespaces();
    for (const n of ns) {
      await Konsole.getLogger(n).destroy();
    }
  });

  it('silences loggers whose namespace does not match DEBUG', () => {
    setDebug('App:http');
    const spy = new SpyTransport();
    const logger = new Konsole({
      namespace: 'App:db',
      format: 'silent',
      buffer: true,
      transports: [spy],
    });

    logger.info('should be silenced');
    // Silenced loggers with noop methods don't reach transports or buffer
    expect(spy.entries).toHaveLength(0);
  });

  it('enables loggers whose namespace matches DEBUG', () => {
    setDebug('App:http');
    const spy = new SpyTransport();
    const logger = new Konsole({
      namespace: 'App:http',
      format: 'silent',
      buffer: true,
      transports: [spy],
    });

    logger.info('should pass');
    expect(spy.entries).toHaveLength(1);
  });

  it('wildcard DEBUG enables all matching namespaces', () => {
    setDebug('App:*');
    const spy1 = new SpyTransport();
    const spy2 = new SpyTransport();
    const l1 = new Konsole({ namespace: 'App:http', format: 'silent', buffer: true, transports: [spy1] });
    const l2 = new Konsole({ namespace: 'App:db', format: 'silent', buffer: true, transports: [spy2] });

    l1.info('http log');
    l2.info('db log');
    expect(spy1.entries).toHaveLength(1);
    expect(spy2.entries).toHaveLength(1);
  });

  it('child with overridden namespace respects DEBUG filter', () => {
    setDebug('App:http');
    const spy = new SpyTransport();
    const parent = new Konsole({
      namespace: 'App:http',
      format: 'silent',
      buffer: true,
      transports: [spy],
    });

    const enabledChild = parent.child({}, { namespace: 'App:http' });
    const silencedChild = parent.child({}, { namespace: 'App:db' });

    enabledChild.info('visible');
    silencedChild.info('silenced');

    // Only the enabled child's entry should appear
    expect(spy.entries).toHaveLength(1);
    expect(spy.entries[0].namespace).toBe('App:http');
  });
});
