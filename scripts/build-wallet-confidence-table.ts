/**
 * Build pm_wallet_confidence table
 *
 * Pre-computes bundled transaction count per wallet to enable fast filtering
 * of wallets by PnL calculation accuracy.
 *
 * Confidence levels:
 * - HIGH (0 bundled txs): 100% accurate PnL calculation
 * - MEDIUM (1-50 bundled txs): Usually accurate
 * - LOW (51+ bundled txs): Inaccurate - Neg Risk heavy
 *
 * Usage:
 *   npx tsx scripts/build-wallet-confidence-table.ts
 *
 * This will create/replace pm_wallet_confidence table with ~1.8M rows.
 * Expected runtime: 5-10 minutes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function buildConfidenceTable() {
  console.log('=== Building pm_wallet_confidence table ===\n');

  // Step 1: Create staging table
  console.log('Step 1: Creating staging table...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallet_confidence_staging (
        wallet String,
        bundled_tx_count UInt32,
        confidence LowCardinality(String),
        updated_at DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      ORDER BY wallet
    `,
  });

  // Step 2: Truncate staging
  console.log('Step 2: Truncating staging table...');
  await clickhouse.command({
    query: `TRUNCATE TABLE pm_wallet_confidence_staging`,
  });

  // Step 3: Insert all wallets with their bundled tx count
  console.log('Step 3: Computing bundled tx counts (this will take 5-10 min)...');
  const startTime = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO pm_wallet_confidence_staging (wallet, bundled_tx_count, confidence)
      WITH bundled_per_wallet AS (
        SELECT
          lower(t.trader_wallet) as wallet,
          lower(substring(event_id, 1, 66)) as tx_hash,
          lower(m.condition_id) as condition_id
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
        GROUP BY wallet, tx_hash, condition_id
        HAVING countIf(side='buy') > 0
           AND countIf(side='sell') > 0
           AND count(DISTINCT m.outcome_index) >= 2
      ),
      wallet_counts AS (
        SELECT wallet, count() as bundled_count
        FROM bundled_per_wallet
        GROUP BY wallet
      ),
      all_wallets AS (
        SELECT DISTINCT lower(trader_wallet) as wallet
        FROM pm_trader_events_v3
      )
      SELECT
        a.wallet,
        coalesce(w.bundled_count, 0) as bundled_tx_count,
        CASE
          WHEN coalesce(w.bundled_count, 0) = 0 THEN 'high'
          WHEN coalesce(w.bundled_count, 0) <= 50 THEN 'medium'
          ELSE 'low'
        END as confidence
      FROM all_wallets a
      LEFT JOIN wallet_counts w ON a.wallet = w.wallet
    `,
    clickhouse_settings: {
      max_execution_time: 1800, // 30 min timeout
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Done in ${elapsed}s`);

  // Step 4: Swap tables
  console.log('Step 4: Swapping tables...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_wallet_confidence_old`,
  });
  await clickhouse.command({
    query: `RENAME TABLE pm_wallet_confidence TO pm_wallet_confidence_old`,
  }).catch(() => {
    // Table may not exist yet, that's OK
  });
  await clickhouse.command({
    query: `RENAME TABLE pm_wallet_confidence_staging TO pm_wallet_confidence`,
  });
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_wallet_confidence_old`,
  });

  // Step 5: Get stats
  console.log('\nStep 5: Getting stats...');
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        confidence,
        count() as wallet_count,
        round(count() * 100.0 / sum(count()) OVER (), 1) as pct
      FROM pm_wallet_confidence
      GROUP BY confidence
      ORDER BY wallet_count DESC
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsResult.json()) as Array<{
    confidence: string;
    wallet_count: string;
    pct: string;
  }>;

  console.log('\n=== RESULTS ===');
  console.log('Confidence | Wallets    | Pct');
  console.log('-----------|------------|------');
  for (const row of stats) {
    console.log(
      `${row.confidence.padEnd(10)} | ${row.wallet_count.padStart(10)} | ${row.pct}%`
    );
  }

  const totalResult = await clickhouse.query({
    query: `SELECT count() as total FROM pm_wallet_confidence`,
    format: 'JSONEachRow',
  });
  const total = ((await totalResult.json()) as Array<{ total: string }>)[0].total;
  console.log(`\nTotal wallets: ${Number(total).toLocaleString()}`);
  console.log('\nTable pm_wallet_confidence is ready!');
}

buildConfidenceTable().catch(console.error);
