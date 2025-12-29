#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * UPSERT UI PNL BENCHMARKS V2
 * ============================================================================
 *
 * Loads a UI snapshot and upserts into pm_ui_pnl_benchmarks_v2 table.
 *
 * USAGE:
 *   npx tsx scripts/pnl/upsert-ui-pnl-benchmarks-v2.ts \
 *     --snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json \
 *     --benchmark-set=trader_strict_v2_2025_12_07
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs/promises';
import path from 'path';
import { getClickHouseClient } from '../../lib/clickhouse/client';

// ============================================================================
// Types
// ============================================================================

interface UISnapshot {
  metadata: {
    source: string;
    fetched_at: string;
    total_wallets: number;
    successful: number;
    failed: number;
    nonexistent: number;
  };
  wallets: Array<{
    wallet: string;
    uiPnL: number | null;
    scrapedAt: string;
    success: boolean;
    error?: string;
    retries: number;
    rawText?: string;
  }>;
}

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
    snapshot: args.get('snapshot'),
    benchmarkSet: args.get('benchmark-set') || 'default',
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  if (!config.snapshot) {
    console.error('❌ ERROR: --snapshot parameter required');
    process.exit(1);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   UPSERT UI PNL BENCHMARKS V2`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`📄 Snapshot:      ${config.snapshot}`);
  console.log(`🏷️  Benchmark Set: ${config.benchmarkSet}\n`);

  // Load snapshot
  const snapshotPath = path.join(process.cwd(), config.snapshot);
  const raw = await fs.readFile(snapshotPath, 'utf8');
  const snapshot: UISnapshot = JSON.parse(raw);

  console.log(`✅ Loaded ${snapshot.wallets.length} wallets from snapshot\n`);

  // Connect to ClickHouse
  const client = getClickHouseClient();

  // Create table if not exists
  console.log(`📊 Creating pm_ui_pnl_benchmarks_v2 table if not exists...`);

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS pm_ui_pnl_benchmarks_v2 (
      wallet_address String,
      benchmark_set String,
      ui_pnl_value Nullable(Float64),
      captured_at DateTime64(3),
      source String,
      status String,  -- 'success', 'nonexistent', 'error'
      error_message Nullable(String),
      raw_text Nullable(String)
    )
    ENGINE = ReplacingMergeTree(captured_at)
    ORDER BY (wallet_address, benchmark_set)
  `;

  await client.command({ query: createTableSQL });
  console.log(`✅ Table ready\n`);

  // Prepare rows
  const rows: any[] = [];
  for (const wallet of snapshot.wallets) {
    let status = 'success';
    if (!wallet.success && wallet.error?.includes('does not exist')) {
      status = 'nonexistent';
    } else if (!wallet.success) {
      status = 'error';
    }

    rows.push({
      wallet_address: wallet.wallet.toLowerCase(),
      benchmark_set: config.benchmarkSet,
      ui_pnl_value: wallet.uiPnL,
      captured_at: wallet.scrapedAt,
      source: snapshot.metadata.source,
      status,
      error_message: wallet.error || null,
      raw_text: wallet.rawText || null,
    });
  }

  // Insert
  console.log(`📥 Inserting ${rows.length} rows...`);

  await client.insert({
    table: 'pm_ui_pnl_benchmarks_v2',
    values: rows,
    format: 'JSONEachRow',
  });

  console.log(`✅ Inserted successfully\n`);

  // Verify
  const countResult = await client.query({
    query: `
      SELECT
        benchmark_set,
        status,
        count() as cnt
      FROM pm_ui_pnl_benchmarks_v2
      WHERE benchmark_set = {benchmark_set: String}
      GROUP BY benchmark_set, status
      ORDER BY status
    `,
    query_params: { benchmark_set: config.benchmarkSet },
    format: 'JSONEachRow',
  });

  const counts = await countResult.json<Array<{ benchmark_set: string; status: string; cnt: string }>>();

  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`                    VERIFICATION`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`  Benchmark Set: ${config.benchmarkSet}\n`);

  for (const row of counts) {
    console.log(`  ${row.status.padEnd(15)} ${row.cnt}`);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
