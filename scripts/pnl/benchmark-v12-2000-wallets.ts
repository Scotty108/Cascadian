#!/usr/bin/env npx tsx
/**
 * V12 TIER A BENCHMARK - 2000 WALLETS
 * ============================================================================
 *
 * Expands the Tier A benchmark to 2,000 wallets with mixed sampling:
 * - 1,000 top by CLOB volume
 * - 1,000 random sample
 *
 * This is the confidence step before building the full metrics engine.
 *
 * USAGE:
 *   npx tsx scripts/pnl/benchmark-v12-2000-wallets.ts
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 600000,
});

// ============================================================================
// V12 Synthetic Realized Calculator
// ============================================================================

async function computeV12Realized(wallet: string): Promise<{
  pnl: number;
  events: number;
  resolved: number;
  unresolved: number;
  unresolvedUsdcSpent: number;
}> {
  const query = `
    SELECT
      sumIf(
        d.usdc_delta + d.token_delta * arrayElement(res.norm_prices, toInt32(m.outcome_index + 1)),
        res.raw_numerators IS NOT NULL
        AND res.raw_numerators != ''
        AND length(res.norm_prices) > 0
        AND m.outcome_index IS NOT NULL
      ) as realized_pnl,
      countIf(res.raw_numerators IS NOT NULL AND res.raw_numerators != '' AND length(res.norm_prices) > 0) as resolved_events,
      countIf(res.raw_numerators IS NULL OR res.raw_numerators = '' OR length(res.norm_prices) = 0) as unresolved_events,
      count(*) as total_events,
      sumIf(abs(d.usdc_delta), res.raw_numerators IS NULL OR res.raw_numerators = '' OR length(res.norm_prices) = 0) as unresolved_usdc_spent
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as tok_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    ) d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.tok_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions_norm res ON m.condition_id = res.condition_id
  `;

  const result = await ch.query({
    query,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const data = (await result.json<any[]>())[0];

  return {
    pnl: Number(data.realized_pnl) || 0,
    events: Number(data.total_events) || 0,
    resolved: Number(data.resolved_events) || 0,
    unresolved: Number(data.unresolved_events) || 0,
    unresolvedUsdcSpent: Number(data.unresolved_usdc_spent) || 0
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');

  console.log('═'.repeat(80));
  console.log('V12 TIER A BENCHMARK - 2000 WALLETS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Sampling strategy:');
  console.log('  - 1,000 top wallets by CLOB volume');
  console.log('  - 1,000 random sample from remaining Tier A');
  console.log('');

  // Step 1: Get top 1000 by volume
  console.log('Step 1: Fetching top 1000 by CLOB volume...');
  const topQuery = await ch.query({
    query: `
      SELECT wallet_address
      FROM trader_strict_classifier_v1
      WHERE tier = 'A'
      ORDER BY clob_usdc_volume DESC
      LIMIT 1000
    `,
    format: 'JSONEachRow'
  });
  const topWallets = (await topQuery.json<any[]>()).map(r => r.wallet_address);
  console.log(`  Got ${topWallets.length} top wallets`);

  // Step 2: Get random 1000 from remaining
  console.log('Step 2: Fetching random 1000 from remaining Tier A...');
  const randomQuery = await ch.query({
    query: `
      SELECT wallet_address
      FROM trader_strict_classifier_v1
      WHERE tier = 'A'
        AND wallet_address NOT IN (
          SELECT wallet_address
          FROM trader_strict_classifier_v1
          WHERE tier = 'A'
          ORDER BY clob_usdc_volume DESC
          LIMIT 1000
        )
      ORDER BY rand()
      LIMIT 1000
    `,
    format: 'JSONEachRow'
  });
  const randomWallets = (await randomQuery.json<any[]>()).map(r => r.wallet_address);
  console.log(`  Got ${randomWallets.length} random wallets`);

  const allWallets = [...topWallets, ...randomWallets];
  console.log(`\nTotal wallets to benchmark: ${allWallets.length}`);
  console.log('');

  // Step 3: Compute V12 for all wallets
  console.log('Step 3: Computing V12 Synthetic Realized...');
  console.log('-'.repeat(80));

  const results: {
    wallet: string;
    sample_type: 'top' | 'random';
    v12_realized_pnl: number;
    event_count: number;
    resolved_events: number;
    unresolved_events: number;
    unresolved_pct: number;
    unresolved_usdc_spent: number;
    is_comparable: boolean;
  }[] = [];

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < allWallets.length; i++) {
    const wallet = allWallets[i];
    const sampleType = i < topWallets.length ? 'top' : 'random';

    try {
      const computed = await computeV12Realized(wallet);

      const unresolvedPct = computed.events > 0
        ? (computed.unresolved / computed.events) * 100
        : 0;

      const isComparable = unresolvedPct < 50;

      results.push({
        wallet,
        sample_type: sampleType,
        v12_realized_pnl: Math.round(computed.pnl * 100) / 100,
        event_count: computed.events,
        resolved_events: computed.resolved,
        unresolved_events: computed.unresolved,
        unresolved_pct: Math.round(unresolvedPct * 10) / 10,
        unresolved_usdc_spent: Math.round(computed.unresolvedUsdcSpent * 100) / 100,
        is_comparable: isComparable
      });

      if (isComparable) {
        successCount++;
      } else {
        skipCount++;
      }

      // Progress
      if ((i + 1) % 100 === 0) {
        console.log(`[${(i + 1).toString().padStart(4)}/${allWallets.length}] Processed...`);
      }
    } catch (err: any) {
      console.log(`[${(i + 1).toString().padStart(4)}/${allWallets.length}] ERROR: ${wallet.slice(0, 20)}... - ${err.message}`);
      failCount++;
    }
  }

  console.log('-'.repeat(80));
  console.log('');

  // Step 4: Compute statistics
  const comparable = results.filter(r => r.is_comparable);
  const unresolvedPcts = results.map(r => r.unresolved_pct).sort((a, b) => a - b);
  const medianUnres = unresolvedPcts[Math.floor(unresolvedPcts.length / 2)] || 0;
  const avgUnres = results.reduce((s, r) => s + r.unresolved_pct, 0) / results.length;
  const over50 = results.filter(r => r.unresolved_pct >= 50).length;

  // PnL distribution
  const pnls = results.map(r => r.v12_realized_pnl).sort((a, b) => a - b);
  const profitable = results.filter(r => r.v12_realized_pnl > 0).length;
  const unprofitable = results.filter(r => r.v12_realized_pnl <= 0).length;
  const totalPnl = results.reduce((s, r) => s + r.v12_realized_pnl, 0);

  // By sample type
  const topResults = results.filter(r => r.sample_type === 'top');
  const randomResults = results.filter(r => r.sample_type === 'random');

  console.log('═'.repeat(80));
  console.log('BENCHMARK SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Overall:');
  console.log(`  Total wallets: ${results.length}`);
  console.log(`  Successful computations: ${results.length} (${((results.length / allWallets.length) * 100).toFixed(1)}%)`);
  console.log(`  Comparable (<50% unresolved): ${comparable.length} (${((comparable.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Skipped (>50% unresolved): ${over50}`);
  console.log('');
  console.log('Unresolved Distribution:');
  console.log(`  Median: ${medianUnres.toFixed(1)}%`);
  console.log(`  Average: ${avgUnres.toFixed(1)}%`);
  console.log(`  Min: ${unresolvedPcts[0]?.toFixed(1) || 0}%`);
  console.log(`  Max: ${unresolvedPcts[unresolvedPcts.length - 1]?.toFixed(1) || 0}%`);
  console.log('');
  console.log('PnL Distribution:');
  console.log(`  Profitable: ${profitable} (${((profitable / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Unprofitable: ${unprofitable} (${((unprofitable / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Total PnL: $${totalPnl.toLocaleString()}`);
  console.log(`  Min: $${pnls[0]?.toLocaleString() || 0}`);
  console.log(`  Max: $${pnls[pnls.length - 1]?.toLocaleString() || 0}`);
  console.log('');
  console.log('By Sample Type:');
  console.log(`  Top 1000 (by volume): ${topResults.length} wallets`);
  console.log(`    Avg unresolved: ${(topResults.reduce((s, r) => s + r.unresolved_pct, 0) / topResults.length).toFixed(1)}%`);
  console.log(`    Total PnL: $${topResults.reduce((s, r) => s + r.v12_realized_pnl, 0).toLocaleString()}`);
  console.log(`  Random 1000: ${randomResults.length} wallets`);
  console.log(`    Avg unresolved: ${(randomResults.reduce((s, r) => s + r.unresolved_pct, 0) / randomResults.length).toFixed(1)}%`);
  console.log(`    Total PnL: $${randomResults.reduce((s, r) => s + r.v12_realized_pnl, 0).toLocaleString()}`);
  console.log('');

  // Step 5: Save results
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      formula_version: 'V12 Synthetic Realized',
      sampling: {
        top_by_volume: topWallets.length,
        random_sample: randomWallets.length,
        total: allWallets.length
      }
    },
    stats: {
      total_wallets: results.length,
      successful: results.length,
      comparable: comparable.length,
      over_50_unresolved: over50,
      median_unresolved_pct: medianUnres,
      avg_unresolved_pct: avgUnres,
      profitable: profitable,
      unprofitable: unprofitable,
      total_pnl: totalPnl
    },
    results
  };

  const outputFile = `tmp/v12_tierA_benchmark_2000_${dateStr}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${outputFile}`);

  await ch.close();
}

main().catch(console.error);
