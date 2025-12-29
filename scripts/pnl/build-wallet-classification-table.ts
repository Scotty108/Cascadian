/**
 * Build Wallet Classification Table
 *
 * Creates wallet_classification_latest - the durable "800k pool" of candidate wallets.
 * DUEL refresh consumes this table only, never "discovers" wallets during cron runs.
 *
 * Schema:
 * - wallet_address (primary key)
 * - is_clob_only (boolean)
 * - clob_trade_count_total
 * - clob_trade_count_30d
 * - split_merge_count
 * - erc1155_transfer_count
 * - first_trade_ts, last_trade_ts
 * - classified_at
 *
 * Usage:
 *   npx tsx scripts/pnl/build-wallet-classification-table.ts [--skip-create] [--limit N]
 *
 * This should be run periodically (daily) to refresh the classification pool.
 * DUEL cron only computes metrics for wallets already in this table.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const TABLE_NAME = 'wallet_classification_latest';
const MIN_CLOB_TRADES = 10; // Minimum trades to be considered
const MAX_ERC1155_TRANSFERS = 10; // Max ERC1155 transfers to still be "CLOB-only"

async function createTable() {
  console.log(`Creating ${TABLE_NAME} table...`);

  // Drop existing table
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TABLE_NAME}` });

  const createQuery = `
    CREATE TABLE ${TABLE_NAME} (
      wallet_address String,

      -- Classification flags
      is_clob_only UInt8,

      -- Trade counts
      clob_trade_count_total UInt32,
      clob_trade_count_30d UInt32,

      -- Activity that disqualifies CLOB-only status
      split_merge_count UInt32,
      erc1155_transfer_count UInt32,

      -- Timestamps
      first_trade_ts DateTime,
      last_trade_ts DateTime,

      -- Metadata
      classified_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree(classified_at)
    ORDER BY wallet_address
  `;

  await clickhouse.command({ query: createQuery });
  console.log(`  Table ${TABLE_NAME} created.`);
}

async function populateClassifications(limit: number) {
  console.log('Classifying wallets...');

  // Single comprehensive query that classifies all wallets
  // This is the canonical source of truth for the 800k pool
  const query = `
    INSERT INTO ${TABLE_NAME}
    (wallet_address, is_clob_only, clob_trade_count_total, clob_trade_count_30d,
     split_merge_count, erc1155_transfer_count, first_trade_ts, last_trade_ts, classified_at)
    WITH clob_stats AS (
      SELECT
        lower(trader_wallet) as wallet_address,
        count() as trade_count_total,
        countIf(trade_time >= now() - INTERVAL 30 DAY) as trade_count_30d,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING trade_count_total >= ${MIN_CLOB_TRADES}
    ),
    erc_counts AS (
      SELECT
        lower(address) as wallet_address,
        count() as transfer_count
      FROM (
        SELECT from_address as address FROM pm_erc1155_transfers
        UNION ALL
        SELECT to_address as address FROM pm_erc1155_transfers
      )
      GROUP BY lower(address)
    ),
    ctf_counts AS (
      SELECT
        lower(user_address) as wallet_address,
        countIf(event_type IN ('PositionSplit', 'PositionsMerge')) as split_merge_count
      FROM pm_ctf_events
      WHERE is_deleted = 0
      GROUP BY lower(user_address)
    )
    SELECT
      c.wallet_address,
      -- is_clob_only: no splits/merges AND minimal ERC1155 transfers
      CASE
        WHEN coalesce(t.split_merge_count, 0) = 0
         AND coalesce(e.transfer_count, 0) <= ${MAX_ERC1155_TRANSFERS}
        THEN 1
        ELSE 0
      END as is_clob_only,
      c.trade_count_total as clob_trade_count_total,
      c.trade_count_30d as clob_trade_count_30d,
      coalesce(t.split_merge_count, 0) as split_merge_count,
      coalesce(e.transfer_count, 0) as erc1155_transfer_count,
      c.first_trade as first_trade_ts,
      c.last_trade as last_trade_ts,
      now() as classified_at
    FROM clob_stats c
    LEFT JOIN erc_counts e ON c.wallet_address = e.wallet_address
    LEFT JOIN ctf_counts t ON c.wallet_address = t.wallet_address
    ORDER BY c.trade_count_total DESC
    ${limit > 0 ? `LIMIT ${limit}` : ''}
  `;

  await clickhouse.command({ query });
}

async function generateStats() {
  console.log('\n' + '='.repeat(80));
  console.log('WALLET CLASSIFICATION STATISTICS');
  console.log('='.repeat(80));

  // Overall counts
  const overallQuery = `
    SELECT
      count() as total_wallets,
      countIf(is_clob_only = 1) as clob_only_count,
      countIf(is_clob_only = 0) as non_clob_only_count,
      round(countIf(is_clob_only = 1) * 100.0 / count(), 2) as clob_only_pct
    FROM ${TABLE_NAME}
  `;

  const overallResult = await clickhouse.query({ query: overallQuery, format: 'JSONEachRow' });
  const overall = ((await overallResult.json()) as any[])[0];

  console.log('\nOverall:');
  console.log(`  Total wallets with ≥${MIN_CLOB_TRADES} trades: ${overall.total_wallets.toLocaleString()}`);
  console.log(`  CLOB-only wallets: ${overall.clob_only_count.toLocaleString()} (${overall.clob_only_pct}%)`);
  console.log(`  Non-CLOB-only (CTF/ERC1155 activity): ${overall.non_clob_only_count.toLocaleString()}`);

  // CLOB-only breakdown by activity level
  const activityQuery = `
    SELECT
      CASE
        WHEN clob_trade_count_total >= 1000 THEN '1000+'
        WHEN clob_trade_count_total >= 500 THEN '500-999'
        WHEN clob_trade_count_total >= 100 THEN '100-499'
        WHEN clob_trade_count_total >= 50 THEN '50-99'
        ELSE '10-49'
      END as trade_bucket,
      count() as wallet_count,
      countIf(clob_trade_count_30d > 0) as active_30d
    FROM ${TABLE_NAME}
    WHERE is_clob_only = 1
    GROUP BY trade_bucket
    ORDER BY
      CASE trade_bucket
        WHEN '1000+' THEN 1
        WHEN '500-999' THEN 2
        WHEN '100-499' THEN 3
        WHEN '50-99' THEN 4
        ELSE 5
      END
  `;

  const activityResult = await clickhouse.query({ query: activityQuery, format: 'JSONEachRow' });
  const activityRows = (await activityResult.json()) as any[];

  console.log('\nCLOB-Only Wallets by Trade Count:');
  console.log('| Trades     | Wallets  | Active 30d |');
  console.log('|------------|----------|------------|');
  for (const row of activityRows) {
    console.log(
      `| ${row.trade_bucket.padEnd(10)} | ${String(row.wallet_count).padStart(8)} | ${String(row.active_30d).padStart(10)} |`
    );
  }

  // Disqualification reasons
  const disqualQuery = `
    SELECT
      CASE
        WHEN split_merge_count > 0 AND erc1155_transfer_count > ${MAX_ERC1155_TRANSFERS} THEN 'Both'
        WHEN split_merge_count > 0 THEN 'Split/Merge only'
        WHEN erc1155_transfer_count > ${MAX_ERC1155_TRANSFERS} THEN 'ERC1155 only'
        ELSE 'Unknown'
      END as reason,
      count() as wallet_count
    FROM ${TABLE_NAME}
    WHERE is_clob_only = 0
    GROUP BY reason
    ORDER BY wallet_count DESC
  `;

  const disqualResult = await clickhouse.query({ query: disqualQuery, format: 'JSONEachRow' });
  const disqualRows = (await disqualResult.json()) as any[];

  console.log('\nNon-CLOB-Only Disqualification Reasons:');
  console.log('| Reason           | Wallets  |');
  console.log('|------------------|----------|');
  for (const row of disqualRows) {
    console.log(`| ${row.reason.padEnd(16)} | ${String(row.wallet_count).padStart(8)} |`);
  }

  console.log('\n' + '='.repeat(80));
}

async function main() {
  const args = process.argv.slice(2);
  const skipCreate = args.includes('--skip-create');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0; // 0 = no limit

  console.log('='.repeat(80));
  console.log('BUILD WALLET CLASSIFICATION TABLE');
  console.log('='.repeat(80));
  console.log(`Skip create: ${skipCreate}`);
  console.log(`Limit: ${limit > 0 ? limit : 'none'}`);
  console.log('');

  const startTime = Date.now();

  // Step 1: Create table
  if (!skipCreate) {
    await createTable();
  }

  // Step 2: Populate classifications
  await populateClassifications(limit);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nClassification complete in ${duration}s`);

  // Step 3: Generate stats
  await generateStats();
}

main().catch(console.error);
