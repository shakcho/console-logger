import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Konsole } from '../Konsole';
import type { LogEntry, Transport } from '../types';

// ─── SpyTransport ─────────────────────────────────────────────────────────────

class SpyTransport implements Transport {
  readonly name = 'spy';
  entries: LogEntry[] = [];
  write(entry: LogEntry): void { this.entries.push(entry); }
  async destroy(): Promise<void> { this.entries = []; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSilentLogger(overrides: ConstructorParameters<typeof Konsole>[0] = {}): Konsole {
  return new Konsole({ namespace: 'Test', format: 'silent', buffer: true, ...overrides });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Konsole', () => {
  afterEach(async () => {
    // Clean up static registry between tests
    const ns = Konsole.getNamespaces();
    for (const n of ns) {
      await Konsole.getLogger(n).destroy();
    }
  });

  describe('construction', () => {
    it('registers itself in the instance map', () => {
      makeSilentLogger({ namespace: 'CtorTest' });
      expect(Konsole.getNamespaces()).toContain('CtorTest');
    });

    it('returns the same instance via getLogger', () => {
      const l = makeSilentLogger({ namespace: 'GetLoggerTest' });
      expect(Konsole.getLogger('GetLoggerTest')).toBe(l);
    });

    it('warns and creates a new logger when namespace not found', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const l = Konsole.getLogger('DoesNotExist__' + Math.random());
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(l).toBeInstanceOf(Konsole);
      warnSpy.mockRestore();
    });
  });

  describe('level filtering', () => {
    it('discards entries below the minimum level', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ level: 'warn', transports: [spy] });

      logger.trace('ignored');
      logger.debug('ignored');
      logger.info('ignored');
      expect(spy.entries).toHaveLength(0);
    });

