import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileTransport } from '../../transports/FileTransport';
import type { LogEntry } from '../../types';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    msg: 'file test',
    messages: ['file test'],
    fields: {},
    timestamp: new Date('2024-06-01T12:00:00.000Z'),
    namespace: 'Test',
    level: 'info',
    levelValue: 30,
    ...overrides,
  };
}

function tmpPath(): string {
  return path.join(os.tmpdir(), `konsole-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
}

describe('FileTransport', () => {
  const files: string[] = [];

  /** Track a file path for cleanup — also cleans rotated variants. */
  function track(filePath: string): string {
    files.push(filePath);
    return filePath;
  }

  afterEach(() => {
    for (const f of files) {
      // Clean up base file and rotated variants
      try { fs.unlinkSync(f); } catch { /* ignore */ }
      for (let i = 1; i <= 10; i++) {
        try { fs.unlinkSync(`${f}.${i}`); } catch { /* ignore */ }
        try { fs.unlinkSync(`${f}.${i}.gz`); } catch { /* ignore */ }
      }
    }
    files.length = 0;
  });

  it('writes JSON lines to a file', async () => {
    const filePath = track(tmpPath());

    const t = new FileTransport({ path: filePath });
    await t.ready();

    t.write(makeEntry({ msg: 'first', fields: { n: 1 } }));
    t.write(makeEntry({ msg: 'second' }));
    await t.destroy();

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.msg).toBe('first');
    expect(first.n).toBe(1);
    expect(first.levelName).toBe('info');

    const second = JSON.parse(lines[1]);
    expect(second.msg).toBe('second');
  });

  it('buffers entries written before the stream is ready', async () => {
    const filePath = track(tmpPath());

    const t = new FileTransport({ path: filePath });
    // Write immediately — stream is not yet open
    t.write(makeEntry({ msg: 'buffered' }));
    await t.ready(); // now wait for open
    await t.destroy();

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('"buffered"');
  });

  it('writes text format lines when format: text', async () => {
    const filePath = track(tmpPath());

    const t = new FileTransport({ path: filePath, format: 'text' });
    await t.ready();
    t.write(makeEntry({ msg: 'plain', level: 'warn' }));
    await t.destroy();

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('WRN');
    expect(content).toContain('plain');
    expect(content).not.toMatch(/^\{/m); // not JSON
  });

  it('appends to file by default (flags: a)', async () => {
    const filePath = track(tmpPath());

    const t1 = new FileTransport({ path: filePath });
    await t1.ready();
    t1.write(makeEntry({ msg: 'first run' }));
    await t1.destroy();

    const t2 = new FileTransport({ path: filePath });
    await t2.ready();
    t2.write(makeEntry({ msg: 'second run' }));
    await t2.destroy();

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('truncates file when flags: w', async () => {
    const filePath = track(tmpPath());

    const t1 = new FileTransport({ path: filePath });
    await t1.ready();
    t1.write(makeEntry({ msg: 'old' }));
    await t1.destroy();

    const t2 = new FileTransport({ path: filePath, flags: 'w' });
    await t2.ready();
    t2.write(makeEntry({ msg: 'new' }));
    await t2.destroy();

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).not.toContain('"old"');
    expect(content).toContain('"new"');
  });

  it('applies a filter — skips entries that fail predicate', async () => {
    const filePath = track(tmpPath());

    const t = new FileTransport({
      path: filePath,
      filter: (e) => e.level === 'error',
    });
    await t.ready();

    t.write(makeEntry({ level: 'info', msg: 'ignored' }));
    t.write(makeEntry({ level: 'error', msg: 'written' }));
    await t.destroy();

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).msg).toBe('written');
  });

  it('uses a custom name when provided', () => {
    const filePath = track(tmpPath());
    const t = new FileTransport({ path: filePath, name: 'my-log' });
    expect(t.name).toBe('my-log');
    void t.destroy();
  });

  it('defaults name to file:<path>', () => {
    const filePath = track(tmpPath());
    const t = new FileTransport({ path: filePath });
    expect(t.name).toBe(`file:${filePath}`);
    void t.destroy();
  });

  // ─── Rotation: size-based ──────────────────────────────────────────────────

  describe('rotation (size-based)', () => {
    it('rotates when file exceeds maxSize', async () => {
      const filePath = track(tmpPath());
      const t = new FileTransport({
        path: filePath,
        rotation: { maxSize: 200, maxFiles: 3 },
      });
      await t.ready();

      // Write enough data to trigger rotation
      for (let i = 0; i < 10; i++) {
        t.write(makeEntry({ msg: `entry-${i}`, fields: { padding: 'x'.repeat(30) } }));
      }

      // Wait for rotation to complete
      await new Promise((r) => setTimeout(r, 200));
      await t.destroy();

      // Current file should exist with some entries
      expect(fs.existsSync(filePath)).toBe(true);

      // At least one rotated file should exist
      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    });

    it('respects maxFiles — deletes oldest rotated files', async () => {
      const filePath = track(tmpPath());
      const t = new FileTransport({
        path: filePath,
        rotation: { maxSize: 150, maxFiles: 2 },
      });
      await t.ready();

      // Write many entries to trigger multiple rotations
      for (let i = 0; i < 30; i++) {
        t.write(makeEntry({ msg: `entry-${i}`, fields: { padding: 'x'.repeat(30) } }));
        // Small delay to allow rotation to process
        if (i % 5 === 4) await new Promise((r) => setTimeout(r, 100));
      }

      await new Promise((r) => setTimeout(r, 300));
      await t.destroy();

      // Should not have more than maxFiles rotated files
      expect(fs.existsSync(`${filePath}.3`)).toBe(false);
    });

    it('does not lose entries written during rotation', async () => {
      const filePath = track(tmpPath());
      const t = new FileTransport({
        path: filePath,
        rotation: { maxSize: 200, maxFiles: 5 },
      });
      await t.ready();

      const totalEntries = 15;
      for (let i = 0; i < totalEntries; i++) {
        t.write(makeEntry({ msg: `msg-${i}`, fields: { i } }));
      }

      await new Promise((r) => setTimeout(r, 500));
      await t.destroy();

      // Count total entries across all files
      let totalLines = 0;
      const readLines = (p: string) => {
        try {
          return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).length;
        } catch { return 0; }
      };

      totalLines += readLines(filePath);
      for (let i = 1; i <= 5; i++) {
        totalLines += readLines(`${filePath}.${i}`);
      }

      expect(totalLines).toBe(totalEntries);
    });

    it('seeds bytesWritten from existing file when appending', async () => {
      const filePath = track(tmpPath());

      // Pre-populate file with some content
      fs.writeFileSync(filePath, 'x'.repeat(180) + '\n');

      const t = new FileTransport({
        path: filePath,
        rotation: { maxSize: 200, maxFiles: 3 },
      });
      await t.ready();

      // A single small write should trigger rotation since file is near limit
      t.write(makeEntry({ msg: 'trigger' }));

      await new Promise((r) => setTimeout(r, 200));
      await t.destroy();

      // The pre-existing content should have been rotated to .1
      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
      const rotated = fs.readFileSync(`${filePath}.1`, 'utf8');
      expect(rotated).toContain('x'.repeat(50));
    });
  });

  // ─── Rotation: time-based ─────────────────────────────────────────────────

  describe('rotation (time-based)', () => {
    it('rotates on a numeric interval', async () => {
      const filePath = track(tmpPath());
      const t = new FileTransport({
        path: filePath,
        rotation: { interval: 200, maxFiles: 3 },
      });
      await t.ready();

      t.write(makeEntry({ msg: 'before-rotation' }));

      // Wait for the interval to trigger rotation
      await new Promise((r) => setTimeout(r, 400));

      t.write(makeEntry({ msg: 'after-rotation' }));
      await t.destroy();

      // Rotated file should contain the pre-rotation entry
      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
      const rotated = fs.readFileSync(`${filePath}.1`, 'utf8');
      expect(rotated).toContain('before-rotation');

      // Current file should contain the post-rotation entry
      const current = fs.readFileSync(filePath, 'utf8');
      expect(current).toContain('after-rotation');
    });

    it('cleans up timer on destroy', async () => {
      const filePath = track(tmpPath());
      const t = new FileTransport({
        path: filePath,
        rotation: { interval: 60000, maxFiles: 3 },
      });
      await t.ready();
      t.write(makeEntry({ msg: 'test' }));

      // Destroy should not hang — timer is cleaned up
      await t.destroy();
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // ─── Rotation: compression ────────────────────────────────────────────────

  describe('rotation (compression)', () => {
    it('compresses rotated files when compress: true', async () => {
      const filePath = track(tmpPath());
      const t = new FileTransport({
        path: filePath,
        rotation: { maxSize: 200, maxFiles: 3, compress: true },
      });
      await t.ready();

      for (let i = 0; i < 10; i++) {
        t.write(makeEntry({ msg: `entry-${i}`, fields: { padding: 'x'.repeat(30) } }));
      }

      // Wait for rotation + compression
      await new Promise((r) => setTimeout(r, 500));
      await t.destroy();

      // Check that at least one .gz file was created
      let hasGz = false;
      for (let i = 1; i <= 3; i++) {
        if (fs.existsSync(`${filePath}.${i}.gz`)) {
          hasGz = true;
          break;
        }
      }
      expect(hasGz).toBe(true);
    });
  });

  // ─── Rotation: combined ───────────────────────────────────────────────────

  describe('rotation (combined size + time)', () => {
    it('triggers on whichever condition is met first', async () => {
      const filePath = track(tmpPath());
      const t = new FileTransport({
        path: filePath,
        rotation: { maxSize: 200, interval: 60000, maxFiles: 3 },
      });
      await t.ready();

      // Size should trigger before the 60s interval
      for (let i = 0; i < 10; i++) {
        t.write(makeEntry({ msg: `entry-${i}`, fields: { padding: 'x'.repeat(30) } }));
      }

      await new Promise((r) => setTimeout(r, 300));
      await t.destroy();

      expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    });
  });
});
