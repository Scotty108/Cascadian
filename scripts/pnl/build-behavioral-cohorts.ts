#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * BUILD BEHAVIORAL COHORTS
 * ============================================================================
 *
 * Analyzes 474 high-confidence wallets to extract behavioral features:
 * - count_redemption
 * - count_clob_sell
 * - count_split
 * - count_merge
 * - total_conditions_traded
 * - avg_trades_per_condition
 *
 * Then correlates these with V29 vs Dome error to identify which archetypes fail.
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';

interface ValidationRow {
  wallet: string;
  v29_realized: number;
  dome_realized: number;
  abs_error_usd: number;
  pct_error_safe: number;
  confidence: string;
}

interface BehavioralFeatures {
  wallet: string;
  // From validation
  v29_realized: number;
  dome_realized: number;
  abs_error_usd: number;
  pct_error_safe: number;
  sign_disagree: boolean;
  // Behavioral counts
  count_clob_buy: number;
  count_clob_sell: number;
  count_redemption: number;
  count_split: number;
  count_merge: number;
  total_conditions: number;
  total_events: number;
  avg_events_per_condition: number;
  // Derived ratios
  sell_ratio: number;  // sells / (buys + sells)
  redemption_ratio: number;  // redemptions / total_events
  split_merge_ratio: number;  // (splits + merges) / total_events
}

