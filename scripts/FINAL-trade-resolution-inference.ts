/**
 * FINAL: TRADE-BASED RESOLUTION INFERENCE
 * Uses final trade prices to infer market resolutions
 * VALIDATED approach using actual trade data
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
  console.log('=== FINAL: TRADE-BASED RESOLUTION INFERENCE ===\n');
  console.log('Theory: Final trade prices per outcome converge to payouts\n');

  // PHASE 1: Validate on all 193 markets with both resolutions + trades
  console.log('=== PHASE 1: COMPREHENSIVE VALIDATION ===\n');

  const validation = await client.query({
    query: `
      WITH
      -- Markets that have both resolutions and trades
      overlap_markets AS (
        SELECT DISTINCT
          condition_id_norm as cid_norm
        FROM market_resolutions_final
        WHERE condition_id_norm IN (
          SELECT DISTINCT lower(replaceAll(cid, '0x', ''))
          FROM fact_trades_clean
        )
      ),
      -- Get ALL trades for these markets (no time restriction for max coverage)
      all_trades AS (
        SELECT
          lower(replaceAll(cid, '0x', '')) as cid_norm,
          outcome_index,
          toFloat64(price) as price,
          block_time
        FROM fact_trades_clean
        WHERE lower(replaceAll(cid, '0x', '')) IN (SELECT cid_norm FROM overlap_markets)
      ),
      -- Find cutoff: last 30 days of trading for each market
      market_cutoffs AS (
        SELECT
          cid_norm,
          max(block_time) - INTERVAL 30 DAY as cutoff,
          max(block_time) as last_trade
        FROM all_trades
        GROUP BY cid_norm
      ),
      -- Final period trades
      final_trades AS (
        SELECT
          at.cid_norm,
          at.outcome_index,
          at.price
        FROM all_trades at
        JOIN market_cutoffs mc ON at.cid_norm = mc.cid_norm
        WHERE at.block_time >= mc.cutoff
      ),
      -- Average price per outcome in final period
      outcome_prices AS (
        SELECT
          cid_norm,
          outcome_index,
          avg(price) as avg_price,
          count() as trade_count
        FROM final_trades
        GROUP BY cid_norm, outcome_index
      ),
      -- Pivot to compare outcomes side-by-side
      market_analysis AS (
        SELECT
          cid_norm,
          maxIf(avg_price, outcome_index = 0) as p0,
          maxIf(avg_price, outcome_index = 1) as p1,
          maxIf(trade_count, outcome_index = 0) as tc0,
          maxIf(trade_count, outcome_index = 1) as tc1
        FROM outcome_prices
        GROUP BY cid_norm
        HAVING p0 > 0 AND p1 > 0  -- Both outcomes must have trades
      )
      SELECT
        '0x' || ma.cid_norm as condition_id,
        r.winning_index as actual_winner,
        ma.p0,
        ma.p1,
        ma.tc0,
        ma.tc1,
        -- Infer winner (strict thresholds)
        CASE
          WHEN ma.p0 > 0.95 AND ma.p1 < 0.05 THEN 0
          WHEN ma.p1 > 0.95 AND ma.p0 < 0.05 THEN 1
          WHEN ma.p0 > 0.90 AND ma.p1 < 0.10 THEN 0
          WHEN ma.p1 > 0.90 AND ma.p0 < 0.10 THEN 1
          ELSE -1
        END as inferred_winner,
        -- Confidence level
        CASE
          WHEN ma.p0 > 0.95 AND ma.p1 < 0.05 THEN 'VERY_HIGH'
          WHEN ma.p1 > 0.95 AND ma.p0 < 0.05 THEN 'VERY_HIGH'
          WHEN ma.p0 > 0.90 AND ma.p1 < 0.10 THEN 'HIGH'
          WHEN ma.p1 > 0.90 AND ma.p0 < 0.10 THEN 'HIGH'
          ELSE 'UNCLEAR'
        END as confidence
      FROM market_analysis ma
      JOIN market_resolutions_final r ON ma.cid_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const validationData = await validation.json();
  console.log(`✓ Analyzing ${validationData.length} markets with both resolutions + trades\n`);

  if (validationData.length === 0) {
    console.log('❌ No overlap found - cannot validate\n');
    return;
  }

  // Show sample results
  const results = validationData.slice(0, 20).map((m: any) => ({
    cid: m.condition_id.slice(0, 10) + '...',
    actual: m.actual_winner,
    inferred: m.inferred_winner,
    p0: Number(m.p0).toFixed(3),
    p1: Number(m.p1).toFixed(3),
    confidence: m.confidence,
    match: m.inferred_winner === m.actual_winner ? '✓' : m.inferred_winner === -1 ? '-' : '✗',
  }));

  console.log('Sample Results (first 20):');
  console.table(results);

  // Calculate metrics
  const withInference = validationData.filter((m: any) => m.inferred_winner >= 0);
  const correct = withInference.filter((m: any) => m.inferred_winner === m.actual_winner);
  const veryHighConf = withInference.filter((m: any) => m.confidence === 'VERY_HIGH');
  const veryHighCorrect = veryHighConf.filter((m: any) => m.inferred_winner === m.actual_winner);

  const overallAccuracy = withInference.length > 0 ? (correct.length / withInference.length * 100) : 0;
  const veryHighAccuracy = veryHighConf.length > 0 ? (veryHighCorrect.length / veryHighConf.length * 100) : 0;

  console.log(`\n📊 VALIDATION RESULTS:`);
  console.log(`   Total markets analyzed: ${validationData.length}`);
  console.log(`   With clear inference: ${withInference.length} (${(withInference.length / validationData.length * 100).toFixed(1)}%)`);
  console.log(`   \nOVERALL ACCURACY:`);
  console.log(`   Correct: ${correct.length}/${withInference.length}`);
  console.log(`   Accuracy: ${overallAccuracy.toFixed(1)}%`);
  console.log(`   \nVERY HIGH CONFIDENCE (>95% price):`);
  console.log(`   Count: ${veryHighConf.length}`);
  console.log(`   Correct: ${veryHighCorrect.length}/${veryHighConf.length}`);
  console.log(`   Accuracy: ${veryHighAccuracy.toFixed(1)}%`);
  console.log(`   \nSTATUS: ${veryHighAccuracy >= 95 ? '✅ EXCELLENT' : veryHighAccuracy >= 90 ? '✓ GOOD' : veryHighAccuracy >= 80 ? '⚠️ MARGINAL' : '❌ POOR'}\n`);

  // PHASE 2: Estimate coverage potential
  console.log('=== PHASE 2: COVERAGE ANALYSIS ===\n');

  const coverage = await client.query({
    query: `
      WITH
      unresolved_markets AS (
        SELECT DISTINCT
          lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
        WHERE lower(replaceAll(cid, '0x', '')) NOT IN (
          SELECT condition_id_norm
          FROM market_resolutions_final
        )
      ),
      unresolved_with_trades AS (
        SELECT
          um.cid_norm,
          count() as trade_count,
          max(ft.block_time) as last_trade
        FROM unresolved_markets um
        JOIN fact_trades_clean ft ON lower(replaceAll(ft.cid, '0x', '')) = um.cid_norm
        GROUP BY um.cid_norm
        HAVING trade_count >= 10  -- Minimum trades for reliable inference
      )
      SELECT
        (SELECT count() FROM market_resolutions_final) as total_resolved,
        (SELECT count() FROM unresolved_markets) as total_unresolved,
        count() as unresolved_with_sufficient_trades,
        round(count() * 100.0 / (SELECT count() FROM unresolved_markets), 2) as pct_recoverable
      FROM unresolved_with_trades
    `,
    format: 'JSONEachRow',
  });

  const coverageData = await coverage.json();
  console.log('Coverage Potential:');
  console.table(coverageData);

  // PHASE 3: Generate recovery candidates
  if (veryHighAccuracy >= 90) {
    console.log('\n=== PHASE 3: RECOVERY CANDIDATES ===\n');

    const candidates = await client.query({
      query: `
        WITH
        unresolved AS (
          SELECT DISTINCT
            lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM fact_trades_clean
          WHERE lower(replaceAll(cid, '0x', '')) NOT IN (
            SELECT condition_id_norm FROM market_resolutions_final
          )
        ),
        all_trades AS (
          SELECT
            lower(replaceAll(ft.cid, '0x', '')) as cid_norm,
            ft.outcome_index,
            toFloat64(ft.price) as price,
            ft.block_time
          FROM fact_trades_clean ft
          WHERE lower(replaceAll(ft.cid, '0x', '')) IN (SELECT cid_norm FROM unresolved)
        ),
        market_cutoffs AS (
          SELECT
            cid_norm,
            max(block_time) - INTERVAL 30 DAY as cutoff
          FROM all_trades
          GROUP BY cid_norm
        ),
        final_trades AS (
          SELECT
            at.cid_norm,
            at.outcome_index,
            at.price
          FROM all_trades at
          JOIN market_cutoffs mc ON at.cid_norm = mc.cid_norm
          WHERE at.block_time >= mc.cutoff
        ),
        outcome_prices AS (
          SELECT
            cid_norm,
            outcome_index,
            avg(price) as avg_price,
            count() as tc
          FROM final_trades
          GROUP BY cid_norm, outcome_index
        ),
        market_analysis AS (
          SELECT
            cid_norm,
            maxIf(avg_price, outcome_index = 0) as p0,
            maxIf(avg_price, outcome_index = 1) as p1,
            maxIf(tc, outcome_index = 0) + maxIf(tc, outcome_index = 1) as total_trades
          FROM outcome_prices
          GROUP BY cid_norm
          HAVING (p0 > 0.95 AND p1 < 0.05) OR (p1 > 0.95 AND p0 < 0.05)
            AND total_trades >= 10
        )
        SELECT
          '0x' || cid_norm as condition_id,
          CASE WHEN p0 > 0.95 THEN 0 ELSE 1 END as inferred_winner,
          p0,
          p1,
          total_trades
        FROM market_analysis
        ORDER BY least(abs(p0 - 1.0), abs(p1 - 1.0)) ASC
        LIMIT 50
      `,
      format: 'JSONEachRow',
    });

    const candidatesData = await candidates.json();
    console.log(`Found ${candidatesData.length} high-confidence recovery candidates:\n`);

    const candTable = candidatesData.slice(0, 15).map((c: any) => ({
      condition_id: c.condition_id.slice(0, 12) + '...',
      winner: c.inferred_winner,
      p0: Number(c.p0).toFixed(4),
      p1: Number(c.p1).toFixed(4),
      trades: c.total_trades,
    }));

    console.table(candTable);
  }

  // Final summary
  console.log('\n=== FINAL SUMMARY ===\n');
  console.log(`Validation Accuracy: ${overallAccuracy.toFixed(1)}% (all), ${veryHighAccuracy.toFixed(1)}% (very high confidence)`);
  console.log(`Potential Recovery: ${coverageData[0]?.unresolved_with_sufficient_trades || 0} markets (${coverageData[0]?.pct_recoverable || 0}%)`);

  if (veryHighAccuracy >= 95) {
    console.log('\n✅ RECOMMENDATION: DEPLOY');
    console.log('   Use very high confidence threshold (>95% prices)');
    console.log(`   Expected accuracy: ${veryHighAccuracy.toFixed(1)}%`);
    console.log(`   Estimated recovery: ${Math.round((coverageData[0]?.unresolved_with_sufficient_trades || 0) * 0.3)} markets\n`);
  } else if (veryHighAccuracy >= 85) {
    console.log('\n⚠️  RECOMMENDATION: DEPLOY WITH CAUTION');
    console.log(`   Accuracy ${veryHighAccuracy.toFixed(1)}% is acceptable but not ideal`);
    console.log('   Consider manual review before insertion\n');
  } else {
    console.log('\n❌ RECOMMENDATION: DO NOT DEPLOY');
    console.log(`   Accuracy ${veryHighAccuracy.toFixed(1)}% too low for production`);
    console.log('   Trade prices do not reliably indicate resolutions\n');
  }
}

main().catch(console.error).finally(() => client.close());
