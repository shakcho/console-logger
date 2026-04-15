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

  it('does not stack-overflow on a self-referencing cause', () => {
    const err = new Error('self') as Error & { cause?: unknown };
    err.cause = err;
    const out = serializeError(err) as Record<string, unknown>;
    expect(out.message).toBe('self');
    expect(out.cause).toBe('[Circular]');
  });

  it('does not stack-overflow on a two-node cause cycle', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    const out = serializeError(a) as Record<string, unknown>;
    const cause = out.cause as Record<string, unknown>;
    expect(cause.message).toBe('b');
    expect(cause.cause).toBe('[Circular]');
  });

  it('guards cyclic custom enumerable properties on an Error', () => {
    const err = new Error('boom') as Error & { self?: unknown };
    err.self = err;
    const out = serializeError(err) as Record<string, unknown>;
    expect(out.message).toBe('boom');
    expect(out.self).toBe('[Circular]');
    // The returned object must survive JSON.stringify.
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('guards deeply nested cyclic objects inside custom error props', () => {
    const node: Record<string, unknown> = { name: 'n' };
    node.parent = node;
    const err = new Error('wrap') as Error & { ctx?: unknown };
    err.ctx = { deep: node };
    const out = serializeError(err);
    expect(() => JSON.stringify(out)).not.toThrow();
    const serialized = JSON.stringify(out);
    expect(serialized).toContain('[Circular]');
    expect(serialized).toContain('wrap');
  });

  it('preserves repeated non-cyclic references across sibling branches', () => {
    // A shared object referenced from two sibling props is NOT a cycle and
    // must not be collapsed to [Circular].
    const shared = { id: 1, label: 'shared' };
    const err = new Error('wrap') as Error & { a?: unknown; b?: unknown };
    err.a = { child: shared };
    err.b = { child: shared };
    const out = serializeError(err) as Record<string, Record<string, Record<string, unknown>>>;
    expect(out.a.child).toEqual({ id: 1, label: 'shared' });
    expect(out.b.child).toEqual({ id: 1, label: 'shared' });
  });

  it('preserves repeated non-cyclic Error references across sibling branches', () => {
    const inner = new Error('inner');
    const err = new Error('outer') as Error & { a?: unknown; b?: unknown };
    err.a = inner;
    err.b = inner;
    const out = serializeError(err) as Record<string, Record<string, string>>;
    expect(out.a.message).toBe('inner');
    expect(out.b.message).toBe('inner');
    expect(out.a.type).toBe('Error');
    expect(out.b.type).toBe('Error');
  });

  it('preserves toJSON-based values (URL, Buffer) on custom error props', () => {
    const err = new Error('bad fetch') as Error & { url?: URL; payload?: Buffer };
    err.url = new URL('https://api.example.com/v1/users?id=1');
    err.payload = Buffer.from('hello');
    const out = serializeError(err);
    const json = JSON.stringify(out);
    expect(json).toContain('https://api.example.com/v1/users?id=1');
    // Buffer.toJSON() → { type: 'Buffer', data: [...] }
    expect(json).toContain('"type":"Buffer"');
    // Regression: must not serialize as empty object.
    expect(json).not.toContain('"url":{}');
  });

  it('preserves own __proto__ keys on nested custom error props', () => {
    const payload = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    const err = new Error('parse') as Error & { body?: unknown };
    err.body = payload;
    const out = serializeError(err) as Record<string, Record<string, Record<string, unknown>>>;
    // Sanity: the source payload really does have an own __proto__ key.
    expect(Object.prototype.hasOwnProperty.call(payload, '__proto__')).toBe(true);
    const body = out.body as Record<string, unknown>;
    expect(body.ok).toBe(1);
    // The own __proto__ data key must survive and show up in JSON output.
    const json = JSON.stringify(out);
    expect(json).toContain('"__proto__"');
    expect(json).toContain('"polluted":true');
    // And it must not have polluted Object.prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('handles a RegExp with a cyclic custom property without throwing', () => {
    const re = /abc/gi as RegExp & { self?: unknown };
    re.self = re;
    const err = new Error('bad re') as Error & { re?: RegExp };
    err.re = re;
    const out = serializeError(err);
    expect(() => JSON.stringify(out)).not.toThrow();
    const json = JSON.stringify(out);
    expect(json).toContain('"source":"abc"');
    expect(json).toContain('"flags":"gi"');
    expect(json).toContain('[Circular]');
  });

  it('emits plain RegExps as their canonical /pattern/flags form', () => {
    const err = new Error('re') as Error & { re?: RegExp };
    err.re = /foo/g;
    const out = serializeError(err) as Record<string, unknown>;
    expect(out.re).toBe('/foo/g');
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

  it('flattens a Headers subclass (interface, not constructor name)', () => {
    class MyHeaders extends Headers {}
    const headers = new MyHeaders({ 'x-custom': 'sub' });
    // Sanity: subclass must not have constructor.name === 'Headers'.
    expect(headers.constructor.name).toBe('MyHeaders');
    const out = serializeRequest({ method: 'GET', url: '/', headers }) as { headers: Record<string, string> };
    expect(out.headers['x-custom']).toBe('sub');
    expect(JSON.stringify(out)).toContain('sub');
  });

  it('flattens a Map-like header container via forEach', () => {
    const headers = new Map<string, string>([
      ['authorization', 'Bearer t'],
      ['x-trace', 'abc'],
    ]);
    const out = serializeRequest({ method: 'GET', url: '/', headers }) as { headers: Record<string, string> };
    expect(out.headers.authorization).toBe('Bearer t');
    expect(out.headers['x-trace']).toBe('abc');
  });

  it('preserves a header literally named __proto__ via the forEach branch', () => {
    const headers = new Map<string, string>([
      ['__proto__', 'not-a-setter'],
      ['x-normal', 'ok'],
    ]);
    const out = serializeRequest({ method: 'GET', url: '/', headers }) as { headers: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(out.headers, '__proto__')).toBe(true);
    expect((out.headers as Record<string, string>)['__proto__']).toBe('not-a-setter');
    expect(JSON.stringify(out)).toContain('"__proto__":"not-a-setter"');
    // Must not have mutated the flattened object's prototype.
    expect(Object.getPrototypeOf(out.headers)).toBe(null);
  });

  it('preserves a header literally named __proto__ via the entries branch', () => {
    // A container that has no forEach, only entries() — forces the fallback.
    const headers = {
      entries() {
        return [['__proto__', 'e-setter'], ['x-trace', 'abc']][Symbol.iterator]();
      },
    };
    const out = serializeRequest({ method: 'GET', url: '/', headers }) as { headers: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(out.headers, '__proto__')).toBe(true);
    expect((out.headers as Record<string, string>)['__proto__']).toBe('e-setter');
    expect(JSON.stringify(out)).toContain('"__proto__":"e-setter"');
  });

  it('flattens a Fetch Headers instance into a plain object', () => {
    const headers = new Headers({ 'content-type': 'application/json', 'x-trace': 'abc' });
    const out = serializeRequest({ method: 'POST', url: '/x', headers }) as { headers: Record<string, string> };
    expect(out.headers['content-type']).toBe('application/json');
    expect(out.headers['x-trace']).toBe('abc');
    // Must not serialize to an empty object downstream.
    expect(JSON.stringify(out)).toContain('application/json');
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

  it('ignores inherited Object.prototype keys on the serializer map', () => {
    // A parsed JSON payload with a top-level `hasOwnProperty` field must not
    // trigger Object.prototype.hasOwnProperty as a serializer.
    const fields: Record<string, unknown> = { hasOwnProperty: 'a string value', toString: 42 };
    const out = applySerializers(fields, {});
    expect(out.hasOwnProperty).toBe('a string value');
    expect(out.toString).toBe(42);
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
