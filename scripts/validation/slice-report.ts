/**
 * Slice Report - Analyze error patterns by various dimensions
 *
 * Goal: Understand what factors correlate with PnL calculation errors
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Slice Report: Error Pattern Analysis ===\n');

  // Get calculated PnL
  const calcQuery = `
    WITH
      wallet_trades AS (
        SELECT
          wallet,
          sum(CASE WHEN side = 'sell' THEN usdc_amount / 1e6 ELSE 0 END) as total_sell_usdc,
          sum(CASE WHEN side = 'buy' THEN usdc_amount / 1e6 ELSE 0 END) as total_buy_usdc,
          countIf(side = 'buy') as buy_count,
          countIf(side = 'sell') as sell_count
        FROM pm_validation_fills_norm_v1
        GROUP BY wallet
      ),
      position_values AS (
        SELECT
          f.wallet,
          f.condition_id,
          f.outcome_index,
          sum(CASE WHEN f.side = 'buy' THEN f.token_amount / 1e6 ELSE -f.token_amount / 1e6 END) as net_tokens,
          any(r.payout_numerators) as payout_numerators
        FROM pm_validation_fills_norm_v1 f
        LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        GROUP BY f.wallet, f.condition_id, f.outcome_index
      ),
      wallet_position_value AS (
        SELECT
          wallet,
          sum(
            CASE
              WHEN payout_numerators IS NULL OR payout_numerators = '' THEN 0
              WHEN toInt64OrNull(JSONExtractString(payout_numerators, outcome_index + 1)) = 1 THEN net_tokens
              ELSE 0
            END
          ) as position_value
        FROM position_values
        WHERE net_tokens > 0
        GROUP BY wallet
      )
    SELECT
      t.wallet,
      t.total_sell_usdc - t.total_buy_usdc + coalesce(p.position_value, 0) as calculated_pnl,
      t.total_sell_usdc - t.total_buy_usdc as realized_pnl,
      coalesce(p.position_value, 0) as position_value,
      t.buy_count,
      t.sell_count
    FROM wallet_trades t
    LEFT JOIN wallet_position_value p ON t.wallet = p.wallet
  `;

  const calcResult = await clickhouse.query({ query: calcQuery, format: 'JSONEachRow' });
  const calculated = new Map<string, any>();
  for (const r of await calcResult.json() as any[]) {
    calculated.set(r.wallet, r);
  }

  // Get baseline with metadata
  const baselineQuery = `
    SELECT
      b.wallet,
      b.api_pnl,
      v.cohort_type,
      v.maker_ratio,
      v.trade_count
    FROM pm_pnl_baseline_api_v2 b
    JOIN pm_validation_wallets_v2 v ON b.wallet = v.wallet
  `;
  const baselineResult = await clickhouse.query({ query: baselineQuery, format: 'JSONEachRow' });
  const baseline = await baselineResult.json() as any[];

  // Compute errors and merge data
  const data: any[] = [];
  for (const b of baseline) {
    const c = calculated.get(b.wallet);
    if (!c) continue;

    const error = Number(c.calculated_pnl) - Number(b.api_pnl);
    const absError = Math.abs(error);

    data.push({
      wallet: b.wallet,
      cohort_type: b.cohort_type,
      maker_ratio: Number(b.maker_ratio),
      trade_count: Number(b.trade_count),
      api_pnl: Number(b.api_pnl),
      calculated_pnl: Number(c.calculated_pnl),
      realized_pnl: Number(c.realized_pnl),
      position_value: Number(c.position_value),
      buy_count: Number(c.buy_count),
      sell_count: Number(c.sell_count),
      error,
      absError,
    });
  }

  // Slice 1: By maker_ratio buckets
  console.log('=== Slice 1: By Maker Ratio ===\n');
  const makerBuckets = [
    { name: '0-20% (taker heavy)', min: 0, max: 0.2 },
    { name: '20-40%', min: 0.2, max: 0.4 },
    { name: '40-60% (mixed)', min: 0.4, max: 0.6 },
    { name: '60-80%', min: 0.6, max: 0.8 },
    { name: '80-100% (maker heavy)', min: 0.8, max: 1.01 },
  ];

  console.log('Maker Ratio        | Count | Avg Error     | Median Error  | Within $100 | Within $1000');
  console.log('-'.repeat(95));

  for (const bucket of makerBuckets) {
    const items = data.filter(d => d.maker_ratio >= bucket.min && d.maker_ratio < bucket.max);
    if (items.length === 0) continue;

    items.sort((a, b) => a.absError - b.absError);
    const medianError = items[Math.floor(items.length / 2)].error;
    const avgError = items.reduce((s, d) => s + d.error, 0) / items.length;
    const within100 = items.filter(d => d.absError <= 100).length;
    const within1000 = items.filter(d => d.absError <= 1000).length;

    console.log(
      `${bucket.name.padEnd(18)} | ${String(items.length).padStart(5)} | ` +
      `$${avgError.toFixed(2).padStart(11)} | ` +
      `$${medianError.toFixed(2).padStart(11)} | ` +
      `${String(within100).padStart(11)} | ` +
      `${String(within1000).padStart(12)}`
    );
  }

  // Slice 2: By trade count buckets
  console.log('\n=== Slice 2: By Trade Count ===\n');
  const tradeBuckets = [
    { name: '50-100 trades', min: 50, max: 100 },
    { name: '100-200 trades', min: 100, max: 200 },
    { name: '200-300 trades', min: 200, max: 300 },
    { name: '300-500 trades', min: 300, max: 500 },
  ];

  console.log('Trade Count        | Count | Avg Error     | Median Error  | Within $100 | Within $1000');
  console.log('-'.repeat(95));

  for (const bucket of tradeBuckets) {
    const items = data.filter(d => d.trade_count >= bucket.min && d.trade_count < bucket.max);
    if (items.length === 0) continue;

    items.sort((a, b) => a.absError - b.absError);
    const medianError = items[Math.floor(items.length / 2)].error;
    const avgError = items.reduce((s, d) => s + d.error, 0) / items.length;
    const within100 = items.filter(d => d.absError <= 100).length;
    const within1000 = items.filter(d => d.absError <= 1000).length;

    console.log(
      `${bucket.name.padEnd(18)} | ${String(items.length).padStart(5)} | ` +
      `$${avgError.toFixed(2).padStart(11)} | ` +
      `$${medianError.toFixed(2).padStart(11)} | ` +
      `${String(within100).padStart(11)} | ` +
      `${String(within1000).padStart(12)}`
    );
  }

  // Slice 3: By API PnL magnitude (are we better at small accounts?)
  console.log('\n=== Slice 3: By API PnL Magnitude ===\n');
  const pnlBuckets = [
    { name: 'Loss >$1000', filter: (d: any) => d.api_pnl < -1000 },
    { name: 'Loss $100-1000', filter: (d: any) => d.api_pnl >= -1000 && d.api_pnl < -100 },
    { name: 'Small (<$100)', filter: (d: any) => Math.abs(d.api_pnl) <= 100 },
    { name: 'Gain $100-1000', filter: (d: any) => d.api_pnl > 100 && d.api_pnl <= 1000 },
    { name: 'Gain >$1000', filter: (d: any) => d.api_pnl > 1000 },
  ];

  console.log('API PnL Bucket     | Count | Avg Error     | Median Error  | Within $100 | Within $1000');
  console.log('-'.repeat(95));

  for (const bucket of pnlBuckets) {
    const items = data.filter(bucket.filter);
    if (items.length === 0) continue;

    items.sort((a, b) => a.absError - b.absError);
    const medianError = items[Math.floor(items.length / 2)].error;
    const avgError = items.reduce((s, d) => s + d.error, 0) / items.length;
    const within100 = items.filter(d => d.absError <= 100).length;
    const within1000 = items.filter(d => d.absError <= 1000).length;

    console.log(
      `${bucket.name.padEnd(18)} | ${String(items.length).padStart(5)} | ` +
      `$${avgError.toFixed(2).padStart(11)} | ` +
      `$${medianError.toFixed(2).padStart(11)} | ` +
      `${String(within100).padStart(11)} | ` +
      `${String(within1000).padStart(12)}`
    );
  }

  // Slice 4: Error direction analysis
  console.log('\n=== Slice 4: Error Direction Analysis ===\n');

  const overestimate = data.filter(d => d.error > 100);
  const underestimate = data.filter(d => d.error < -100);
  const accurate = data.filter(d => d.absError <= 100);

  console.log(`Overestimate (calc > api + $100):  ${overestimate.length} wallets (${(overestimate.length/data.length*100).toFixed(1)}%)`);
  console.log(`Underestimate (calc < api - $100): ${underestimate.length} wallets (${(underestimate.length/data.length*100).toFixed(1)}%)`);
  console.log(`Accurate (within $100):            ${accurate.length} wallets (${(accurate.length/data.length*100).toFixed(1)}%)`);

  // Check if overestimates correlate with position_value
  const overWithPosition = overestimate.filter(d => d.position_value > 0);
  const overWithoutPosition = overestimate.filter(d => d.position_value === 0);
  console.log(`\nOverestimates with position value > 0: ${overWithPosition.length}/${overestimate.length}`);
  console.log(`Overestimates with position value = 0: ${overWithoutPosition.length}/${overestimate.length}`);

  // Best tier: maker_ratio > 0.7 AND accurate
  const bestTier = data.filter(d => d.maker_ratio > 0.7 && d.absError <= 100);
  console.log(`\n=== Best Tier (maker > 70% AND error <= $100): ${bestTier.length} wallets ===`);

  if (bestTier.length > 0) {
    const avgMakerRatio = bestTier.reduce((s, d) => s + d.maker_ratio, 0) / bestTier.length;
    const avgTrades = bestTier.reduce((s, d) => s + d.trade_count, 0) / bestTier.length;
    console.log(`  Avg maker ratio: ${(avgMakerRatio * 100).toFixed(1)}%`);
    console.log(`  Avg trade count: ${avgTrades.toFixed(0)}`);
    console.log(`  This is ${(bestTier.length/data.length*100).toFixed(1)}% of validation cohort`);
  }

  console.log('\n✅ Slice report complete');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
