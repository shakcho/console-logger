#!/usr/bin/env node

/**
 * Konsole benchmark regression comparator.
 *
 * Reads current `benchmark-throughput.json` + `benchmark-size.json` produced
 * by the throughput / size benchmarks, plus baseline copies (typically
 * downloaded from the latest main-branch run), and emits a markdown report
 * with traffic-light (🟢 / 🟡 / 🔴 / 🆕) status per metric.
 *
 * Non-blocking by design: this script never exits non-zero on regressions.
 * It just produces a report. The CI workflow uses the report as a PR comment
 * body so reviewers can see deltas at a glance.
 *
 * Inputs (env vars, all optional):
 *   KONSOLE_BENCH_JSON     — current throughput JSON (default ./benchmark-throughput.json)
 *   KONSOLE_SIZE_JSON      — current size       JSON (default ./benchmark-size.json)
 *   KONSOLE_BASELINE_DIR   — directory containing baseline JSONs (default ./baseline)
 *   KONSOLE_REPORT_OUT     — write markdown report here (default ./benchmark-report.md)
 *   KONSOLE_RAW_OUTPUT     — raw text log to embed in the comment's <details> block
 *
 * Thresholds (configurable via env):
 *   KONSOLE_THRESHOLD_YELLOW  (default 5)   — % regression before turning yellow
 *   KONSOLE_THRESHOLD_RED     (default 15)  — % regression before turning red
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const YELLOW_THRESHOLD = Number(process.env.KONSOLE_THRESHOLD_YELLOW ?? 5);
const RED_THRESHOLD    = Number(process.env.KONSOLE_THRESHOLD_RED    ?? 15);

const STATUS_NEW = '🆕';
const STATUS_OK  = '🟢';
const STATUS_MID = '🟡';
const STATUS_BAD = '🔴';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function formatOps(ops) {
  if (ops == null) return '—';
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(2)}M`;
  if (ops >= 1_000)     return `${(ops / 1_000).toFixed(1)}K`;
  return ops.toFixed(0);
}

function formatNs(ns) {
  if (ns == null) return '—';
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  if (ns >= 1_000)     return `${(ns / 1_000).toFixed(2)} µs`;
  return `${ns.toFixed(0)} ns`;
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024)        return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes.toFixed(0)} B`;
}

/**
 * Classify a delta. `direction` is `'higher-better'` (throughput) or
 * `'lower-better'` (latency, size, memory). Returns `{ status, deltaPct, deltaStr }`.
 *
 * Threshold semantics:
 *   higher-better: a *drop* is a regression  → green if delta ≥ -YELLOW%
 *   lower-better:  a *rise* is a regression  → green if delta ≤ +YELLOW%
 */
function classify(current, baseline, direction) {
  if (current == null) return { status: '—', deltaPct: null, deltaStr: '—' };
  if (baseline == null || baseline === 0) {
    return { status: STATUS_NEW, deltaPct: null, deltaStr: 'no baseline' };
  }
  const deltaPct = ((current - baseline) / baseline) * 100;
  const sign = deltaPct >= 0 ? '+' : '';
  const deltaStr = `${sign}${deltaPct.toFixed(1)}%`;

  let status;
  if (direction === 'higher-better') {
    if (deltaPct >= -YELLOW_THRESHOLD)      status = STATUS_OK;
    else if (deltaPct >= -RED_THRESHOLD)    status = STATUS_MID;
    else                                    status = STATUS_BAD;
  } else {
    if (deltaPct <= YELLOW_THRESHOLD)       status = STATUS_OK;
    else if (deltaPct <= RED_THRESHOLD)     status = STATUS_MID;
    else                                    status = STATUS_BAD;
  }

  return { status, deltaPct, deltaStr };
}

function tableHeader(metricColumn) {
  return [
    `| ${metricColumn} | Current | Baseline | Δ | Status |`,
    '|---|---|---|---|---|',
  ].join('\n');
}

