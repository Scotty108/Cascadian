/**
 * Create pm_validation_fills_norm_v1: Pre-joined fills for validation cohort only
 *
 * This is the KEY to fast iteration - instead of scanning 676M rows,
 * we have a small table with just the cohort's fills.
 *
 * Columns:
 * - wallet, ts, event_id, condition_id, outcome_index
 * - side, role, usdc_amount, token_amount, fee_amount
 * - transaction_hash (for bundle analysis)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Creating pm_validation_fills_norm_v1 ===\n');

  // Step 1: Create table
  console.log('Step 1: Creating table...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_validation_fills_norm_v1 (
        wallet LowCardinality(String),
        ts DateTime,
        event_id String,
        condition_id String,
        outcome_index UInt8,
        side LowCardinality(String),
        role LowCardinality(String),
        usdc_amount Float64,
        token_amount Float64,
        fee_amount Float64,
        transaction_hash String
      ) ENGINE = MergeTree()
      ORDER BY (wallet, condition_id, ts, event_id)
    `
  });
  console.log('  Done.\n');

  // Step 2: Get validation wallets
  console.log('Step 2: Getting validation wallets...');
  const walletsResult = await clickhouse.query({
    query: 'SELECT wallet FROM pm_validation_wallets_v2',
    format: 'JSONEachRow'
  });
  const wallets = (await walletsResult.json() as any[]).map(r => r.wallet);
  console.log(`  ${wallets.length} wallets in cohort.\n`);

  // Step 3: Truncate and insert fills
  console.log('Step 3: Truncating table...');
  await clickhouse.command({ query: 'TRUNCATE TABLE pm_validation_fills_norm_v1' });
  console.log('  Done.\n');

  // Step 4: Insert fills in batches (by wallet)
  console.log('Step 4: Inserting fills (in batches)...');

  const batchSize = 50;
  let totalFills = 0;

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');

    // Join trader_events with token_map to get condition_id and outcome_index
    const insertQuery = `
      INSERT INTO pm_validation_fills_norm_v1
      SELECT
        lower(t.trader_wallet) as wallet,
        t.trade_time as ts,
        t.event_id,
        m.condition_id,
        toUInt8(m.outcome_index) as outcome_index,
        t.side,
        t.role,
        t.usdc_amount,
        t.token_amount,
        t.fee_amount,
        t.transaction_hash
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) IN (${walletList})
        AND m.condition_id != ''
    `;

    await clickhouse.command({
      query: insertQuery,
      clickhouse_settings: { max_execution_time: 120 }
    });

    // Count inserted rows
    const countResult = await clickhouse.query({
      query: 'SELECT count() as c FROM pm_validation_fills_norm_v1',
      format: 'JSONEachRow'
    });
    totalFills = Number((await countResult.json() as any[])[0].c);

    process.stdout.write(`  Processed ${Math.min(i + batchSize, wallets.length)}/${wallets.length} wallets (${totalFills.toLocaleString()} fills)\r`);
  }

  console.log(`\n  Total: ${totalFills.toLocaleString()} fills.\n`);

  // Step 5: Summary stats
  console.log('=== Validation Fills Summary ===\n');

  const summary = await clickhouse.query({
    query: `
      SELECT
        v.cohort_type,
        count() as fills,
        uniqExact(f.wallet) as wallets,
        round(fills / wallets, 0) as avg_fills_per_wallet,
        min(f.ts) as earliest_fill,
        max(f.ts) as latest_fill
      FROM pm_validation_fills_norm_v1 f
      JOIN pm_validation_wallets_v2 v ON f.wallet = v.wallet
      GROUP BY v.cohort_type
      ORDER BY v.cohort_type
    `,
    format: 'JSONEachRow'
  });

  const rows = await summary.json() as any[];
  console.log('Cohort Type      | Wallets | Fills          | Avg Fills | Date Range');
  console.log('-'.repeat(90));
  for (const r of rows) {
    console.log(
      `${r.cohort_type.padEnd(16)} | ${String(r.wallets).padStart(7)} | ` +
      `${Number(r.fills).toLocaleString().padStart(14)} | ` +
      `${String(r.avg_fills_per_wallet).padStart(9)} | ` +
      `${r.earliest_fill.slice(0, 10)} to ${r.latest_fill.slice(0, 10)}`
    );
  }

  // Table size
  const sizeResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableSize(sum(bytes_on_disk)) as disk_size,
        sum(rows) as total_rows
      FROM system.parts
      WHERE table = 'pm_validation_fills_norm_v1' AND active = 1
    `,
    format: 'JSONEachRow'
  });
  const size = (await sizeResult.json() as any[])[0];
  console.log(`\nTable size: ${size.disk_size} (${Number(size.total_rows).toLocaleString()} rows)`);

  console.log('\n✅ pm_validation_fills_norm_v1 ready for fast iteration!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
