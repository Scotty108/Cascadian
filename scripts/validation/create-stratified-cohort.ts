/**
 * Create pm_validation_wallets_v2: A stratified cohort for fast PnL formula iteration
 *
 * Strategy:
 * - 200 maker-heavy wallets (maker_ratio > 0.7)
 * - 200 taker-heavy wallets (taker_ratio > 0.7)
 * - 200 mixed wallets (0.3 < maker_ratio < 0.7)
 *
 * All from "solvable" pool:
 * - No NegRisk trades
 * - No splits/merges
 * - 20+ trades, $1k+ volume
 *
 * Captures: wallet, maker_ratio, taker_ratio, bundle_ratio, trade_count, volume
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Creating pm_validation_wallets_v2 ===\n');

  // Step 1: Create the table
  console.log('Step 1: Creating table...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_validation_wallets_v2 (
        wallet String,
        cohort_type String,  -- 'maker_heavy', 'taker_heavy', 'mixed'
        maker_ratio Float64,
        taker_ratio Float64,
        bundle_ratio Float64,
        trade_count UInt32,
        volume_usdc Float64,
        created_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree()
      ORDER BY wallet
    `
  });
  console.log('  Table created.\n');

  // Step 2: Find wallets with splits/merges (to exclude)
  console.log('Step 2: Finding wallets to exclude (splits/merges)...');
  const excludeSplitsQuery = `
    SELECT DISTINCT lower(user_address) as wallet
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND event_type IN ('PositionSplit', 'PositionsMerge')
  `;

  // Step 3: Build the solvable candidate pool with metrics
  console.log('Step 3: Building solvable candidate pool with metrics...\n');

  // This query:
  // - Starts from pm_wallets_no_negrisk
  // - Excludes splits/merges
  // - Computes maker_ratio, bundle_ratio
  // - Filters for 20+ trades, $1k+ volume
  const candidateQuery = `
    WITH
      -- Wallets to exclude (have splits/merges)
      excluded_wallets AS (
        SELECT DISTINCT lower(user_address) as wallet
        FROM pm_ctf_events
        WHERE is_deleted = 0
          AND event_type IN ('PositionSplit', 'PositionsMerge')
      ),

      -- Compute metrics per wallet
      wallet_metrics AS (
        SELECT
          lower(trader_wallet) as wallet,
          count() as trade_count,
          sum(usdc_amount) / 1e6 as volume_usdc,
          countIf(role = 'maker') as maker_trades,
          countIf(role = 'taker') as taker_trades,
          -- Bundle ratio: how many of their tx_hashes have multiple fills?
          uniqExact(transaction_hash) as unique_txs,
          count() as total_fills
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) IN (SELECT wallet FROM pm_wallets_no_negrisk)
          AND lower(trader_wallet) NOT IN (SELECT wallet FROM excluded_wallets)
        GROUP BY lower(trader_wallet)
        HAVING trade_count >= 20 AND volume_usdc >= 1000
      ),

      -- Compute bundle counts separately (fills per transaction_hash > 1)
      bundle_counts AS (
        SELECT
          lower(trader_wallet) as wallet,
          countIf(fills > 1) as bundled_txs,
          count() as total_txs
        FROM (
          SELECT trader_wallet, transaction_hash, count() as fills
          FROM pm_trader_events_v3
          WHERE lower(trader_wallet) IN (SELECT wallet FROM wallet_metrics)
          GROUP BY trader_wallet, transaction_hash
        )
        GROUP BY lower(trader_wallet)
      )

    SELECT
      m.wallet,
      m.trade_count,
      m.volume_usdc,
      m.maker_trades / m.trade_count as maker_ratio,
      m.taker_trades / m.trade_count as taker_ratio,
      coalesce(b.bundled_txs / nullIf(b.total_txs, 0), 0) as bundle_ratio
    FROM wallet_metrics m
    LEFT JOIN bundle_counts b ON m.wallet = b.wallet
    ORDER BY m.volume_usdc DESC
  `;

  console.log('  Running candidate query (this may take 1-2 minutes)...');
  const startTime = Date.now();

  const result = await clickhouse.query({
    query: candidateQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });

  const candidates = await result.json() as any[];
  console.log(`  Found ${candidates.length.toLocaleString()} solvable candidates in ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  // Step 4: Stratify into cohorts
  console.log('Step 4: Stratifying into cohorts...');

  const makerHeavy: any[] = [];
  const takerHeavy: any[] = [];
  const mixed: any[] = [];

  for (const w of candidates) {
    const mr = Number(w.maker_ratio);
    const tr = Number(w.taker_ratio);

    if (mr > 0.7 && makerHeavy.length < 200) {
      makerHeavy.push({ ...w, cohort_type: 'maker_heavy' });
    } else if (tr > 0.7 && takerHeavy.length < 200) {
      takerHeavy.push({ ...w, cohort_type: 'taker_heavy' });
    } else if (mr >= 0.3 && mr <= 0.7 && mixed.length < 200) {
      mixed.push({ ...w, cohort_type: 'mixed' });
    }

    // Stop early if we have enough
    if (makerHeavy.length >= 200 && takerHeavy.length >= 200 && mixed.length >= 200) {
      break;
    }
  }

  console.log(`  Maker-heavy: ${makerHeavy.length}`);
  console.log(`  Taker-heavy: ${takerHeavy.length}`);
  console.log(`  Mixed: ${mixed.length}`);

  const cohort = [...makerHeavy, ...takerHeavy, ...mixed];
  console.log(`  Total cohort: ${cohort.length}\n`);

  // Step 5: Insert into table
  console.log('Step 5: Truncating and inserting cohort...');
  await clickhouse.command({ query: 'TRUNCATE TABLE pm_validation_wallets_v2' });

  if (cohort.length > 0) {
    await clickhouse.insert({
      table: 'pm_validation_wallets_v2',
      values: cohort.map(w => ({
        wallet: w.wallet,
        cohort_type: w.cohort_type,
        maker_ratio: Number(w.maker_ratio),
        taker_ratio: Number(w.taker_ratio),
        bundle_ratio: Number(w.bundle_ratio),
        trade_count: Number(w.trade_count),
        volume_usdc: Number(w.volume_usdc)
      })),
      format: 'JSONEachRow'
    });
    console.log(`  Inserted ${cohort.length} wallets.\n`);
  }

  // Step 6: Summary stats
  console.log('=== Cohort Summary ===');
  const summary = await clickhouse.query({
    query: `
      SELECT
        cohort_type,
        count() as cnt,
        round(avg(maker_ratio), 3) as avg_maker_ratio,
        round(avg(bundle_ratio), 3) as avg_bundle_ratio,
        round(avg(trade_count), 0) as avg_trades,
        round(avg(volume_usdc), 0) as avg_volume
      FROM pm_validation_wallets_v2
      GROUP BY cohort_type
      ORDER BY cohort_type
    `,
    format: 'JSONEachRow'
  });

  const summaryRows = await summary.json() as any[];
  console.log('\nCohort Type      | Count | Avg Maker% | Avg Bundle% | Avg Trades | Avg Volume');
  console.log('-'.repeat(85));
  for (const r of summaryRows) {
    console.log(
      `${r.cohort_type.padEnd(16)} | ${String(r.cnt).padStart(5)} | ` +
      `${(Number(r.avg_maker_ratio) * 100).toFixed(1).padStart(9)}% | ` +
      `${(Number(r.avg_bundle_ratio) * 100).toFixed(1).padStart(10)}% | ` +
      `${String(r.avg_trades).padStart(10)} | ` +
      `$${Number(r.avg_volume).toLocaleString()}`
    );
  }

  console.log('\n✅ pm_validation_wallets_v2 ready for fast iteration!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
