#!/usr/bin/env node

/**
 * Konsole bundle size analysis
 *
 * Run:
 *   node benchmarks/size.mjs
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

async function fileSize(filePath) {
  try {
    const content = await readFile(filePath);
    const raw = content.length;
    const gzipped = gzipSync(content).length;
    return { raw, gzipped, rawFmt: formatBytes(raw), gzipFmt: formatBytes(gzipped) };
  } catch {
    return null;
  }
}

async function dirSize(dirPath) {
  const { execSync } = await import('node:child_process');
  try {
    const output = execSync(`du -sk "${dirPath}" 2>/dev/null`).toString().trim();
    const kb = parseInt(output.split('\t')[0], 10);
    return kb * 1024;
  } catch {
    return null;
  }
}

async function countDeps(pkgPath) {
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    return Object.keys(pkg.dependencies ?? {}).length;
  } catch {
    return null;
  }
}

async function main() {
  console.log('');
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│  Konsole Bundle Size Analysis                       │');
  console.log('└─────────────────────────────────────────────────────┘');
  console.log('');

  // ── Konsole bundle ──────────────────────────────────────────────────────

  const esm = await fileSize(path.join(root, 'dist/konsole.js'));
  const umd = await fileSize(path.join(root, 'dist/konsole.umd.cjs'));
  const dts = await fileSize(path.join(root, 'dist/index.d.ts'));

  console.log('─── Konsole Output Files ─────────────────────────────');
  console.log('');
  if (esm) console.log(`  ESM   (dist/konsole.js):       ${esm.rawFmt}  →  ${esm.gzipFmt} gzip`);
  if (umd) console.log(`  UMD   (dist/konsole.umd.cjs):  ${umd.rawFmt}  →  ${umd.gzipFmt} gzip`);
  if (dts) console.log(`  Types (dist/index.d.ts):        ${dts.rawFmt}  →  ${dts.gzipFmt} gzip`);
  console.log(`  Dependencies:                  0 (zero-dependency)`);
  console.log('');

  // ── Competitor install sizes ────────────────────────────────────────────

  console.log('─── Install Size Comparison ──────────────────────────');
  console.log('  (install sizes from node_modules — install competitors with:');
  console.log('   npm install --no-save pino winston bunyan consola)');
  console.log('');

  const competitors = ['pino', 'winston', 'bunyan', 'consola'];
  const rows = [];

  for (const pkg of competitors) {
    const pkgDir = path.join(root, 'node_modules', pkg);
    const pkgJson = path.join(pkgDir, 'package.json');
    const deps = await countDeps(pkgJson);
    const size = await dirSize(pkgDir);

    if (deps !== null && size !== null) {
      rows.push({
        Package: pkg,
        'Direct deps': deps,
        'Install size': formatBytes(size),
      });
    } else {
      rows.push({
        Package: pkg,
        'Direct deps': '(not installed)',
        'Install size': '—',
      });
    }
  }

  // Add konsole
  rows.unshift({
    Package: 'konsole-logger',
    'Direct deps': 0,
    'Install size': esm ? formatBytes(esm.raw + (umd?.raw ?? 0) + (dts?.raw ?? 0)) : '—',
  });

  console.table(rows);

  // ── Source breakdown ────────────────────────────────────────────────────

  console.log('');
  console.log('─── Source File Sizes ────────────────────────────────');
  console.log('');

  const srcFiles = [
    'src/Konsole.ts',
    'src/formatter.ts',
    'src/types.ts',
    'src/CircularBuffer.ts',
    'src/levels.ts',
    'src/env.ts',
    'src/transports/HttpTransport.ts',
    'src/transports/ConsoleTransport.ts',
    'src/transports/StreamTransport.ts',
    'src/transports/FileTransport.ts',
    'src/transports/base.ts',
  ];

  let totalSrc = 0;
  for (const file of srcFiles) {
    const info = await fileSize(path.join(root, file));
    if (info) {
      totalSrc += info.raw;
      console.log(`  ${file.padEnd(42)} ${info.rawFmt}`);
    }
  }
  console.log(`  ${'─'.repeat(42)} ─────────`);
  console.log(`  ${'Total source'.padEnd(42)} ${formatBytes(totalSrc)}`);
  console.log('');

  // ── Write structured JSON for CI regression tracking ─────────────────────

  const jsonOut = {
    schemaVersion: 1,
    createdAt:     new Date().toISOString(),
    bundle: {
      esm:   esm ? { rawBytes: esm.raw, gzipBytes: esm.gzipped } : null,
      umd:   umd ? { rawBytes: umd.raw, gzipBytes: umd.gzipped } : null,
      types: dts ? { rawBytes: dts.raw, gzipBytes: dts.gzipped } : null,
    },
    sourceTotalBytes: totalSrc,
  };

  const outPath = process.env.KONSOLE_SIZE_JSON
    ?? path.join(root, 'benchmark-size.json');
  await writeFile(outPath, JSON.stringify(jsonOut, null, 2) + '\n');
  console.log(`  → JSON results written to ${outPath}`);
  console.log('');
}

main().catch(console.error);