function row(label, current, baseline, formatter, classification) {
  return `| ${label} | ${formatter(current)} | ${formatter(baseline)} | ${classification.deltaStr} | ${classification.status} |`;
}

// ─── Section builders ────────────────────────────────────────────────────────

function buildThroughputSection(current, baseline) {
  if (!current?.throughput?.length) return '';

  const baselineByName = new Map(
    (baseline?.throughput ?? []).map((r) => [r.name, r]),
  );

  const lines = ['### Throughput (ops/sec — higher is better)', '', tableHeader('Logger')];
  let worst = STATUS_OK;
  for (const r of current.throughput) {
    const b = baselineByName.get(r.name);
    const c = classify(r.opsPerSec, b?.opsPerSec, 'higher-better');
    lines.push(row(r.name, r.opsPerSec, b?.opsPerSec, formatOps, c));
    worst = worseOf(worst, c.status);
  }
  return { md: lines.join('\n'), worst };
}

function buildLatencySection(current, baseline, percentile) {
  if (!current?.throughput?.length) return '';

  const baselineByName = new Map(
    (baseline?.throughput ?? []).map((r) => [r.name, r]),
  );

  const key = `${percentile}ns`;
  const lines = [
    `### Latency ${percentile} (lower is better)`,
    '',
    tableHeader('Logger'),
  ];
  let worst = STATUS_OK;
  for (const r of current.throughput) {
    const b = baselineByName.get(r.name);
    const c = classify(r[key], b?.[key], 'lower-better');
    lines.push(row(r.name, r[key], b?.[key], formatNs, c));
    worst = worseOf(worst, c.status);
  }
  return { md: lines.join('\n'), worst };
}

function buildSizeSection(currentSize, baselineSize) {
  if (!currentSize?.bundle) return '';

  const lines = ['### Bundle Size (lower is better)', '', tableHeader('Asset')];
  let worst = STATUS_OK;

  for (const asset of ['esm', 'umd', 'types']) {
    const cur = currentSize.bundle[asset];
    const base = baselineSize?.bundle?.[asset];
    if (!cur) continue;

    for (const variant of ['rawBytes', 'gzipBytes']) {
      const label = `${asset.toUpperCase()} ${variant === 'rawBytes' ? 'raw' : 'gzip'}`;
      const c = classify(cur[variant], base?.[variant], 'lower-better');
      lines.push(row(label, cur[variant], base?.[variant], formatBytes, c));
      worst = worseOf(worst, c.status);
    }
  }
  return { md: lines.join('\n'), worst };
}

function buildMemorySection(current, baseline) {
  if (!current?.memory) return '';

  const lines = ['### Memory (lower is better)', '', tableHeader('Metric')];
  let worst = STATUS_OK;

  const metrics = [
    ['Δ RSS (100K entries)',         'uncappedDeltaBytes', formatBytes],
    ['Per-entry',                    'perEntryBytes',      formatBytes],
    ['Δ RSS (capped buffer, 100K)',  'cappedDeltaBytes',   formatBytes],
  ];

  for (const [label, key, fmt] of metrics) {
    const cur = current.memory[key];
    const base = baseline?.memory?.[key];
    const c = classify(cur, base, 'lower-better');
    lines.push(row(label, cur, base, fmt, c));
    worst = worseOf(worst, c.status);
  }
  return { md: lines.join('\n'), worst };
}

