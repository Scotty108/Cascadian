/**
 * Test Improved Smart Money Signals
 *
 * Based on analysis findings:
 * 1. $100K+ positions → 61.1% accuracy
 * 2. Moderate divergence (10-20%) → 60-65% accuracy
 * 3. Fade extreme confidence → 51.3% accuracy
 * 4. Late-stage (0-6h) → +5.5% edge
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function testSignals() {
  console.log('=== Testing Improved Smart Money Signals ===\n');

  // Test 1: Large Position Signal ($100K+)
  console.log('1. LARGE POSITION SIGNAL ($100K+)\n');

  const largePositions = await clickhouse.query({
    query: `
      SELECT
        count() as n,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) as wins,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as accuracy,
        countIf((crowd_price > 0.5 AND outcomes.actual_outcome = 0) OR
                (crowd_price <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as crowd_accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 100000
    `,
    format: 'JSONEachRow',
  });

  const lp = (await largePositions.json() as any[])[0];
  console.log(`   N: ${lp.n.toLocaleString()}`);
  console.log(`   SM Accuracy: ${lp.accuracy.toFixed(1)}%`);
  console.log(`   Crowd Accuracy: ${lp.crowd_accuracy.toFixed(1)}%`);
  console.log(`   Edge: ${(lp.accuracy - lp.crowd_accuracy >= 0 ? '+' : '')}${(lp.accuracy - lp.crowd_accuracy).toFixed(1)}%\n`);

  // Test 2: Moderate Divergence Signal (SM 10-20% different from crowd)
  console.log('2. MODERATE DIVERGENCE SIGNAL (±10-20%)\n');

  const modDivergence = await clickhouse.query({
    query: `
      SELECT
        count() as n,
        -- Follow SM when they diverge moderately
        countIf(
          ((smart_money_odds > crowd_price + 0.10) AND (smart_money_odds <= crowd_price + 0.20) AND outcomes.actual_outcome = 0) OR
          ((smart_money_odds < crowd_price - 0.10) AND (smart_money_odds >= crowd_price - 0.20) AND outcomes.actual_outcome = 1)
        ) as wins,
        countIf(
          ((smart_money_odds > crowd_price + 0.10) AND (smart_money_odds <= crowd_price + 0.20) AND outcomes.actual_outcome = 0) OR
          ((smart_money_odds < crowd_price - 0.10) AND (smart_money_odds >= crowd_price - 0.20) AND outcomes.actual_outcome = 1)
        ) / count() * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
        AND abs(smart_money_odds - crowd_price) >= 0.10
        AND abs(smart_money_odds - crowd_price) <= 0.20
    `,
    format: 'JSONEachRow',
  });

  const md = (await modDivergence.json() as any[])[0];
  console.log(`   N: ${md.n.toLocaleString()}`);
  console.log(`   Accuracy: ${md.accuracy.toFixed(1)}%\n`);

  // Test 3: Fade Extreme Confidence
  console.log('3. FADE EXTREME CONFIDENCE (bet against 80%+)\n');

  const fadeExtreme = await clickhouse.query({
    query: `
      SELECT
        count() as n,
        -- Bet AGAINST smart money when they are extremely confident
        countIf(
          (smart_money_odds > 0.80 AND outcomes.actual_outcome = 1) OR
          (smart_money_odds < 0.20 AND outcomes.actual_outcome = 0)
        ) as wins,
        countIf(
          (smart_money_odds > 0.80 AND outcomes.actual_outcome = 1) OR
          (smart_money_odds < 0.20 AND outcomes.actual_outcome = 0)
        ) / count() * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
        AND (smart_money_odds > 0.80 OR smart_money_odds < 0.20)
    `,
    format: 'JSONEachRow',
  });

  const fe = (await fadeExtreme.json() as any[])[0];
  console.log(`   N: ${fe.n.toLocaleString()}`);
  console.log(`   Accuracy: ${fe.accuracy.toFixed(1)}%\n`);

  // Test 4: Combined Signal (Large + Moderate Divergence)
  console.log('4. COMBINED: Large Position + Moderate Divergence\n');

  const combined1 = await clickhouse.query({
    query: `
      SELECT
        count() as n,
        countIf(
          ((smart_money_odds > crowd_price) AND outcomes.actual_outcome = 0) OR
          ((smart_money_odds < crowd_price) AND outcomes.actual_outcome = 1)
        ) / count() * 100 as accuracy,
        countIf((crowd_price > 0.5 AND outcomes.actual_outcome = 0) OR
                (crowd_price <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as crowd_accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 100000
        AND abs(smart_money_odds - crowd_price) >= 0.10
        AND abs(smart_money_odds - crowd_price) <= 0.25
    `,
    format: 'JSONEachRow',
  });

  const c1 = (await combined1.json() as any[])[0];
  console.log(`   N: ${c1.n.toLocaleString()}`);
  console.log(`   Follow SM Accuracy: ${c1.accuracy.toFixed(1)}%`);
  console.log(`   Crowd Accuracy: ${c1.crowd_accuracy.toFixed(1)}%`);
  console.log(`   Edge: ${(c1.accuracy - c1.crowd_accuracy >= 0 ? '+' : '')}${(c1.accuracy - c1.crowd_accuracy).toFixed(1)}%\n`);

  // Test 5: Combined Signal (Large + NOT extreme confidence)
  console.log('5. COMBINED: Large Position + Moderate Confidence (not 80%+)\n');

  const combined2 = await clickhouse.query({
    query: `
      SELECT
        count() as n,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as accuracy,
        countIf((crowd_price > 0.5 AND outcomes.actual_outcome = 0) OR
                (crowd_price <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as crowd_accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 100000
        AND smart_money_odds > 0.20
        AND smart_money_odds < 0.80
    `,
    format: 'JSONEachRow',
  });

  const c2 = (await combined2.json() as any[])[0];
  console.log(`   N: ${c2.n.toLocaleString()}`);
  console.log(`   SM Accuracy: ${c2.accuracy.toFixed(1)}%`);
  console.log(`   Crowd Accuracy: ${c2.crowd_accuracy.toFixed(1)}%`);
  console.log(`   Edge: ${(c2.accuracy - c2.crowd_accuracy >= 0 ? '+' : '')}${(c2.accuracy - c2.crowd_accuracy).toFixed(1)}%\n`);

  // Test 6: The "Smart Money Goldilocks" signal
  console.log('6. GOLDILOCKS SIGNAL: Large + Moderate Divergence + Not Extreme\n');

  const goldilocks = await clickhouse.query({
    query: `
      SELECT
        count() as n,
        countIf(
          ((smart_money_odds > crowd_price) AND outcomes.actual_outcome = 0) OR
          ((smart_money_odds < crowd_price) AND outcomes.actual_outcome = 1)
        ) / count() * 100 as follow_sm_accuracy,
        countIf((crowd_price > 0.5 AND outcomes.actual_outcome = 0) OR
                (crowd_price <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as crowd_accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 50000
        AND abs(smart_money_odds - crowd_price) >= 0.05
        AND abs(smart_money_odds - crowd_price) <= 0.25
        AND smart_money_odds > 0.20
        AND smart_money_odds < 0.80
    `,
    format: 'JSONEachRow',
  });

  const gl = (await goldilocks.json() as any[])[0];
  console.log(`   N: ${gl.n.toLocaleString()}`);
  console.log(`   Follow SM Accuracy: ${gl.follow_sm_accuracy.toFixed(1)}%`);
  console.log(`   Crowd Accuracy: ${gl.crowd_accuracy.toFixed(1)}%`);
  console.log(`   Edge: ${(gl.follow_sm_accuracy - gl.crowd_accuracy >= 0 ? '+' : '')}${(gl.follow_sm_accuracy - gl.crowd_accuracy).toFixed(1)}%\n`);

  // Test 7: Contrarian on LOW positions
  console.log('7. CONTRARIAN: Fade SM on small positions ($1K-20K)\n');

  const contrarian = await clickhouse.query({
    query: `
      SELECT
        count() as n,
        -- Bet AGAINST smart money on small positions
        countIf(
          (smart_money_odds > 0.5 AND outcomes.actual_outcome = 1) OR
          (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 0)
        ) / count() * 100 as fade_sm_accuracy,
        countIf((crowd_price > 0.5 AND outcomes.actual_outcome = 0) OR
                (crowd_price <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as crowd_accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
        AND m.total_usd < 20000
    `,
    format: 'JSONEachRow',
  });

  const ct = (await contrarian.json() as any[])[0];
  console.log(`   N: ${ct.n.toLocaleString()}`);
  console.log(`   Fade SM Accuracy: ${ct.fade_sm_accuracy.toFixed(1)}%`);
  console.log(`   Crowd Accuracy: ${ct.crowd_accuracy.toFixed(1)}%\n`);

  // Test 8: Position size breakdown with more granularity
  console.log('8. POSITION SIZE DEEP DIVE\n');

  const sizeDeep = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN total_usd < 2000 THEN '$1K-2K'
          WHEN total_usd < 5000 THEN '$2K-5K'
          WHEN total_usd < 10000 THEN '$5K-10K'
          WHEN total_usd < 25000 THEN '$10K-25K'
          WHEN total_usd < 50000 THEN '$25K-50K'
          WHEN total_usd < 100000 THEN '$50K-100K'
          WHEN total_usd < 250000 THEN '$100K-250K'
          WHEN total_usd < 500000 THEN '$250K-500K'
          ELSE '$500K+'
        END as size_bucket,
        count() as n,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as sm_accuracy,
        countIf((crowd_price > 0.5 AND outcomes.actual_outcome = 0) OR
                (crowd_price <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as crowd_accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
      GROUP BY size_bucket
      ORDER BY
        CASE size_bucket
          WHEN '$1K-2K' THEN 1
          WHEN '$2K-5K' THEN 2
          WHEN '$5K-10K' THEN 3
          WHEN '$10K-25K' THEN 4
          WHEN '$25K-50K' THEN 5
          WHEN '$50K-100K' THEN 6
          WHEN '$100K-250K' THEN 7
          WHEN '$250K-500K' THEN 8
          ELSE 9
        END
    `,
    format: 'JSONEachRow',
  });

  const sizeRows = await sizeDeep.json() as any[];
  console.log('   | Position Size | N | SM Acc | Crowd Acc | Edge |');
  console.log('   |---------------|---|--------|-----------|------|');
  for (const r of sizeRows) {
    const edge = r.sm_accuracy - r.crowd_accuracy;
    console.log(`   | ${r.size_bucket.padEnd(13)} | ${r.n.toString().padStart(5)} | ${r.sm_accuracy.toFixed(1).padStart(5)}% | ${r.crowd_accuracy.toFixed(1).padStart(8)}% | ${(edge >= 0 ? '+' : '')}${edge.toFixed(1).padStart(4)}% |`);
  }

  console.log('\n=== SIGNAL TESTING COMPLETE ===\n');

  // Print summary
  console.log('RECOMMENDED SIGNALS:');
  console.log('1. Large Position ($100K+): ~61% accuracy');
  console.log('2. Moderate Divergence (10-20%): ~62% accuracy');
  console.log('3. Fade Extreme Confidence (80%+): ~51% accuracy');
  console.log('4. Combined: Large + Moderate Divergence: Best edge\n');

  await clickhouse.close();
}

testSignals().catch(console.error);
