#!/usr/bin/env npx tsx
/**
 * PROMOTE TRADER-STRICT CLASSIFIER TO MATERIALIZED TABLE (SIMPLIFIED)
 * ============================================================================
 *
 * Creates trader_strict_classifier_v1_tbl without the expensive benchmark_unresolved
 * column. This avoids memory issues from the large pm_trader_events_v2 join.
 *
 * The unresolved_pct column uses the pm_unified_ledger payout_norm IS NULL check.
 * For benchmark-compatible unresolved, query directly using the benchmark formula.
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 900000,
});

async function createMaterializedTable() {
  console.log('═'.repeat(80));
  console.log('PROMOTING TRADER-STRICT CLASSIFIER TO MATERIALIZED TABLE (SIMPLIFIED)');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Drop old table if exists
  console.log('Step 1: Dropping old table if exists...');
  await ch.command({
    query: 'DROP TABLE IF EXISTS trader_strict_classifier_v1_tbl_new'
  });

  // Step 2: Create table from existing view (no benchmark CTE)
  console.log('Step 2: Creating trader_strict_classifier_v1_tbl_new from view...');
  console.log('        (Using existing trader_strict_classifier_v1 view)');

  const startTime = Date.now();
  await ch.command({
    query: `
      CREATE TABLE trader_strict_classifier_v1_tbl_new
      ENGINE = MergeTree()
      ORDER BY (tier, wallet_address)
      SETTINGS index_granularity = 8192
      AS
      SELECT
        wallet_address,
        clob_event_count,
        clob_usdc_volume,
        clob_unresolved_count,
        split_count,
        merge_count,
        redemption_count,
        amm_event_count,
        amm_usdc_volume,
        maker_count,
        taker_count,
        unique_clob_events,
        transfer_count,
        unresolved_pct,
        maker_share_pct,
        amm_dominance_pct,
        transfer_dominance_pct,
        mm_likelihood_flag,
        tier,
        now() as created_at
      FROM trader_strict_classifier_v1
    `
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`        Created in ${elapsed}s`);

  // Step 3: Verify
  console.log('\nStep 3: Verifying new table...');
  const verifyQuery = await ch.query({
    query: `
      SELECT
        tier,
        count() as wallet_count,
        avg(unresolved_pct) as avg_unres
      FROM trader_strict_classifier_v1_tbl_new
      GROUP BY tier
      ORDER BY tier
    `,
    format: 'JSONEachRow'
  });
  const verifyData = await verifyQuery.json<any[]>();

  console.log('\nTier verification:');
  console.log('Tier | Wallets    | Avg Unres%');
  console.log('-'.repeat(40));
  for (const r of verifyData) {
    console.log(
      `${r.tier.padEnd(4)} | ` +
      `${String(r.wallet_count).padStart(10)} | ` +
      `${Number(r.avg_unres).toFixed(2)}%`
    );
  }

  // Step 4: Atomic rename
  console.log('\nStep 4: Atomic rename (swap tables)...');
  await ch.command({
    query: 'DROP TABLE IF EXISTS trader_strict_classifier_v1_tbl_old'
  });

  const tableExistsQuery = await ch.query({
    query: `SELECT count() as cnt FROM system.tables WHERE database = 'default' AND name = 'trader_strict_classifier_v1_tbl'`,
    format: 'JSONEachRow'
  });
  const tableExists = (await tableExistsQuery.json<any[]>())[0]?.cnt > 0;

  if (tableExists) {
    await ch.command({
      query: 'RENAME TABLE trader_strict_classifier_v1_tbl TO trader_strict_classifier_v1_tbl_old'
    });
  }

  await ch.command({
    query: 'RENAME TABLE trader_strict_classifier_v1_tbl_new TO trader_strict_classifier_v1_tbl'
  });

  if (tableExists) {
    await ch.command({
      query: 'DROP TABLE IF EXISTS trader_strict_classifier_v1_tbl_old'
    });
  }

  console.log('        Done!');

  // Step 5: Final stats
  console.log('\n' + '═'.repeat(80));
  console.log('PROMOTION COMPLETE');
  console.log('═'.repeat(80));

  const finalQuery = await ch.query({
    query: `
      SELECT
        count() as total_wallets,
        countIf(tier = 'A') as tier_a,
        countIf(tier = 'B') as tier_b,
        countIf(tier = 'X') as tier_x,
        countIf(tier = 'A' AND unresolved_pct < 10) as tier_a_low_unres,
        min(created_at) as created_at
      FROM trader_strict_classifier_v1_tbl
    `,
    format: 'JSONEachRow'
  });
  const finalData = (await finalQuery.json<any[]>())[0];

  console.log(`\nTable: trader_strict_classifier_v1_tbl`);
  console.log(`Created: ${finalData.created_at}`);
  console.log(`Total wallets: ${finalData.total_wallets}`);
  console.log(`  Tier A: ${finalData.tier_a}`);
  console.log(`  Tier B: ${finalData.tier_b}`);
  console.log(`  Tier X: ${finalData.tier_x}`);
  console.log(`  Tier A with <10% unresolved: ${finalData.tier_a_low_unres}`);
  console.log('');
  console.log('Note: This version does NOT include unresolved_pct_benchmark_compatible.');
  console.log('      Use the V12 benchmark formula directly for accurate unresolved counts.');
}

async function main() {
  try {
    await createMaterializedTable();
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