    it('passes entries at or above the minimum level', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ level: 'warn', transports: [spy] });

      logger.warn('should pass');
      logger.error('should pass');
      logger.fatal('should pass');
      expect(spy.entries).toHaveLength(3);
    });

    it('setLevel changes the filter at runtime', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ level: 'error', transports: [spy] });

      logger.info('before — filtered');
      expect(spy.entries).toHaveLength(0);

      logger.setLevel('info');
      logger.info('after — passes');
      expect(spy.entries).toHaveLength(1);
    });
  });

  describe('log methods', () => {
    it('all seven methods produce entries with the right level', async () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ transports: [spy] });

      logger.trace('t');
      logger.debug('d');
      logger.info('i');
      logger.log('l');   // alias for info
      logger.warn('w');
      logger.error('e');
      logger.fatal('f');

      const levels = spy.entries.map((e) => e.level);
      expect(levels).toEqual(['trace', 'debug', 'info', 'info', 'warn', 'error', 'fatal']);
    });

    it('populates levelValue correctly', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ transports: [spy] });
      logger.error('boom');
      expect(spy.entries[0].levelValue).toBe(50);
    });

    it('sets the namespace on every entry', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ namespace: 'NS', transports: [spy] });
      logger.info('hi');
      expect(spy.entries[0].namespace).toBe('NS');
    });
  });

  describe('parseArgs calling conventions', () => {
    let spy: SpyTransport;
    let logger: Konsole;

    beforeEach(() => {
      spy = new SpyTransport();
      logger = makeSilentLogger({ transports: [spy] });
    });

    it('string only → msg set, no fields', () => {
      logger.info('hello');
      expect(spy.entries[0].msg).toBe('hello');
      expect(spy.entries[0].fields).toEqual({});
    });

    it('string + fields object → msg and fields', () => {
      logger.info('request', { userId: 1, path: '/home' });
      expect(spy.entries[0].msg).toBe('request');
      expect(spy.entries[0].fields).toMatchObject({ userId: 1, path: '/home' });
    });

    it('Pino-style object with msg key → extracts msg and spreads rest', () => {
      logger.info({ msg: 'pino', port: 3000 });
      expect(spy.entries[0].msg).toBe('pino');
      expect(spy.entries[0].fields).toMatchObject({ port: 3000 });
    });

    it('Error as first arg → msg = error.message, fields.err = serialized error', () => {
      const err = new Error('something broke');
      logger.error(err);
      expect(spy.entries[0].msg).toBe('something broke');
      expect(spy.entries[0].fields.err).toMatchObject({
        type: 'Error',
        message: 'something broke',
      });
      expect((spy.entries[0].fields.err as { stack: string }).stack).toContain('something broke');
    });

    it('multiple string args → joined into msg', () => {
      logger.info('a', 'b', 'c');
      expect(spy.entries[0].msg).toBe('a b c');
    });
  });

  describe('getLogs / clearLogs', () => {
    it('getLogs returns all stored entries', () => {
      const logger = makeSilentLogger();
      logger.info('one');
      logger.info('two');
      expect(logger.getLogs()).toHaveLength(2);
    });

    it('clearLogs empties the buffer', () => {
      const logger = makeSilentLogger();
      logger.info('to be cleared');
      logger.clearLogs();
      expect(logger.getLogs()).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('reports logCount and maxLogs', () => {
      const logger = makeSilentLogger({ maxLogs: 500 });
      logger.info('a');
      logger.info('b');
      const stats = logger.getStats();
      expect(stats.logCount).toBe(2);
      expect(stats.maxLogs).toBe(500);
      expect(stats.memoryUsage).toBe('2/500 (0.4%)');
    });
  });

  describe('criteria (deprecated filter)', () => {
    it('boolean false suppresses output but still stores in buffer', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const logger = new Konsole({ namespace: 'CriteriaTest', criteria: false, buffer: true });

      logger.info('silent');
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(logger.getLogs()).toHaveLength(1);
      stdoutSpy.mockRestore();
    });

    it('function criteria acts as additional output filter', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({
        namespace: 'FnCriteriaTest',
        transports: [spy],
      });
      // criteria is separate from transport routing — transports always get all entries
      // but output goes through criteria
      logger.setCriteria((e) => e.level === 'error');
      logger.info('filtered from output');
      logger.error('passes criteria');
      // Both are stored and forwarded to transports (transports ignore criteria)
      expect(spy.entries).toHaveLength(2);
      expect(logger.getLogs()).toHaveLength(2);
    });
  });

  describe('addTransport', () => {
    it('forwards entries to a dynamically added transport', () => {
      const logger = makeSilentLogger();
      const spy = new SpyTransport();
      logger.addTransport(spy);
      logger.info('dynamic');
      expect(spy.entries).toHaveLength(1);
      expect(spy.entries[0].msg).toBe('dynamic');
    });
  });

  describe('destroy', () => {
    it('removes the logger from the registry', async () => {
      const logger = makeSilentLogger({ namespace: 'DestroyTest' });
      expect(Konsole.getNamespaces()).toContain('DestroyTest');
      await logger.destroy();
      expect(Konsole.getNamespaces()).not.toContain('DestroyTest');
    });
  });

  describe('child loggers', () => {
    it('inherits parent namespace by default', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ namespace: 'Parent', transports: [spy] });
      const child = parent.child({ component: 'db' });
      child.info('query');
      expect(spy.entries[0].namespace).toBe('Parent');
    });

    it('accepts a namespace override', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ namespace: 'App', transports: [spy] });
      const child = parent.child({}, { namespace: 'App:Auth' });
      child.info('login');
      expect(spy.entries[0].namespace).toBe('App:Auth');
    });

    it('merges bindings into every entry', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ transports: [spy] });
      const child = parent.child({ requestId: 'abc', ip: '1.2.3.4' });
      child.info('request started', { path: '/users' });

      const fields = spy.entries[0].fields;
      expect(fields.requestId).toBe('abc');
      expect(fields.ip).toBe('1.2.3.4');
      expect(fields.path).toBe('/users');
    });

    it('call-site fields override bindings on key collision', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ transports: [spy] });
      const child = parent.child({ key: 'from-binding' });
      child.info('msg', { key: 'from-call-site' });
      expect(spy.entries[0].fields.key).toBe('from-call-site');
    });

    it('accumulates bindings through nested children', () => {
      const spy = new SpyTransport();
      const root  = makeSilentLogger({ transports: [spy] });
      const mid   = root.child({ requestId: 'r1' });
      const leaf  = mid.child({ component: 'db' });
      leaf.debug('query', { sql: 'SELECT 1' });

      const fields = spy.entries[0].fields;
      expect(fields.requestId).toBe('r1');
      expect(fields.component).toBe('db');
      expect(fields.sql).toBe('SELECT 1');
    });

    it('child level override restricts output', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ level: 'trace', transports: [spy] });
      const child = parent.child({}, { level: 'error' });

      child.info('filtered');
      expect(spy.entries).toHaveLength(0);
      child.error('passes');
      expect(spy.entries).toHaveLength(1);
    });

    it('child addTransport does not affect parent', () => {
      const parentSpy = new SpyTransport();
      const childSpy  = new SpyTransport();
      const parent = makeSilentLogger({ transports: [parentSpy] });
      const child  = parent.child({});
      child.addTransport(childSpy);

      parent.info('parent only');
      child.info('child only');

      // parentSpy sees both (child shares parent's transports array copy at creation)
      // but childSpy only sees child's entry
      expect(childSpy.entries).toHaveLength(1);
      expect(childSpy.entries[0].msg).toBe('child only');

      // parentSpy.entries should only have 'parent only' + 'child only'
      // because child copies the parent transport array at creation time
      expect(parentSpy.entries.some((e) => e.msg === 'parent only')).toBe(true);
    });

    it('child is NOT registered in Konsole.instances', () => {
      const parent = makeSilentLogger({ namespace: 'ChildParent' });
      parent.child({ x: 1 });
      // Only 'ChildParent' should be in the registry, not 'ChildParent' with child bindings
      expect(Konsole.getNamespaces().filter((n) => n === 'ChildParent')).toHaveLength(1);
    });

    it('child shares the parent buffer', () => {
      const parent = makeSilentLogger({ namespace: 'SharedBuf' });
      const child = parent.child({ tag: 'c' });
      parent.info('from parent');
      child.info('from child');
      // getLogs on parent should include both entries
      expect(parent.getLogs()).toHaveLength(2);
    });
  });

  describe('enableGlobalPrint', () => {
    afterEach(() => {
      Konsole.enableGlobalPrint(false); // reset after each test
    });

    it('forces output when set to true (bypasses criteria: false)', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const logger = new Konsole({
        namespace: 'GlobalPrintTest',
        criteria: false,
        format: 'json',
      });

      Konsole.enableGlobalPrint(true);
      logger.info('forced out');
      expect(stdoutSpy).toHaveBeenCalledOnce();
      stdoutSpy.mockRestore();
    });
  });

  describe('timestamp configuration', () => {
    it('passes timestamp format to the formatter via constructor', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const logger = new Konsole({
        namespace: 'TsCtorTest',
        format: 'json',
        timestamp: 'unixMs',
      });
      logger.info('hello');
      const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]).trim());
      // unixMs should be a numeric string
      expect(parsed.time).toMatch(/^\d+$/);
      writeSpy.mockRestore();
    });

    it('setTimestamp changes the format at runtime', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const logger = new Konsole({
        namespace: 'TsRuntimeTest',
        format: 'json',
        timestamp: 'iso',
      });

      logger.info('before');
      const before = JSON.parse(String(writeSpy.mock.calls[0][0]).trim());
      expect(before.time).toMatch(/T.*Z$/); // ISO format

      logger.setTimestamp('unixMs');
      logger.info('after');
      const after = JSON.parse(String(writeSpy.mock.calls[1][0]).trim());
      expect(after.time).toMatch(/^\d+$/); // epoch ms

      writeSpy.mockRestore();
    });

    it('highResolution populates hrTime on log entries', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({
        namespace: 'HrTest',
        timestamp: { highResolution: true },
        transports: [spy],
      });

      logger.info('with hrTime');
      expect(spy.entries[0].hrTime).toBeTypeOf('number');
      expect(spy.entries[0].hrTime).toBeGreaterThan(0);
    });

    it('hrTime is undefined when highResolution is false (default)', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({
        namespace: 'NoHrTest',
        transports: [spy],
      });

      logger.info('no hrTime');
      expect(spy.entries[0].hrTime).toBeUndefined();
    });

    it('setTimestamp enables highResolution at runtime', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({
        namespace: 'HrRuntimeTest',
        transports: [spy],
      });

      logger.info('before');
      expect(spy.entries[0].hrTime).toBeUndefined();

      logger.setTimestamp({ format: 'datetime', highResolution: true });
      logger.info('after');
      expect(spy.entries[1].hrTime).toBeTypeOf('number');
    });

    it('child inherits parent timestamp config', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const parent = new Konsole({
        namespace: 'TsChildParent',
        format: 'json',
        timestamp: 'unixMs',
      });
      const child = parent.child({ tag: 'c' });
      child.info('from child');
      const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]).trim());
      expect(parsed.time).toMatch(/^\d+$/);
      writeSpy.mockRestore();
    });

    it('child can override timestamp format', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const parent = new Konsole({
        namespace: 'TsChildOverride',
        format: 'json',
        timestamp: 'unixMs',
      });
      const child = parent.child({}, { timestamp: 'iso' });

      child.info('iso child');
      const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]).trim());
      expect(parsed.time).toMatch(/T.*Z$/);
      writeSpy.mockRestore();
    });

    it('custom function timestamp works end-to-end', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const logger = new Konsole({
        namespace: 'TsCustomTest',
        format: 'json',
        timestamp: (d) => `epoch:${d.getTime()}`,
      });
      logger.info('custom');
      const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]).trim());
      expect(parsed.time).toMatch(/^epoch:\d+$/);
      writeSpy.mockRestore();
    });
  });

  // ─── Redaction ───────────────────────────────────────────────────────────────

  describe('redact', () => {
    it('redacts a top-level field before transport write', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ namespace: 'RedactTest1', transports: [spy], redact: ['password'] });
      logger.info('login', { user: 'alice', password: 'hunter2' });
      expect(spy.entries[0].fields.password).toBe('[REDACTED]');
      expect(spy.entries[0].fields.user).toBe('alice');
    });

    it('redacts a nested field', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ namespace: 'RedactTest2', transports: [spy], redact: ['req.headers.authorization'] });
      logger.info('request', { req: { headers: { authorization: 'Bearer tok', 'content-type': 'application/json' } } });
      const headers = (spy.entries[0].fields.req as Record<string, unknown>).headers as Record<string, unknown>;
      expect(headers.authorization).toBe('[REDACTED]');
      expect(headers['content-type']).toBe('application/json');
    });

    it('stores redacted entry in the buffer', () => {
      const logger = makeSilentLogger({ namespace: 'RedactTest3', redact: ['token'] });
      logger.info('event', { token: 'abc', id: 1 });
      const [entry] = logger.getLogs();
      expect(entry.fields.token).toBe('[REDACTED]');
      expect(entry.fields.id).toBe(1);
    });

    it('does not mutate the caller fields object', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ namespace: 'RedactTest4', transports: [spy], redact: ['token'] });
      const callFields = { token: 'abc', id: 1 };
      logger.info('api call', callFields);
      expect(callFields.token).toBe('abc');
    });

    it('does nothing when the redacted path does not exist on the entry', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ namespace: 'RedactTest5', transports: [spy], redact: ['password'] });
      logger.info('event', { user: 'alice' });
      expect(spy.entries[0].fields).toEqual({ user: 'alice' });
    });

    it('child inherits parent redact paths', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ namespace: 'RedactTest6', transports: [spy], redact: ['password'] });
      const child = parent.child({ service: 'auth' });
      child.info('login', { user: 'bob', password: 'secret' });
      expect(spy.entries[0].fields.password).toBe('[REDACTED]');
      expect(spy.entries[0].fields.user).toBe('bob');
    });

    it('child can add additional redact paths on top of parent', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ namespace: 'RedactTest7', transports: [spy], redact: ['password'] });
      const child = parent.child({}, { redact: ['token'] });
      child.info('login', { user: 'bob', password: 'secret', token: 'abc' });
      expect(spy.entries[0].fields.password).toBe('[REDACTED]');
      expect(spy.entries[0].fields.token).toBe('[REDACTED]');
      expect(spy.entries[0].fields.user).toBe('bob');
    });

    it('parent is not affected by child redact paths', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ namespace: 'RedactTest8', transports: [spy], redact: ['password'] });
      parent.child({}, { redact: ['token'] });
      parent.info('login', { password: 'secret', token: 'abc' });
      expect(spy.entries[0].fields.password).toBe('[REDACTED]');
      expect(spy.entries[0].fields.token).toBe('abc'); // parent does not redact token
    });

    it('redact path through a binding field works', () => {
      const spy = new SpyTransport();
      const parent = makeSilentLogger({ namespace: 'RedactTest9', transports: [spy], redact: ['apiKey'] });
      const child = parent.child({ apiKey: 'supersecret', service: 'payments' });
      child.info('charge');
      expect(spy.entries[0].fields.apiKey).toBe('[REDACTED]');
      expect(spy.entries[0].fields.service).toBe('payments');
    });

    it('empty redact array behaves identically to omitting the option', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ namespace: 'RedactTest10', transports: [spy], redact: [] });
      logger.info('event', { password: 'secret' });
      expect(spy.entries[0].fields.password).toBe('secret');
    });

    it('redacted output does not contain the sensitive value in JSON format', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const logger = new Konsole({ namespace: 'RedactTest11', format: 'json', redact: ['password'] });
      logger.info('login', { user: 'alice', password: 'hunter2' });
      const output = String(writeSpy.mock.calls[0][0]);
      const parsed = JSON.parse(output.trim());
      expect(parsed.password).toBe('[REDACTED]');
      expect(output).not.toContain('hunter2');
      writeSpy.mockRestore();
    });

    it('_redactionDisabled flag bypasses redaction when set', () => {
      const spy = new SpyTransport();
      const logger = makeSilentLogger({ namespace: 'RedactTest12', transports: [spy], redact: ['password'] });

      // Simulate what window.__Konsole.disableRedaction(true) does
      (Konsole as unknown as Record<string, unknown>)['_redactionDisabled'] = true;
      logger.info('login', { password: 'hunter2' });
      expect(spy.entries[0].fields.password).toBe('hunter2'); // raw value visible

      // Restore
      (Konsole as unknown as Record<string, unknown>)['_redactionDisabled'] = false;
      spy.entries = [];
      logger.info('login', { password: 'hunter2' });
      expect(spy.entries[0].fields.password).toBe('[REDACTED]'); // redaction back on
    });
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────────────────

  describe('shutdown', () => {
    it('flushes and destroys all registered loggers', async () => {
      const spy1 = new SpyTransport();
      const spy2 = new SpyTransport();
      const l1 = makeSilentLogger({ namespace: 'Shutdown1', transports: [spy1] });
      const l2 = makeSilentLogger({ namespace: 'Shutdown2', transports: [spy2] });

      l1.info('a');
      l2.info('b');

      expect(Konsole.getNamespaces()).toContain('Shutdown1');
      expect(Konsole.getNamespaces()).toContain('Shutdown2');

      await Konsole.shutdown();

      // Both loggers should be deregistered
      expect(Konsole.getNamespaces()).not.toContain('Shutdown1');
      expect(Konsole.getNamespaces()).not.toContain('Shutdown2');
    });

    it('resolves cleanly when there are no registered loggers', async () => {
      // After the afterEach cleanup there should be no loggers
      await expect(Konsole.shutdown()).resolves.toBeUndefined();
    });

    it('enableShutdownHook does not throw in Node.js', () => {
      expect(() => Konsole.enableShutdownHook()).not.toThrow();
      // Reset the flag so repeated test runs work
      (Konsole as unknown as Record<string, unknown>)['_hooksRegistered'] = false;
    });

    it('enableShutdownHook is idempotent', () => {
      const onSpy = vi.spyOn(process, 'on');
      Konsole.enableShutdownHook();
      const callCount = onSpy.mock.calls.length;
      Konsole.enableShutdownHook(); // second call — should be no-op
      expect(onSpy.mock.calls.length).toBe(callCount);
      onSpy.mockRestore();
      (Konsole as unknown as Record<string, unknown>)['_hooksRegistered'] = false;
    });
  });
});
