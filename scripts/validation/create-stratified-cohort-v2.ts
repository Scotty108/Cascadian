/**
 * Create pm_validation_wallets_v2: A stratified cohort for fast PnL formula iteration
 *
 * Broken into multiple steps to avoid timeout
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Creating pm_validation_wallets_v2 (Step-by-step) ===\n');

  // Step 1: Create the table
  console.log('Step 1: Creating table...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_validation_wallets_v2 (
        wallet String,
        cohort_type String,
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
  console.log('  Done.\n');

  // Step 2: Get wallets with splits/merges (to exclude)
  console.log('Step 2: Getting wallets with splits/merges...');
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
  console.log(`  ${splitWallets.size.toLocaleString()} wallets have splits/merges.\n`);

  // Step 3: Get no-neg-risk wallets
  console.log('Step 3: Getting no-neg-risk wallets...');
  const noNegRiskResult = await clickhouse.query({
    query: 'SELECT wallet FROM pm_wallets_no_negrisk',
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 60 }
  });
  const noNegRiskWallets = new Set((await noNegRiskResult.json() as any[]).map(r => r.wallet));
  console.log(`  ${noNegRiskWallets.size.toLocaleString()} wallets have no neg-risk.\n`);

  // Step 4: Find clean solvable wallets (intersection minus splits)
  console.log('Step 4: Finding clean solvable wallets...');
  const solvableWallets = new Set<string>();
  for (const w of noNegRiskWallets) {
    if (!splitWallets.has(w)) {
      solvableWallets.add(w);
    }
  }
  console.log(`  ${solvableWallets.size.toLocaleString()} wallets are solvable (no neg-risk, no splits).\n`);

  // Step 5: Get wallet metrics for solvable wallets
  // Do this in batches by wallet prefix to avoid timeout
  console.log('Step 5: Getting wallet metrics (by prefix)...');

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
      HAVING trade_count >= 20 AND volume_usdc >= 1000
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 120 }
    });
    const rows = await result.json() as any[];

    // Filter to only solvable wallets
    for (const r of rows) {
      if (solvableWallets.has(r.wallet)) {
        allMetrics.push(r);
      }
    }

    process.stdout.write(`  Prefix ${prefix}: ${rows.length} active, ${allMetrics.length} solvable total\r`);
  }
  console.log(`\n  Found ${allMetrics.length.toLocaleString()} solvable wallets with 20+ trades, $1k+ volume.\n`);

  // Step 6: Compute bundle ratio for these wallets (sample if too many)
  console.log('Step 6: Computing bundle ratios...');

  // Take top 2000 by volume to keep it manageable
  allMetrics.sort((a, b) => Number(b.volume_usdc) - Number(a.volume_usdc));
  const topWallets = allMetrics.slice(0, 2000);

  // Get bundle counts in batches
  const walletBundles = new Map<string, { bundled_txs: number; total_txs: number }>();
  const batchSize = 100;

  for (let i = 0; i < topWallets.length; i += batchSize) {
    const batch = topWallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w.wallet}'`).join(',');

    const bundleQuery = `
      SELECT
        lower(trader_wallet) as wallet,
        countIf(fills > 1) as bundled_txs,
        count() as total_txs
      FROM (
        SELECT trader_wallet, transaction_hash, count() as fills
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) IN (${walletList})
        GROUP BY trader_wallet, transaction_hash
      )
      GROUP BY lower(trader_wallet)
    `;

    const bundleResult = await clickhouse.query({
      query: bundleQuery,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 60 }
    });

    for (const r of await bundleResult.json() as any[]) {
      walletBundles.set(r.wallet, {
        bundled_txs: Number(r.bundled_txs),
        total_txs: Number(r.total_txs)
      });
    }

    process.stdout.write(`  Processed ${Math.min(i + batchSize, topWallets.length)}/${topWallets.length} wallets\r`);
  }
  console.log('\n');

  // Step 7: Enrich metrics with bundle ratio and stratify
  console.log('Step 7: Stratifying into cohorts...');

  const enrichedWallets = topWallets.map(w => {
    const bundle = walletBundles.get(w.wallet) || { bundled_txs: 0, total_txs: 1 };
    const maker_ratio = Number(w.maker_trades) / Number(w.trade_count);
    const taker_ratio = Number(w.taker_trades) / Number(w.trade_count);
    const bundle_ratio = bundle.bundled_txs / Math.max(bundle.total_txs, 1);

    return {
      wallet: w.wallet,
      maker_ratio,
      taker_ratio,
      bundle_ratio,
      trade_count: Number(w.trade_count),
      volume_usdc: Number(w.volume_usdc)
    };
  });

  // Stratify
  const makerHeavy: any[] = [];
  const takerHeavy: any[] = [];
  const mixed: any[] = [];

  for (const w of enrichedWallets) {
    if (w.maker_ratio > 0.7 && makerHeavy.length < 200) {
      makerHeavy.push({ ...w, cohort_type: 'maker_heavy' });
    } else if (w.taker_ratio > 0.7 && takerHeavy.length < 200) {
      takerHeavy.push({ ...w, cohort_type: 'taker_heavy' });
    } else if (w.maker_ratio >= 0.3 && w.maker_ratio <= 0.7 && mixed.length < 200) {
      mixed.push({ ...w, cohort_type: 'mixed' });
    }
  }

  console.log(`  Maker-heavy: ${makerHeavy.length}`);
  console.log(`  Taker-heavy: ${takerHeavy.length}`);
  console.log(`  Mixed: ${mixed.length}`);

  const cohort = [...makerHeavy, ...takerHeavy, ...mixed];
  console.log(`  Total cohort: ${cohort.length}\n`);

  // Step 8: Insert into table
  console.log('Step 8: Inserting into pm_validation_wallets_v2...');
  await clickhouse.command({ query: 'TRUNCATE TABLE pm_validation_wallets_v2' });

  if (cohort.length > 0) {
    await clickhouse.insert({
      table: 'pm_validation_wallets_v2',
      values: cohort,
      format: 'JSONEachRow'
    });
    console.log(`  Inserted ${cohort.length} wallets.\n`);
  }

  // Step 9: Summary
  console.log('=== Cohort Summary ===\n');
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
  console.log('Cohort Type      | Count | Avg Maker% | Avg Bundle% | Avg Trades | Avg Volume');
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

  console.log('\n✅ pm_validation_wallets_v2 ready!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
