import { describe, it, expect } from 'vitest';
import {
  serializeError,
  serializeRequest,
  serializeResponse,
  applySerializers,
  stdSerializers,
} from '../serializers';
import { Konsole } from '../Konsole';
import type { LogEntry, Transport } from '../types';
import { JsonFormatter } from '../formatter';

class SpyTransport implements Transport {
  readonly name = 'spy';
  entries: LogEntry[] = [];
  write(e: LogEntry) { this.entries.push(e); }
  async destroy() {}
}

describe('serializeError', () => {
  it('flattens name, message, and stack', () => {
    const err = new TypeError('boom');
    const out = serializeError(err) as Record<string, string>;
    expect(out.type).toBe('TypeError');
    expect(out.message).toBe('boom');
    expect(out.stack).toContain('boom');
  });

  it('preserves own enumerable properties', () => {
    const err = new Error('oops') as Error & { code?: string; statusCode?: number };
    err.code = 'E_FOO';
    err.statusCode = 500;
    const out = serializeError(err) as Record<string, unknown>;
    expect(out.code).toBe('E_FOO');
    expect(out.statusCode).toBe(500);
  });

  it('recursively flattens cause chain', () => {
    const root = new Error('root cause');
    const wrapped = new Error('wrapped') as Error & { cause?: unknown };
    wrapped.cause = root;
    const out = serializeError(wrapped) as Record<string, unknown>;
    expect((out.cause as Record<string, string>).message).toBe('root cause');
    expect((out.cause as Record<string, string>).type).toBe('Error');
  });

  it('passes through non-Error values', () => {
    expect(serializeError('string')).toBe('string');
    expect(serializeError(42)).toBe(42);
    expect(serializeError(null)).toBe(null);
  });

  it('JSON.stringify of a raw Error yields "{}" — serializeError fixes it', () => {
    const err = new Error('visible');
    expect(JSON.stringify(err)).toBe('{}');
    expect(JSON.stringify(serializeError(err))).toContain('visible');
  });
});

describe('serializeRequest', () => {
  it('extracts standard HTTP req fields', () => {
    const req = {
      method: 'GET',
      url: '/api/users',
      headers: { 'x-trace': 'abc' },
      socket: { remoteAddress: '1.2.3.4', remotePort: 4242 },
    };
    expect(serializeRequest(req)).toEqual({
      method: 'GET',
      url: '/api/users',
      headers: { 'x-trace': 'abc' },
      remoteAddress: '1.2.3.4',
      remotePort: 4242,
    });
  });

  it('prefers originalUrl over url', () => {
    const out = serializeRequest({ method: 'GET', url: '/a', originalUrl: '/b' }) as { url: string };
    expect(out.url).toBe('/b');
  });
});

describe('serializeResponse', () => {
  it('extracts statusCode and headers', () => {
    expect(serializeResponse({ statusCode: 200, headers: { x: '1' } })).toEqual({
      statusCode: 200,
      headers: { x: '1' },
    });
  });

  it('falls back to getHeaders() when headers is absent', () => {
    const res = { statusCode: 201, getHeaders: () => ({ 'content-type': 'json' }) };
    expect(serializeResponse(res)).toEqual({
      statusCode: 201,
      headers: { 'content-type': 'json' },
    });
  });
});

describe('applySerializers', () => {
  it('returns the same reference when no serializer matches', () => {
    const fields = { a: 1, b: 2 };
    expect(applySerializers(fields, { err: serializeError })).toBe(fields);
  });

  it('auto-flattens Errors even without explicit serializer', () => {
    const err = new Error('inside');
    const out = applySerializers({ err }, {});
    expect(out).not.toBe({ err });
    expect((out.err as Record<string, string>).message).toBe('inside');
  });

  it('uses explicit serializer when provided', () => {
    const out = applySerializers(
      { user: { id: 1, secret: 'keep' } },
      { user: (u) => ({ id: (u as { id: number }).id }) },
    );
    expect(out.user).toEqual({ id: 1 });
  });
});

describe('Konsole integration', () => {
  it('flattens Error fields by default', () => {
    const spy = new SpyTransport();
    const logger = new Konsole({ namespace: 'T1', format: 'silent', transports: [spy] });
    logger.error('failed', { err: new Error('db timeout') });
    const f = spy.entries[0].fields as { err: Record<string, string> };
    expect(f.err.type).toBe('Error');
    expect(f.err.message).toBe('db timeout');
    expect(f.err.stack).toBeTruthy();
  });

  it('applies stdSerializers when provided', () => {
    const spy = new SpyTransport();
    const logger = new Konsole({
      namespace: 'T2',
      format: 'silent',
      transports: [spy],
      serializers: stdSerializers,
    });
    logger.info('req', {
      req: { method: 'POST', url: '/x', headers: {} },
      res: { statusCode: 204 },
    });
    expect(spy.entries[0].fields.req).toMatchObject({ method: 'POST', url: '/x' });
    expect(spy.entries[0].fields.res).toMatchObject({ statusCode: 204 });
  });

  it('child inherits parent serializers and can override them', () => {
    const spy = new SpyTransport();
    const parent = new Konsole({
      namespace: 'T3',
      format: 'silent',
      transports: [spy],
      serializers: { user: (u) => ({ id: (u as { id: number }).id }) },
    });
    const child = parent.child({}, { serializers: { user: (u) => ({ name: (u as { name: string }).name }) } });

    parent.info('p', { user: { id: 1, name: 'a' } });
    child.info('c', { user: { id: 2, name: 'b' } });

    expect(spy.entries[0].fields.user).toEqual({ id: 1 });
    expect(spy.entries[1].fields.user).toEqual({ name: 'b' });
  });

  it('JsonFormatter output contains expanded Error details (errors route to stderr)', () => {
    const fmt = new JsonFormatter();
    const errWrites: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => { errWrites.push(chunk); return true; }) as typeof process.stderr.write;
    try {
      fmt.write({
        msg: 'oops',
        messages: [],
        fields: { err: new Error('nested-fail') },
        timestamp: new Date('2024-01-01T00:00:00Z'),
        namespace: 'T',
        level: 'error',
        levelValue: 50,
      });
    } finally {
      process.stderr.write = origErr;
    }
    const line = errWrites.join('');
    expect(line).toContain('nested-fail');
    expect(line).toContain('"type":"Error"');
    expect(line).not.toMatch(/"err":\{\}/);
  });
});