async function main() {
  const client = getClickHouseClient();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   BUILD BEHAVIORAL COHORTS');
  console.log('════════════════════════════════════════════════════════════\n');

  // Load validation results
  const validationData = JSON.parse(
    fs.readFileSync('tmp/v29_vs_dome_500_full_validation.json', 'utf8')
  );
  const highConfidence = (validationData.rows as ValidationRow[])
    .filter(r => r.confidence === 'high');

  console.log(`📊 Loaded ${highConfidence.length} high-confidence validation results\n`);

  // Extract wallet list
  const wallets = highConfidence.map(r => r.wallet.toLowerCase());

  // Build validation lookup
  const validationMap = new Map<string, ValidationRow>();
  for (const r of highConfidence) {
    validationMap.set(r.wallet.toLowerCase(), r);
  }

  // Query behavioral features from unified ledger
  console.log('🔍 Querying behavioral features from pm_unified_ledger_v8...\n');

  const query = `
    SELECT
      lower(wallet_address) as wallet,
      -- Event type counts
      countIf(event_type = 'CLOB_BUY') as count_clob_buy,
      countIf(event_type = 'CLOB_SELL') as count_clob_sell,
      countIf(event_type = 'REDEEM') as count_redemption,
      countIf(event_type = 'SPLIT') as count_split,
      countIf(event_type = 'MERGE') as count_merge,
      -- Totals
      uniqExact(condition_id) as total_conditions,
      count() as total_events
    FROM pm_unified_ledger_v8
    WHERE lower(wallet_address) IN (${wallets.map(w => `'${w}'`).join(',')})
    GROUP BY lower(wallet_address)
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const behaviorRows = await result.json<Array<{
    wallet: string;
    count_clob_buy: string;
    count_clob_sell: string;
    count_redemption: string;
    count_split: string;
    count_merge: string;
    total_conditions: string;
    total_events: string;
  }>>();

  console.log(`✅ Got behavioral data for ${behaviorRows.length} wallets\n`);

  // Build combined features
  const features: BehavioralFeatures[] = [];

  for (const b of behaviorRows) {
    const v = validationMap.get(b.wallet);
    if (!v) continue;

    const countBuy = parseInt(b.count_clob_buy);
    const countSell = parseInt(b.count_clob_sell);
    const countRedemption = parseInt(b.count_redemption);
    const countSplit = parseInt(b.count_split);
    const countMerge = parseInt(b.count_merge);
    const totalConditions = parseInt(b.total_conditions);
    const totalEvents = parseInt(b.total_events);

    features.push({
      wallet: b.wallet,
      v29_realized: v.v29_realized,
      dome_realized: v.dome_realized,
      abs_error_usd: v.abs_error_usd,
      pct_error_safe: v.pct_error_safe,
      sign_disagree: (v.v29_realized > 0 && v.dome_realized < 0) ||
                     (v.v29_realized < 0 && v.dome_realized > 0),
      count_clob_buy: countBuy,
      count_clob_sell: countSell,
      count_redemption: countRedemption,
      count_split: countSplit,
      count_merge: countMerge,
      total_conditions: totalConditions,
      total_events: totalEvents,
      avg_events_per_condition: totalConditions > 0 ? totalEvents / totalConditions : 0,
      sell_ratio: (countBuy + countSell) > 0 ? countSell / (countBuy + countSell) : 0,
      redemption_ratio: totalEvents > 0 ? countRedemption / totalEvents : 0,
      split_merge_ratio: totalEvents > 0 ? (countSplit + countMerge) / totalEvents : 0,
    });
  }

  console.log(`📊 Built features for ${features.length} wallets\n`);

  // Analyze by behavioral cohorts
  console.log('════════════════════════════════════════════════════════════');
  console.log('   ERROR CORRELATION BY BEHAVIORAL FEATURE');
  console.log('════════════════════════════════════════════════════════════\n');

  // 1. By redemption presence
  const hasRedemptions = features.filter(f => f.count_redemption > 0);
  const noRedemptions = features.filter(f => f.count_redemption === 0);

  console.log('BY REDEMPTION PRESENCE:');
  console.log(`  Has redemptions (${hasRedemptions.length}): Median err $${median(hasRedemptions.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${hasRedemptions.filter(f => f.sign_disagree).length} (${(hasRedemptions.filter(f => f.sign_disagree).length/hasRedemptions.length*100).toFixed(1)}%)`);
  console.log(`  No redemptions (${noRedemptions.length}):  Median err $${median(noRedemptions.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${noRedemptions.filter(f => f.sign_disagree).length} (${(noRedemptions.filter(f => f.sign_disagree).length/noRedemptions.length*100).toFixed(1)}%)`);

  // 2. By split/merge presence
  const hasSplitMerge = features.filter(f => f.count_split > 0 || f.count_merge > 0);
  const noSplitMerge = features.filter(f => f.count_split === 0 && f.count_merge === 0);

  console.log('\nBY SPLIT/MERGE PRESENCE:');
  console.log(`  Has split/merge (${hasSplitMerge.length}): Median err $${median(hasSplitMerge.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${hasSplitMerge.filter(f => f.sign_disagree).length} (${(hasSplitMerge.filter(f => f.sign_disagree).length/hasSplitMerge.length*100).toFixed(1)}%)`);
  console.log(`  No split/merge (${noSplitMerge.length}):  Median err $${median(noSplitMerge.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${noSplitMerge.filter(f => f.sign_disagree).length} (${(noSplitMerge.filter(f => f.sign_disagree).length/noSplitMerge.length*100).toFixed(1)}%)`);

  // 3. By sell ratio (high sellers vs low sellers)
  const highSellers = features.filter(f => f.sell_ratio > 0.4);
  const lowSellers = features.filter(f => f.sell_ratio <= 0.4);

  console.log('\nBY SELL RATIO (>40% sells vs <=40%):');
  console.log(`  High sellers (${highSellers.length}): Median err $${median(highSellers.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${highSellers.filter(f => f.sign_disagree).length} (${(highSellers.filter(f => f.sign_disagree).length/highSellers.length*100).toFixed(1)}%)`);
  console.log(`  Low sellers (${lowSellers.length}):  Median err $${median(lowSellers.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${lowSellers.filter(f => f.sign_disagree).length} (${(lowSellers.filter(f => f.sign_disagree).length/lowSellers.length*100).toFixed(1)}%)`);

  // 4. By complexity (conditions traded)
  const simple = features.filter(f => f.total_conditions <= 10);
  const medium = features.filter(f => f.total_conditions > 10 && f.total_conditions <= 50);
  const complex = features.filter(f => f.total_conditions > 50);

  console.log('\nBY COMPLEXITY (conditions traded):');
  console.log(`  Simple (<=10) (${simple.length}):  Median err $${median(simple.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${simple.filter(f => f.sign_disagree).length} (${(simple.filter(f => f.sign_disagree).length/simple.length*100).toFixed(1)}%)`);
  console.log(`  Medium (11-50) (${medium.length}): Median err $${median(medium.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${medium.filter(f => f.sign_disagree).length} (${(medium.filter(f => f.sign_disagree).length/medium.length*100).toFixed(1)}%)`);
  console.log(`  Complex (>50) (${complex.length}): Median err $${median(complex.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${complex.filter(f => f.sign_disagree).length} (${(complex.filter(f => f.sign_disagree).length/complex.length*100).toFixed(1)}%)`);

  // 5. Combined: high split/merge + high redemption
  const mixedComplex = features.filter(f =>
    (f.count_split > 0 || f.count_merge > 0) && f.count_redemption > 10
  );
  const pureClob = features.filter(f =>
    f.count_split === 0 && f.count_merge === 0 && f.count_redemption === 0
  );

  console.log('\nMIXED COMPLEXITY vs PURE CLOB:');
  if (mixedComplex.length > 0) {
    console.log(`  Mixed (split/merge + redemptions>10) (${mixedComplex.length}): Median err $${median(mixedComplex.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${mixedComplex.filter(f => f.sign_disagree).length} (${(mixedComplex.filter(f => f.sign_disagree).length/mixedComplex.length*100).toFixed(1)}%)`);
  }
  if (pureClob.length > 0) {
    console.log(`  Pure CLOB only (${pureClob.length}):  Median err $${median(pureClob.map(f => f.abs_error_usd)).toFixed(0)}, Sign flip ${pureClob.filter(f => f.sign_disagree).length} (${(pureClob.filter(f => f.sign_disagree).length/pureClob.length*100).toFixed(1)}%)`);
  }

  // Find worst performers with their behavioral profile
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   TOP 10 WORST WALLETS WITH BEHAVIORAL PROFILE');
  console.log('════════════════════════════════════════════════════════════\n');

  const worst = [...features].sort((a, b) => b.abs_error_usd - a.abs_error_usd).slice(0, 10);

  console.log('Wallet                                     | Abs Err     | Sign | Buys  | Sells | Redeem | Split | Merge | Conds');
  console.log('-------------------------------------------|-------------|------|-------|-------|--------|-------|-------|------');
  for (const w of worst) {
    const sign = w.sign_disagree ? 'FLIP' : '  ok';
    console.log(
      `${w.wallet} | $${w.abs_error_usd.toFixed(0).padStart(9)} | ${sign} | ${String(w.count_clob_buy).padStart(5)} | ${String(w.count_clob_sell).padStart(5)} | ${String(w.count_redemption).padStart(6)} | ${String(w.count_split).padStart(5)} | ${String(w.count_merge).padStart(5)} | ${String(w.total_conditions).padStart(5)}`
    );
  }

  // Best performers
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('   TOP 10 BEST WALLETS WITH BEHAVIORAL PROFILE');
  console.log('════════════════════════════════════════════════════════════\n');

  const best = [...features].sort((a, b) => a.abs_error_usd - b.abs_error_usd).slice(0, 10);

  console.log('Wallet                                     | Abs Err     | Sign | Buys  | Sells | Redeem | Split | Merge | Conds');
  console.log('-------------------------------------------|-------------|------|-------|-------|--------|-------|-------|------');
  for (const w of best) {
    const sign = w.sign_disagree ? 'FLIP' : '  ok';
    console.log(
      `${w.wallet} | $${w.abs_error_usd.toFixed(2).padStart(9)} | ${sign} | ${String(w.count_clob_buy).padStart(5)} | ${String(w.count_clob_sell).padStart(5)} | ${String(w.count_redemption).padStart(6)} | ${String(w.count_split).padStart(5)} | ${String(w.count_merge).padStart(5)} | ${String(w.total_conditions).padStart(5)}`
    );
  }

  // Save full features for further analysis
  fs.writeFileSync(
    'tmp/behavioral_cohorts_474.json',
    JSON.stringify({ generated_at: new Date().toISOString(), features }, null, 2)
  );
  console.log('\n✅ Saved to tmp/behavioral_cohorts_474.json\n');
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