const STATUS_RANK = { [STATUS_OK]: 0, [STATUS_NEW]: 0, [STATUS_MID]: 1, [STATUS_BAD]: 2 };
function worseOf(a, b) {
  return (STATUS_RANK[b] ?? 0) > (STATUS_RANK[a] ?? 0) ? b : a;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const benchPath    = process.env.KONSOLE_BENCH_JSON    ?? path.join(root, 'benchmark-throughput.json');
  const sizePath     = process.env.KONSOLE_SIZE_JSON     ?? path.join(root, 'benchmark-size.json');
  const baselineDir  = process.env.KONSOLE_BASELINE_DIR  ?? path.join(root, 'baseline');
  const reportPath   = process.env.KONSOLE_REPORT_OUT    ?? path.join(root, 'benchmark-report.md');
  const rawOutputPath = process.env.KONSOLE_RAW_OUTPUT;

  const current  = await readJson(benchPath);
  const currSize = await readJson(sizePath);
  const baseline = await readJson(path.join(baselineDir, 'benchmark-throughput.json'));
  const baseSize = await readJson(path.join(baselineDir, 'benchmark-size.json'));

  if (!current && !currSize) {
    console.error('No current benchmark JSON found. Did the benchmarks run?');
    process.exit(0); // non-blocking
  }

  const sections = [];
  let overall = STATUS_OK;
  let hasBaseline = baseline != null || baseSize != null;

  for (const builder of [
    () => buildThroughputSection(current, baseline),
    () => buildLatencySection(current, baseline, 'p50'),
    () => buildLatencySection(current, baseline, 'p95'),
    () => buildLatencySection(current, baseline, 'p99'),
    () => buildSizeSection(currSize, baseSize),
    () => buildMemorySection(current, baseline),
  ]) {
    const result = builder();
    if (!result || !result.md) continue;
    sections.push(result.md);
    overall = worseOf(overall, result.worst);
  }

  const overallLabel = !hasBaseline
    ? `${STATUS_NEW} **No baseline available** — first run on this branch will seed the baseline on merge to \`main\`.`
    : overall === STATUS_BAD
      ? `${STATUS_BAD} **Significant regression detected** — at least one metric exceeds the ${RED_THRESHOLD}% threshold.`
      : overall === STATUS_MID
        ? `${STATUS_MID} **Minor regression detected** — at least one metric is between ${YELLOW_THRESHOLD}% and ${RED_THRESHOLD}% worse than baseline.`
        : `${STATUS_OK} **All tracked metrics within tolerance** (±${YELLOW_THRESHOLD}% of baseline).`;

  const legend = [
    '<sub>',
    `${STATUS_OK} within ±${YELLOW_THRESHOLD}% of baseline (or improvement) ·`,
    `${STATUS_MID} ${YELLOW_THRESHOLD}–${RED_THRESHOLD}% regression ·`,
    `${STATUS_BAD} >${RED_THRESHOLD}% regression ·`,
    `${STATUS_NEW} no baseline yet`,
    '</sub>',
  ].join(' ');

  const platform = current?.platform ?? {};
  const baselinePlatform = baseline?.platform ?? {};
  const platformLine = platform.os
    ? `<sub>Runner: ${platform.os}/${platform.arch} · Node ${platform.node} · ${platform.cpu}${
        baseline ? ` · baseline from ${baseline.createdAt}` : ''
      }</sub>`
    : '';

  let raw = '';
  if (rawOutputPath) {
    try {
      raw = await readFile(rawOutputPath, 'utf8');
    } catch { /* ignore */ }
  }

  const body = [
    '## 📊 Benchmark Results',
    '',
    overallLabel,
    '',
    legend,
    '',
    ...sections.map((s) => s + '\n'),
    platformLine,
    '',
    raw
      ? [
          '<details><summary>Full benchmark output</summary>',
          '',
          '```',
          raw.trim(),
          '```',
          '</details>',
        ].join('\n')
      : '',
    '',
    '<sub>This check is informational only — it never blocks merging. Tune thresholds via `KONSOLE_THRESHOLD_YELLOW` / `KONSOLE_THRESHOLD_RED`.</sub>',
  ].filter((s) => s !== '').join('\n');

  await writeFile(reportPath, body);
  console.log(`Wrote benchmark comparison report to ${reportPath}`);
  console.log(`Overall status: ${overall}${hasBaseline ? '' : ' (no baseline)'}`);
}

main().catch((err) => {
  // Non-blocking: log and exit 0 so CI never fails on this script
  console.error('compare.mjs error:', err);
  process.exit(0);
});
