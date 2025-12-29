#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * UPSERT DOME REALIZED BENCHMARKS V1
 * ============================================================================
 *
 * Loads Dome realized PnL truth into ClickHouse benchmark table.
 * INSERT-only with benchmark_set versioning (never overwrite/truncate).
 *
 * USAGE:
 *   npx tsx scripts/pnl/upsert-dome-realized-benchmarks-v1.ts \
 *     --truth-map=tmp/dome_truth_map_500.json \
 *     --benchmark-set=dome_realized_v1_2025_12_07
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs/promises';
import path from 'path';
import { getClickHouseClient } from '../../lib/clickhouse/client';

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const [k, v] = a.split('=');
    if (k.startsWith('--')) args.set(k.replace(/^--/, ''), v ?? 'true');
  }
  return {
    truthMap: args.get('truth-map'),
    snapshot: args.get('snapshot'),
    benchmarkSet: args.get('benchmark-set') || `dome_realized_v1_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}`,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();
  const client = getClickHouseClient();

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   UPSERT DOME REALIZED BENCHMARKS V1`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);

  const inputFile = config.truthMap || config.snapshot;
  if (!inputFile) {
    throw new Error('Must provide --truth-map or --snapshot');
  }

  console.log(`📄 Input:          ${inputFile}`);
  console.log(`🏷️  Benchmark Set: ${config.benchmarkSet}\n`);

  // Load truth data
  const raw = await fs.readFile(path.join(process.cwd(), inputFile), 'utf8');
  const data = JSON.parse(raw);

  // Handle both truth map format and raw snapshot format
  let entries: Array<{
    wallet: string;
    dome_realized: number | null;
    dome_confidence: string;
    is_placeholder: boolean;
    fetched_at: string;
  }> = [];

  if (data.metadata && data.wallets && Array.isArray(data.wallets)) {
    // Raw snapshot format (from fetch-dome-realized-pnl.ts)
    // Has: wallet, realizedPnl, confidence, isPlaceholder, error
    for (const w of data.wallets) {
      entries.push({
        wallet: w.wallet.toLowerCase(),
        dome_realized: w.realizedPnl ?? null,
        dome_confidence: w.confidence || (w.error ? 'error' : (w.isPlaceholder ? 'none' : 'high')),
        is_placeholder: w.isPlaceholder || false,
        fetched_at: data.metadata.fetched_at,
      });
    }
  } else if (data.wallets && Array.isArray(data.wallets)) {
    // Truth map format (from build-dome-truth-map.ts)
    for (const w of data.wallets) {
      entries.push({
        wallet: w.wallet.toLowerCase(),
        dome_realized: w.dome_realized ?? w.realizedPnl ?? null,
        dome_confidence: w.dome_confidence || w.confidence || 'unknown',
        is_placeholder: w.is_placeholder || w.isPlaceholder || false,
        fetched_at: w.fetched_at || data.generated_at || new Date().toISOString(),
      });
    }
  } else {
    throw new Error('Unknown input format');
  }

  console.log(`✅ Loaded ${entries.length} wallets\n`);

  // Create table if not exists
  console.log(`📊 Creating pm_dome_realized_benchmarks_v1 table if not exists...`);
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_dome_realized_benchmarks_v1 (
        wallet_address String,
        benchmark_set String,
        dome_realized_value Nullable(Float64),
        dome_confidence String,
        is_placeholder UInt8,
        fetched_at DateTime64(3),
        inserted_at DateTime64(3) DEFAULT now64(3)
      )
      ENGINE = ReplacingMergeTree(inserted_at)
      ORDER BY (wallet_address, benchmark_set)
    `,
  });
  console.log(`✅ Table ready\n`);

  // Filter to high-confidence only for insertion
  const reliableEntries = entries.filter(e => e.dome_confidence === 'high');
  console.log(`📊 Reliable (high confidence): ${reliableEntries.length}/${entries.length}\n`);

  // Insert rows
  console.log(`📥 Inserting ${entries.length} rows (all, including placeholders for tracking)...`);

  const rows = entries.map(e => ({
    wallet_address: e.wallet,
    benchmark_set: config.benchmarkSet,
    dome_realized_value: e.dome_realized,
    dome_confidence: e.dome_confidence,
    is_placeholder: e.is_placeholder ? 1 : 0,
    fetched_at: e.fetched_at,
  }));

  await client.insert({
    table: 'pm_dome_realized_benchmarks_v1',
    values: rows,
    format: 'JSONEachRow',
  });

  console.log(`✅ Inserted successfully\n`);

  // Verify
  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`                    VERIFICATION`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);

  const verifyResult = await client.query({
    query: `
      SELECT
        dome_confidence,
        count() as cnt,
        sum(dome_realized_value IS NOT NULL) as with_pnl,
        avg(dome_realized_value) as avg_pnl
      FROM pm_dome_realized_benchmarks_v1
      WHERE benchmark_set = '${config.benchmarkSet}'
      GROUP BY dome_confidence
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow',
  });

  const verifyRows = await verifyResult.json<Array<{
    dome_confidence: string;
    cnt: string;
    with_pnl: string;
    avg_pnl: number | null;
  }>>();

  console.log(`  Benchmark Set: ${config.benchmarkSet}\n`);
  for (const row of verifyRows) {
    const avgStr = row.avg_pnl ? `$${row.avg_pnl.toLocaleString()}` : 'N/A';
    console.log(`  ${row.dome_confidence.padEnd(12)} Count: ${row.cnt.padStart(4)}  With PnL: ${row.with_pnl.padStart(4)}  Avg: ${avgStr}`);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
