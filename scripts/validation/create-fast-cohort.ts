/**
 * Create FAST validation cohort - wallets with 50-500 trades
 * Target: ~100K fills total for sub-second queries
 *
 * We DON'T want high-volume traders for validation.
 * We want moderate activity wallets where we can iterate quickly.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Creating FAST Validation Cohort ===\n');
  console.log('Goal: 600 wallets × ~100 trades = ~60K fills (sub-second queries)\n');

  // Step 1: Get excluded wallets (splits/merges)
  console.log('Step 1: Getting wallets to exclude...');
  const splitWalletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(user_address) as wallet
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND event_type IN ('PositionSplit', 'PositionsMerge')
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 120 }
  });
  const splitWallets = new Set((await splitWalletsResult.json() as any[]).map(r => r.wallet));
  console.log(`  ${splitWallets.size.toLocaleString()} wallets with splits/merges.\n`);

  // Step 2: Get no-neg-risk wallets
  console.log('Step 2: Getting no-neg-risk wallets...');
  const noNegRiskResult = await clickhouse.query({
    query: 'SELECT wallet FROM pm_wallets_no_negrisk',
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 60 }
  });
  const noNegRiskWallets = new Set((await noNegRiskResult.json() as any[]).map(r => r.wallet));
  console.log(`  ${noNegRiskWallets.size.toLocaleString()} wallets with no neg-risk.\n`);

  // Step 3: Find solvable wallets
  const solvableWallets = new Set<string>();
  for (const w of noNegRiskWallets) {
    if (!splitWallets.has(w)) {
      solvableWallets.add(w);
    }
  }
  console.log(`Step 3: ${solvableWallets.size.toLocaleString()} solvable wallets.\n`);

  // Step 4: Get wallet metrics - FILTER FOR SMALL TRADERS (50-500 trades)
  console.log('Step 4: Finding moderate-activity wallets (50-500 trades)...');

  const allMetrics: any[] = [];
  const prefixes = '0123456789abcdef'.split('');

  for (const prefix of prefixes) {
    const query = `
      SELECT
        lower(trader_wallet) as wallet,
        count() as trade_count,
        sum(usdc_amount) / 1e6 as volume_usdc,
        countIf(role = 'maker') as maker_trades,
        countIf(role = 'taker') as taker_trades
      FROM pm_trader_events_v3
      WHERE substring(lower(trader_wallet), 3, 1) = '${prefix}'
      GROUP BY lower(trader_wallet)
      HAVING trade_count >= 50 AND trade_count <= 500 AND volume_usdc >= 500
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 120 }
    });
    const rows = await result.json() as any[];

    for (const r of rows) {
      if (solvableWallets.has(r.wallet)) {
        allMetrics.push(r);
      }
    }

    process.stdout.write(`  Prefix ${prefix}: ${allMetrics.length} solvable\r`);
  }
  console.log(`\n  Found ${allMetrics.length.toLocaleString()} wallets with 50-500 trades.\n`);

  // Step 5: Stratify - no bundle ratio needed for small wallets, just maker/taker
  console.log('Step 5: Stratifying (200 maker, 200 taker, 200 mixed)...');

  // Shuffle to get variety
  allMetrics.sort(() => Math.random() - 0.5);

  const makerHeavy: any[] = [];
  const takerHeavy: any[] = [];
  const mixed: any[] = [];

  for (const w of allMetrics) {
    const mr = Number(w.maker_trades) / Number(w.trade_count);

    if (mr > 0.7 && makerHeavy.length < 200) {
      makerHeavy.push({ ...w, cohort_type: 'maker_heavy', maker_ratio: mr });
    } else if (mr < 0.3 && takerHeavy.length < 200) {
      takerHeavy.push({ ...w, cohort_type: 'taker_heavy', maker_ratio: mr });
    } else if (mr >= 0.3 && mr <= 0.7 && mixed.length < 200) {
      mixed.push({ ...w, cohort_type: 'mixed', maker_ratio: mr });
    }

    if (makerHeavy.length >= 200 && takerHeavy.length >= 200 && mixed.length >= 200) break;
  }

  console.log(`  Maker-heavy: ${makerHeavy.length}`);
  console.log(`  Taker-heavy: ${takerHeavy.length}`);
  console.log(`  Mixed: ${mixed.length}`);

  const cohort = [...makerHeavy, ...takerHeavy, ...mixed];
  const expectedFills = cohort.reduce((sum, w) => sum + Number(w.trade_count), 0);
  console.log(`  Total: ${cohort.length} wallets (~${expectedFills.toLocaleString()} expected fills)\n`);

  // Step 6: Recreate tables
  console.log('Step 6: Recreating pm_validation_wallets_v2...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_validation_wallets_v2' });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_validation_wallets_v2 (
        wallet String,
        cohort_type String,
        maker_ratio Float64,
        trade_count UInt32,
        volume_usdc Float64,
        created_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree()
      ORDER BY wallet
    `
  });

  await clickhouse.insert({
    table: 'pm_validation_wallets_v2',
    values: cohort.map(w => ({
      wallet: w.wallet,
      cohort_type: w.cohort_type,
      maker_ratio: w.maker_ratio,
      trade_count: Number(w.trade_count),
      volume_usdc: Number(w.volume_usdc)
    })),
    format: 'JSONEachRow'
  });
  console.log('  Done.\n');

  // Step 7: Create fills table
  console.log('Step 7: Creating pm_validation_fills_norm_v1...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_validation_fills_norm_v1' });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_validation_fills_norm_v1 (
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

  // Insert fills in small batches
  const walletList = cohort.map(w => `'${w.wallet}'`).join(',');

  console.log('  Inserting fills (single query for ~60K rows)...');
  await clickhouse.command({
    query: `
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
    `,
    clickhouse_settings: { max_execution_time: 300 }
  });

  // Final counts
  const finalCount = await clickhouse.query({
    query: 'SELECT count() as c FROM pm_validation_fills_norm_v1',
    format: 'JSONEachRow'
  });
  const fills = Number((await finalCount.json() as any[])[0].c);

  console.log('\n=== FAST Validation Cohort Ready ===\n');
  console.log(`Wallets: ${cohort.length}`);
  console.log(`Fills: ${fills.toLocaleString()}`);
  console.log(`Avg fills/wallet: ${Math.round(fills / cohort.length)}`);
  console.log('\n✅ This should give sub-second query times!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
