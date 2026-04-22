import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Konsole } from '../Konsole';
import { enableContext, runWithContext, getContext } from '../context';
import type { LogEntry, Transport } from '../types';

class SpyTransport implements Transport {
  readonly name = 'spy';
  entries: LogEntry[] = [];
  write(entry: LogEntry): void { this.entries.push(entry); }
  async destroy(): Promise<void> { this.entries = []; }
}

describe('AsyncLocalStorage context propagation', () => {
  beforeAll(async () => {
    await enableContext();
  });

  afterEach(async () => {
    for (const ns of Konsole.getNamespaces()) {
      await Konsole.getLogger(ns).destroy();
    }
  });

  it('merges ALS context into log entry fields', () => {
    const spy = new SpyTransport();
    const logger = new Konsole({ namespace: 'Ctx1', format: 'silent', buffer: false, transports: [spy] });

    runWithContext({ requestId: 'r1' }, () => {
      logger.info('hi');
    });

    expect(spy.entries).toHaveLength(1);
    expect(spy.entries[0].fields).toMatchObject({ requestId: 'r1' });
  });

  it('returns undefined from getContext outside any scope', () => {
    expect(getContext()).toBeUndefined();
  });

  it('exposes current store via getContext inside a scope', () => {
    runWithContext({ traceId: 't1' }, () => {
      expect(getContext()).toEqual({ traceId: 't1' });
    });
    expect(getContext()).toBeUndefined();
  });

  it('returns the result of the callback', () => {
    const result = runWithContext({ a: 1 }, () => 42);
    expect(result).toBe(42);
  });

  describe('precedence', () => {
    it('call-site fields override ALS context', () => {
      const spy = new SpyTransport();
      const logger = new Konsole({ namespace: 'Ctx2', format: 'silent', buffer: false, transports: [spy] });

      runWithContext({ requestId: 'ctx', shared: 'fromCtx' }, () => {
        logger.info('hi', { shared: 'fromCall' });
      });

      expect(spy.entries[0].fields).toEqual({ requestId: 'ctx', shared: 'fromCall' });
    });

    it('child bindings override ALS context', () => {
      const spy = new SpyTransport();
      const parent = new Konsole({ namespace: 'Ctx3', format: 'silent', buffer: false, transports: [spy] });
      const child = parent.child({ shared: 'fromBinding' });

      runWithContext({ shared: 'fromCtx', requestId: 'r' }, () => {
        child.info('hi');
      });

      expect(spy.entries[0].fields).toMatchObject({ shared: 'fromBinding', requestId: 'r' });
    });

    it('call-site fields still win over child bindings and ALS', () => {
      const spy = new SpyTransport();
      const parent = new Konsole({ namespace: 'Ctx4', format: 'silent', buffer: false, transports: [spy] });
      const child = parent.child({ shared: 'fromBinding' });

      runWithContext({ shared: 'fromCtx' }, () => {
        child.info('hi', { shared: 'fromCall' });
      });

      expect(spy.entries[0].fields.shared).toBe('fromCall');
    });
  });

  describe('nested scopes', () => {
    it('inner scope merges with outer context', () => {
      const spy = new SpyTransport();
      const logger = new Konsole({ namespace: 'Ctx5', format: 'silent', buffer: false, transports: [spy] });

      runWithContext({ requestId: 'r1' }, () => {
        runWithContext({ userId: 'u1' }, () => {
          logger.info('nested');
        });
      });

      expect(spy.entries[0].fields).toMatchObject({ requestId: 'r1', userId: 'u1' });
    });

    it('inner scope shadows outer keys', () => {
      const spy = new SpyTransport();
      const logger = new Konsole({ namespace: 'Ctx6', format: 'silent', buffer: false, transports: [spy] });

      runWithContext({ tier: 'outer' }, () => {
        runWithContext({ tier: 'inner' }, () => {
          logger.info('shadowed');
        });
        logger.info('back to outer');
      });

      expect(spy.entries[0].fields.tier).toBe('inner');
      expect(spy.entries[1].fields.tier).toBe('outer');
    });
  });

  describe('async propagation', () => {
    it('survives setTimeout', async () => {
      const spy = new SpyTransport();
      const logger = new Konsole({ namespace: 'Ctx7', format: 'silent', buffer: false, transports: [spy] });

      await new Promise<void>((resolve) => {
        runWithContext({ requestId: 'rTimer' }, () => {
          setTimeout(() => {
            logger.info('after timer');
            resolve();
          }, 5);
        });
      });

      expect(spy.entries[0].fields.requestId).toBe('rTimer');
    });

    it('survives await / Promise.then', async () => {
      const spy = new SpyTransport();
      const logger = new Konsole({ namespace: 'Ctx8', format: 'silent', buffer: false, transports: [spy] });

      await runWithContext({ requestId: 'rAwait' }, async () => {
        await Promise.resolve();
        logger.info('after await');
        await Promise.resolve().then(() => logger.info('after then'));
      });

      expect(spy.entries.map((e) => e.fields.requestId)).toEqual(['rAwait', 'rAwait']);
    });
  });

  describe('no-context baseline', () => {
    it('produces the same entry whether or not ALS is enabled, when no scope is active', () => {
      const spy = new SpyTransport();
      const logger = new Konsole({ namespace: 'Ctx9', format: 'silent', buffer: false, transports: [spy] });

      logger.info('plain');
      logger.info('with fields', { k: 'v' });

      expect(spy.entries[0].fields).toEqual({});
      expect(spy.entries[1].fields).toEqual({ k: 'v' });
    });
  });

  it('redaction applies to ALS-sourced fields', () => {
    const spy = new SpyTransport();
    const logger = new Konsole({
      namespace: 'Ctx10',
      format: 'silent',
      buffer: false,
      transports: [spy],
      redact: ['password'],
    });

    runWithContext({ password: 'hunter2', requestId: 'r' }, () => {
      logger.info('sensitive');
    });

    expect(spy.entries[0].fields.password).toBe('[REDACTED]');
    expect(spy.entries[0].fields.requestId).toBe('r');
  });

  it('child loggers inherit ALS context automatically', () => {
    const spy = new SpyTransport();
    const parent = new Konsole({ namespace: 'Ctx11', format: 'silent', buffer: false, transports: [spy] });
    const child = parent.child({ component: 'db' });

    runWithContext({ requestId: 'rChild' }, () => {
      child.info('from child');
    });

    expect(spy.entries[0].fields).toMatchObject({
      requestId: 'rChild',
      component: 'db',
    });
  });

  it('is accessible as static methods on Konsole', () => {
    expect(typeof Konsole.enableContext).toBe('function');
    expect(typeof Konsole.runWithContext).toBe('function');
    expect(typeof Konsole.getContext).toBe('function');

    const spy = new SpyTransport();
    const logger = new Konsole({ namespace: 'Ctx12', format: 'silent', buffer: false, transports: [spy] });

    Konsole.runWithContext({ via: 'static' }, () => {
      logger.info('static api');
    });

    expect(spy.entries[0].fields.via).toBe('static');
  });

  describe('exception safety', () => {
    it('propagates exceptions thrown inside the scope', () => {
      const err = new Error('boom');
      expect(() => runWithContext({ requestId: 'rErr' }, () => { throw err; })).toThrow(err);
    });

    it('clears the scope after a thrown exception', () => {
      try { runWithContext({ requestId: 'rErr' }, () => { throw new Error('boom'); }); }
      catch { /* swallow */ }
      expect(getContext()).toBeUndefined();
    });

    it('clears the scope after an async rejection', async () => {
      await expect(
        runWithContext({ requestId: 'rAsyncErr' }, async () => {
          await Promise.resolve();
          throw new Error('async boom');
        }),
      ).rejects.toThrow('async boom');
      expect(getContext()).toBeUndefined();
    });
  });

  describe('enableContext', () => {
    it('is idempotent — returns the same promise on repeated calls', () => {
      const a = enableContext();
      const b = enableContext();
      expect(a).toBe(b);
    });

    it('resolves on static Konsole.enableContext too', async () => {
      await expect(Konsole.enableContext()).resolves.toBeUndefined();
    });
  });

  describe('end-to-end output', () => {
    it('JSON formatter output contains ALS context fields', () => {
      const writes: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
        writes.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);

      const logger = new Konsole({ namespace: 'CtxJson', format: 'json' });

      runWithContext({ requestId: 'rJson', userId: 'u42' }, () => {
        logger.info('served');
      });

      stdoutSpy.mockRestore();

      const line = writes.find((w) => w.includes('served'));
      expect(line).toBeDefined();
      const parsed = JSON.parse(line!.trim());
      expect(parsed).toMatchObject({
        msg: 'served',
        requestId: 'rJson',
        userId: 'u42',
      });
    });
  });

  describe('serializer interaction', () => {
    it('applies serializers to ALS-sourced fields', () => {
      const spy = new SpyTransport();
      const logger = new Konsole({
        namespace: 'CtxSer',
        format: 'silent',
        buffer: false,
        transports: [spy],
        serializers: {
          user: (u) => ({ id: (u as { id: number; secret: string }).id }),
        },
      });

      runWithContext({ user: { id: 7, secret: 'shh' } }, () => {
        logger.info('hi');
      });

      expect(spy.entries[0].fields.user).toEqual({ id: 7 });
    });
  });

  describe('calling conventions with ALS', () => {
    it('merges ALS context with Pino-style object-first calls', () => {
      const spy = new SpyTransport();
      const logger = new Konsole({ namespace: 'CtxPino', format: 'silent', buffer: false, transports: [spy] });

      runWithContext({ requestId: 'rPino' }, () => {
        logger.info({ msg: 'object-first', k: 'v' });
      });

      expect(spy.entries[0]).toMatchObject({
        msg: 'object-first',
        fields: { requestId: 'rPino', k: 'v' },
      });
    });

    it('merges ALS context when logging an Error directly', () => {
      const spy = new SpyTransport();
      const logger = new Konsole({ namespace: 'CtxErr', format: 'silent', buffer: false, transports: [spy] });

      runWithContext({ requestId: 'rErrLog' }, () => {
        logger.error(new Error('db down'));
      });

      expect(spy.entries[0].msg).toBe('db down');
      expect(spy.entries[0].fields.requestId).toBe('rErrLog');
      expect(spy.entries[0].fields.err).toBeDefined();
    });
  });

  describe('level filtering', () => {
    it('does not emit entries below the logger level, even inside runWithContext', () => {
      const spy = new SpyTransport();
      const logger = new Konsole({
        namespace: 'CtxLvl',
        format: 'silent',
        buffer: false,
        transports: [spy],
        level: 'warn',
      });

      runWithContext({ requestId: 'rLvl' }, () => {
        logger.debug('skipped');
        logger.info('skipped');
        logger.warn('kept');
      });

      expect(spy.entries).toHaveLength(1);
      expect(spy.entries[0].msg).toBe('kept');
      expect(spy.entries[0].fields.requestId).toBe('rLvl');
    });
  });
});
