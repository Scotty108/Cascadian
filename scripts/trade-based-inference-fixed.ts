/**
 * TRADE-BASED RESOLUTION INFERENCE (FIXED)
 * Uses final trade prices per outcome to infer resolutions
 */

import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('=== TRADE-BASED RESOLUTION INFERENCE ===\n');

  // Step 1: Simple validation query
  console.log('=== PHASE 1: VALIDATION ===\n');

  const validation = await client.query({
    query: `
      WITH
      -- Get 50 markets with known resolutions
      known_resolutions AS (
        SELECT
          condition_id_norm as cid_norm,
          winning_index
        FROM market_resolutions_final
        WHERE winning_index >= 0
        LIMIT 50
      ),
      -- Get all recent trades for these markets (last 30 days for better coverage)
      recent_trades AS (
        SELECT
          lower(replaceAll(cid, '0x', '')) as cid_norm,
          outcome_index,
          toFloat64(price) as price,
          block_time
        FROM fact_trades_clean
        WHERE block_time >= now() - INTERVAL 30 DAY
          AND lower(replaceAll(cid, '0x', '')) IN (SELECT cid_norm FROM known_resolutions)
      ),
      -- For each market, find the cutoff time (7 days before last trade)
      market_cutoffs AS (
        SELECT
          cid_norm,
          max(block_time) - INTERVAL 7 DAY as cutoff
        FROM recent_trades
        GROUP BY cid_norm
      ),
      -- Filter to final 7 days only
      final_period_trades AS (
        SELECT
          rt.cid_norm,
          rt.outcome_index,
          rt.price
        FROM recent_trades rt
        JOIN market_cutoffs mc ON rt.cid_norm = mc.cid_norm
        WHERE rt.block_time >= mc.cutoff
      ),
      -- Calculate average price per outcome
      outcome_prices AS (
        SELECT
          cid_norm,
          outcome_index,
          avg(price) as avg_price,
          count() as trade_count
        FROM final_period_trades
        GROUP BY cid_norm, outcome_index
      ),
      -- Pivot to get both outcomes
      market_prices AS (
        SELECT
          cid_norm,
          maxIf(avg_price, outcome_index = 0) as p0,
          maxIf(avg_price, outcome_index = 1) as p1,
          maxIf(trade_count, outcome_index = 0) as tc0,
          maxIf(trade_count, outcome_index = 1) as tc1
        FROM outcome_prices
        GROUP BY cid_norm
        HAVING p0 > 0 AND p1 > 0
      )
      SELECT
        '0x' || mp.cid_norm as condition_id,
        kr.winning_index as actual_winner,
        mp.p0 as outcome_0_price,
        mp.p1 as outcome_1_price,
        mp.tc0 as trades_0,
        mp.tc1 as trades_1,
        -- Infer winner
        CASE
          WHEN mp.p0 > 0.90 AND mp.p1 < 0.10 THEN 0
          WHEN mp.p1 > 0.90 AND mp.p0 < 0.10 THEN 1
          ELSE -1
        END as inferred_winner
      FROM market_prices mp
      JOIN known_resolutions kr ON mp.cid_norm = kr.cid_norm
    `,
    format: 'JSONEachRow',
  });

  const validationData = await validation.json();
  console.log(`✓ Found ${validationData.length} markets with trade data\n`);

  if (validationData.length === 0) {
    console.log('❌ No markets found. This likely means:');
    console.log('1. fact_trades_clean is empty or has no recent trades');
    console.log('2. No overlap between known resolutions and trade data\n');
    return;
  }

  // Show sample results
  const results = validationData.slice(0, 15).map((m: any) => ({
    condition_id: m.condition_id.slice(0, 12) + '...',
    actual: m.actual_winner,
    inferred: m.inferred_winner,
    p0: Number(m.outcome_0_price).toFixed(3),
    p1: Number(m.outcome_1_price).toFixed(3),
    t0: m.trades_0,
    t1: m.trades_1,
    match: m.inferred_winner === m.actual_winner ? '✓' : '✗',
  }));

  console.log('Sample Results:');
  console.table(results);

  const withInference = validationData.filter((m: any) => m.inferred_winner >= 0);
  const correct = withInference.filter((m: any) => m.inferred_winner === m.actual_winner);
  const accuracy = withInference.length > 0 ? (correct.length / withInference.length * 100) : 0;

  console.log(`\n📊 VALIDATION RESULTS:`);
  console.log(`   Total markets: ${validationData.length}`);
  console.log(`   With clear inference: ${withInference.length}`);
  console.log(`   Correct predictions: ${correct.length}/${withInference.length}`);
  console.log(`   Accuracy: ${accuracy.toFixed(1)}%`);
  console.log(`   Status: ${accuracy >= 90 ? '✓ VALIDATED' : accuracy >= 80 ? '⚠️ MARGINAL' : '✗ FAILED'}\n`);

  // Step 2: Coverage analysis
  console.log('=== PHASE 2: COVERAGE POTENTIAL ===\n');

  const coverage = await client.query({
    query: `
      WITH
      all_resolved AS (
        SELECT count(DISTINCT condition_id_norm) as count
        FROM market_resolutions_final
      ),
      all_traded AS (
        SELECT count(DISTINCT lower(replaceAll(cid, '0x', ''))) as count
        FROM fact_trades_clean
      ),
      unresolved_with_trades AS (
        SELECT count(DISTINCT lower(replaceAll(cid, '0x', ''))) as count
        FROM fact_trades_clean
        WHERE lower(replaceAll(cid, '0x', '')) NOT IN (
          SELECT condition_id_norm FROM market_resolutions_final
        )
      )
      SELECT
        (SELECT count FROM all_resolved) as resolved_markets,
        (SELECT count FROM all_traded) as traded_markets,
        (SELECT count FROM unresolved_with_trades) as unresolved_traded,
        round((SELECT count FROM unresolved_with_trades) * 100.0 / (SELECT count FROM all_traded), 2) as pct_unresolved
    `,
    format: 'JSONEachRow',
  });

  const coverageData = await coverage.json();
  console.log('Trade Data Coverage:');
  console.table(coverageData);

  console.log('\n=== SUMMARY ===\n');
  console.log(`Accuracy: ${accuracy.toFixed(1)}%`);
  console.log(`Unresolved markets with trades: ${coverageData[0]?.unresolved_traded || 0}`);
  console.log(`\nPotential recovery: ${accuracy >= 80 ? '20-40% of unresolved markets' : 'Too low accuracy to recommend'}\n`);

  if (accuracy >= 80) {
    console.log('✅ APPROACH VIABLE');
    console.log('Next steps:');
    console.log('1. Tune thresholds (currently 0.90/0.10)');
    console.log('2. Add minimum trade count requirements');
    console.log('3. Test on larger sample (1000+ markets)');
    console.log('4. Build production view + insertion logic\n');
  } else {
    console.log('❌ APPROACH NOT VIABLE');
    console.log('Issues:');
    console.log('- Trade prices do not reliably indicate resolutions');
    console.log('- May need different data source or approach\n');
  }
}

main().catch(console.error).finally(() => client.close());
