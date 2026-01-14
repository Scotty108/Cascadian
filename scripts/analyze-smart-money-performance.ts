/**
 * Deep Analysis of Smart Money Signal Performance
 *
 * Investigates why signals underperform and looks for predictive patterns:
 * 1. Data quality check - verify outcome_side is correct
 * 2. Time horizon analysis - when is smart money most predictive?
 * 3. Position size filtering - do large positions predict better?
 * 4. Tier breakdown - which tier is actually smart?
 * 5. Market characteristics - what types of markets are predictable?
 * 6. Contrarian signals - when does betting AGAINST smart money work?
 * 7. Delta signals - does smart money vs crowd divergence predict?
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

interface AnalysisResult {
  dimension: string;
  segment: string;
  predictions: number;
  accuracy: number;
  edgeVsCrowd: number;
}

async function runAnalysis() {
  console.log('=== Deep Smart Money Signal Analysis ===\n');

  // First, verify data quality by checking a few resolved markets
  console.log('1. DATA QUALITY CHECK\n');

  const sampleCheck = await clickhouse.query({
    query: `
      SELECT
        m.market_id,
        m.ts,
        m.smart_money_odds,
        m.crowd_price,
        m.total_usd,
        outcomes.actual_outcome,
        -- Smart money predicted YES if odds > 0.5
        if(m.smart_money_odds > 0.5, 'YES', 'NO') as sm_prediction,
        -- actual_outcome=0 means YES won, actual_outcome=1 means NO won
        if(outcomes.actual_outcome = 0, 'YES', 'NO') as actual_winner,
        if((m.smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
           (m.smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1), 1, 0) as sm_correct,
        if((m.crowd_price > 0.5 AND outcomes.actual_outcome = 0) OR
           (m.crowd_price <= 0.5 AND outcomes.actual_outcome = 1), 1, 0) as crowd_correct
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const samples = await sampleCheck.json() as any[];
  console.log('Sample resolved markets:');
  console.log('| SM Odds | Crowd | SM Pred | Winner | SM Correct | Crowd Correct |');
  console.log('|---------|-------|---------|--------|------------|---------------|');
  for (const s of samples) {
    console.log(`| ${(s.smart_money_odds * 100).toFixed(0).padStart(5)}% | ${(s.crowd_price * 100).toFixed(0).padStart(5)}% | ${s.sm_prediction.padEnd(7)} | ${s.actual_winner.padEnd(6)} | ${s.sm_correct ? 'YES' : 'NO '.padEnd(10)} | ${s.crowd_correct ? 'YES' : 'NO'} |`);
  }

  // 2. Overall accuracy by different metrics
  console.log('\n\n2. OVERALL ACCURACY BREAKDOWN\n');

  const overallStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_snapshots,
        countIf((smart_money_odds > 0.5 AND actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND actual_outcome = 1)) as sm_correct,
        countIf((crowd_price > 0.5 AND actual_outcome = 0) OR
                (crowd_price <= 0.5 AND actual_outcome = 1)) as crowd_correct,
        avg(smart_money_odds) as avg_sm_odds,
        avg(crowd_price) as avg_crowd_price
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
    `,
    format: 'JSONEachRow',
  });

  const overall = (await overallStats.json() as any[])[0];
  console.log(`Total snapshots: ${overall.total_snapshots.toLocaleString()}`);
  console.log(`Smart Money Accuracy: ${(overall.sm_correct / overall.total_snapshots * 100).toFixed(1)}%`);
  console.log(`Crowd Accuracy: ${(overall.crowd_correct / overall.total_snapshots * 100).toFixed(1)}%`);
  console.log(`Avg SM Odds: ${(overall.avg_sm_odds * 100).toFixed(1)}%`);
  console.log(`Avg Crowd Price: ${(overall.avg_crowd_price * 100).toFixed(1)}%`);

  // 3. Time horizon analysis - when is smart money most predictive?
  console.log('\n\n3. TIME HORIZON ANALYSIS\n');
  console.log('Does smart money predict better early or late?\n');

  const timeAnalysis = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN hours_before < 6 THEN '0-6h before'
          WHEN hours_before < 24 THEN '6-24h before'
          WHEN hours_before < 72 THEN '1-3 days before'
          WHEN hours_before < 168 THEN '3-7 days before'
          ELSE '7+ days before'
        END as time_bucket,
        count() as n,
        countIf((smart_money_odds > 0.5 AND actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND actual_outcome = 1)) / count() * 100 as sm_accuracy,
        countIf((crowd_price > 0.5 AND actual_outcome = 0) OR
                (crowd_price <= 0.5 AND actual_outcome = 1)) / count() * 100 as crowd_accuracy
      FROM (
        SELECT
          m.smart_money_odds,
          m.crowd_price,
          outcomes.actual_outcome,
          dateDiff('hour', m.ts, outcomes.resolution_time) as hours_before
        FROM wio_smart_money_metrics_v1 m
        JOIN (
          SELECT condition_id, any(outcome_side) as actual_outcome, max(ts_resolve) as resolution_time
          FROM wio_positions_v2
          WHERE is_resolved = 1
          GROUP BY condition_id
          HAVING actual_outcome IS NOT NULL
        ) outcomes ON m.market_id = outcomes.condition_id
        WHERE m.total_usd >= 1000
      )
      WHERE hours_before >= 0
      GROUP BY time_bucket
      ORDER BY
        CASE time_bucket
          WHEN '0-6h before' THEN 1
          WHEN '6-24h before' THEN 2
          WHEN '1-3 days before' THEN 3
          WHEN '3-7 days before' THEN 4
          ELSE 5
        END
    `,
    format: 'JSONEachRow',
  });

  const timeRows = await timeAnalysis.json() as any[];
  console.log('| Time Before Resolution | N | SM Accuracy | Crowd Accuracy | SM Edge |');
  console.log('|------------------------|---|-------------|----------------|---------|');
  for (const r of timeRows) {
    const edge = r.sm_accuracy - r.crowd_accuracy;
    console.log(`| ${r.time_bucket.padEnd(22)} | ${r.n.toString().padStart(6)} | ${r.sm_accuracy.toFixed(1).padStart(10)}% | ${r.crowd_accuracy.toFixed(1).padStart(13)}% | ${(edge >= 0 ? '+' : '') + edge.toFixed(1).padStart(5)}% |`);
  }

  // 4. Position size analysis
  console.log('\n\n4. POSITION SIZE ANALYSIS\n');
  console.log('Do larger smart money positions predict better?\n');

  const sizeAnalysis = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN total_usd < 5000 THEN '$1K-5K'
          WHEN total_usd < 20000 THEN '$5K-20K'
          WHEN total_usd < 100000 THEN '$20K-100K'
          ELSE '$100K+'
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
          WHEN '$1K-5K' THEN 1
          WHEN '$5K-20K' THEN 2
          WHEN '$20K-100K' THEN 3
          ELSE 4
        END
    `,
    format: 'JSONEachRow',
  });

  const sizeRows = await sizeAnalysis.json() as any[];
  console.log('| Position Size | N | SM Accuracy | Crowd Accuracy | SM Edge |');
  console.log('|---------------|---|-------------|----------------|---------|');
  for (const r of sizeRows) {
    const edge = r.sm_accuracy - r.crowd_accuracy;
    console.log(`| ${r.size_bucket.padEnd(13)} | ${r.n.toString().padStart(6)} | ${r.sm_accuracy.toFixed(1).padStart(10)}% | ${r.crowd_accuracy.toFixed(1).padStart(13)}% | ${(edge >= 0 ? '+' : '') + edge.toFixed(1).padStart(5)}% |`);
  }

  // 5. Tier breakdown
  console.log('\n\n5. TIER BREAKDOWN ANALYSIS\n');
  console.log('Which tier is actually predictive?\n');

  const tierAnalysis = await clickhouse.query({
    query: `
      SELECT
        'Superforecaster' as tier,
        count() as n,
        countIf(
          ((superforecaster_yes_usd > superforecaster_no_usd) AND outcomes.actual_outcome = 0) OR
          ((superforecaster_yes_usd <= superforecaster_no_usd) AND outcomes.actual_outcome = 1)
        ) / countIf(superforecaster_yes_usd + superforecaster_no_usd > 0) * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000 AND superforecaster_yes_usd + superforecaster_no_usd > 0

      UNION ALL

      SELECT
        'Smart' as tier,
        count() as n,
        countIf(
          ((smart_yes_usd > smart_no_usd) AND outcomes.actual_outcome = 0) OR
          ((smart_yes_usd <= smart_no_usd) AND outcomes.actual_outcome = 1)
        ) / countIf(smart_yes_usd + smart_no_usd > 0) * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000 AND smart_yes_usd + smart_no_usd > 0

      UNION ALL

      SELECT
        'Profitable' as tier,
        count() as n,
        countIf(
          ((profitable_yes_usd > profitable_no_usd) AND outcomes.actual_outcome = 0) OR
          ((profitable_yes_usd <= profitable_no_usd) AND outcomes.actual_outcome = 1)
        ) / countIf(profitable_yes_usd + profitable_no_usd > 0) * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000 AND profitable_yes_usd + profitable_no_usd > 0
    `,
    format: 'JSONEachRow',
  });

  const tierRows = await tierAnalysis.json() as any[];
  console.log('| Tier | N | Accuracy |');
  console.log('|------|---|----------|');
  for (const r of tierRows) {
    console.log(`| ${r.tier.padEnd(15)} | ${r.n.toString().padStart(6)} | ${r.accuracy.toFixed(1).padStart(7)}% |`);
  }

  // 6. Confidence level analysis
  console.log('\n\n6. CONFIDENCE LEVEL ANALYSIS\n');
  console.log('How does confidence (distance from 50%) affect accuracy?\n');

  const confidenceAnalysis = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN abs(smart_money_odds - 0.5) < 0.05 THEN '50-55% (low)'
          WHEN abs(smart_money_odds - 0.5) < 0.15 THEN '55-65% (medium)'
          WHEN abs(smart_money_odds - 0.5) < 0.30 THEN '65-80% (high)'
          ELSE '80%+ (very high)'
        END as confidence_bucket,
        count() as n,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as sm_accuracy,
        avg(abs(smart_money_odds - 0.5)) * 100 as avg_confidence
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
      GROUP BY confidence_bucket
      ORDER BY avg_confidence
    `,
    format: 'JSONEachRow',
  });

  const confRows = await confidenceAnalysis.json() as any[];
  console.log('| Confidence Level | N | SM Accuracy | Expected if Random |');
  console.log('|------------------|---|-------------|-------------------|');
  for (const r of confRows) {
    // If random, accuracy should equal confidence level
    const expectedRandom = 50 + r.avg_confidence;
    console.log(`| ${r.confidence_bucket.padEnd(16)} | ${r.n.toString().padStart(6)} | ${r.sm_accuracy.toFixed(1).padStart(10)}% | ${expectedRandom.toFixed(1).padStart(16)}% |`);
  }

  // 7. Smart Money vs Crowd Divergence
  console.log('\n\n7. DIVERGENCE ANALYSIS (Smart Money vs Crowd)\n');
  console.log('Does betting with smart money when they diverge from crowd work?\n');

  const divergenceAnalysis = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN (smart_money_odds - crowd_price) > 0.20 THEN 'SM much more bullish (+20%+)'
          WHEN (smart_money_odds - crowd_price) > 0.10 THEN 'SM more bullish (+10-20%)'
          WHEN (smart_money_odds - crowd_price) > 0.05 THEN 'SM slightly bullish (+5-10%)'
          WHEN (smart_money_odds - crowd_price) > -0.05 THEN 'Aligned (-5% to +5%)'
          WHEN (smart_money_odds - crowd_price) > -0.10 THEN 'SM slightly bearish (-5-10%)'
          WHEN (smart_money_odds - crowd_price) > -0.20 THEN 'SM more bearish (-10-20%)'
          ELSE 'SM much more bearish (-20%+)'
        END as divergence_bucket,
        count() as n,
        -- When SM diverges bullish, bet YES - check if YES won
        countIf(
          ((smart_money_odds > crowd_price + 0.05) AND outcomes.actual_outcome = 0) OR
          ((smart_money_odds < crowd_price - 0.05) AND outcomes.actual_outcome = 1) OR
          (abs(smart_money_odds - crowd_price) <= 0.05 AND ((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)))
        ) / count() * 100 as follow_sm_accuracy,
        avg(smart_money_odds - crowd_price) * 100 as avg_divergence
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
      GROUP BY divergence_bucket
      ORDER BY avg_divergence DESC
    `,
    format: 'JSONEachRow',
  });

  const divRows = await divergenceAnalysis.json() as any[];
  console.log('| Divergence | N | Follow SM Accuracy |');
  console.log('|------------|---|--------------------|');
  for (const r of divRows) {
    console.log(`| ${r.divergence_bucket.padEnd(30)} | ${r.n.toString().padStart(6)} | ${r.follow_sm_accuracy.toFixed(1).padStart(17)}% |`);
  }

  // 8. Flow direction analysis
  console.log('\n\n8. FLOW DIRECTION ANALYSIS\n');
  console.log('Does recent buying/selling activity predict outcomes?\n');

  const flowAnalysis = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN flow_24h > 5000 THEN 'Strong buying (>$5K)'
          WHEN flow_24h > 1000 THEN 'Moderate buying ($1-5K)'
          WHEN flow_24h > 0 THEN 'Light buying ($0-1K)'
          WHEN flow_24h > -1000 THEN 'Light selling ($0-1K)'
          WHEN flow_24h > -5000 THEN 'Moderate selling ($1-5K)'
          ELSE 'Strong selling (>$5K)'
        END as flow_bucket,
        count() as n,
        -- If buying (positive flow), bet YES - check if YES won
        countIf(
          (flow_24h > 0 AND outcomes.actual_outcome = 0) OR
          (flow_24h <= 0 AND outcomes.actual_outcome = 1)
        ) / count() * 100 as follow_flow_accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
      GROUP BY flow_bucket
      ORDER BY
        CASE flow_bucket
          WHEN 'Strong buying (>$5K)' THEN 1
          WHEN 'Moderate buying ($1-5K)' THEN 2
          WHEN 'Light buying ($0-1K)' THEN 3
          WHEN 'Light selling ($0-1K)' THEN 4
          WHEN 'Moderate selling ($1-5K)' THEN 5
          ELSE 6
        END
    `,
    format: 'JSONEachRow',
  });

  const flowRows = await flowAnalysis.json() as any[];
  console.log('| 24h Flow | N | Follow Flow Accuracy |');
  console.log('|----------|---|----------------------|');
  for (const r of flowRows) {
    console.log(`| ${r.flow_bucket.padEnd(25)} | ${r.n.toString().padStart(6)} | ${r.follow_flow_accuracy.toFixed(1).padStart(19)}% |`);
  }

  // 9. Wallet count analysis
  console.log('\n\n9. WALLET COUNT ANALYSIS\n');
  console.log('Does having more smart wallets in agreement improve accuracy?\n');

  const walletCountAnalysis = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN wallet_count = 1 THEN '1 wallet'
          WHEN wallet_count <= 3 THEN '2-3 wallets'
          WHEN wallet_count <= 5 THEN '4-5 wallets'
          WHEN wallet_count <= 10 THEN '6-10 wallets'
          ELSE '10+ wallets'
        END as wallet_bucket,
        count() as n,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as sm_accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
      GROUP BY wallet_bucket
      ORDER BY
        CASE wallet_bucket
          WHEN '1 wallet' THEN 1
          WHEN '2-3 wallets' THEN 2
          WHEN '4-5 wallets' THEN 3
          WHEN '6-10 wallets' THEN 4
          ELSE 5
        END
    `,
    format: 'JSONEachRow',
  });

  const walletRows = await walletCountAnalysis.json() as any[];
  console.log('| Wallet Count | N | SM Accuracy |');
  console.log('|--------------|---|-------------|');
  for (const r of walletRows) {
    console.log(`| ${r.wallet_bucket.padEnd(12)} | ${r.n.toString().padStart(6)} | ${r.sm_accuracy.toFixed(1).padStart(10)}% |`);
  }

  // 10. Combined signal analysis - find the best combination
  console.log('\n\n10. BEST SIGNAL COMBINATION SEARCH\n');
  console.log('Testing combinations of filters to find predictive signals...\n');

  const combinedAnalysis = await clickhouse.query({
    query: `
      SELECT
        'Large positions + Early (3+ days) + Divergent' as signal,
        count() as n,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome, max(ts_resolve) as resolution_time
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 20000
        AND dateDiff('hour', m.ts, outcomes.resolution_time) >= 72
        AND abs(m.smart_money_odds - m.crowd_price) > 0.10

      UNION ALL

      SELECT
        'High wallet consensus (5+) + Strong conviction (70%+)' as signal,
        count() as n,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.wallet_count >= 5
        AND abs(m.smart_money_odds - 0.5) > 0.20

      UNION ALL

      SELECT
        'Superforecasters only + Large positions' as signal,
        count() as n,
        countIf(
          ((superforecaster_yes_usd > superforecaster_no_usd) AND outcomes.actual_outcome = 0) OR
          ((superforecaster_yes_usd <= superforecaster_no_usd) AND outcomes.actual_outcome = 1)
        ) / count() * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.superforecaster_yes_usd + m.superforecaster_no_usd >= 5000

      UNION ALL

      SELECT
        'Recent strong buying + Against crowd' as signal,
        count() as n,
        countIf(
          (flow_24h > 5000 AND smart_money_odds > crowd_price + 0.10 AND outcomes.actual_outcome = 0) OR
          (flow_24h < -5000 AND smart_money_odds < crowd_price - 0.10 AND outcomes.actual_outcome = 1)
        ) / count() * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE abs(flow_24h) > 5000 AND abs(smart_money_odds - crowd_price) > 0.10

      UNION ALL

      SELECT
        'LOW confidence (near 50%) only' as signal,
        count() as n,
        countIf((smart_money_odds > 0.5 AND outcomes.actual_outcome = 0) OR
                (smart_money_odds <= 0.5 AND outcomes.actual_outcome = 1)) / count() * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
        AND abs(m.smart_money_odds - 0.5) < 0.10

      UNION ALL

      SELECT
        'FADE high confidence (bet AGAINST 80%+ signals)' as signal,
        count() as n,
        -- Bet AGAINST smart money when they are very confident
        countIf((smart_money_odds > 0.8 AND outcomes.actual_outcome = 1) OR
                (smart_money_odds < 0.2 AND outcomes.actual_outcome = 0)) / count() * 100 as accuracy
      FROM wio_smart_money_metrics_v1 m
      JOIN (
        SELECT condition_id, any(outcome_side) as actual_outcome
        FROM wio_positions_v2
        WHERE is_resolved = 1
        GROUP BY condition_id
        HAVING actual_outcome IS NOT NULL
      ) outcomes ON m.market_id = outcomes.condition_id
      WHERE m.total_usd >= 1000
        AND (m.smart_money_odds > 0.8 OR m.smart_money_odds < 0.2)
    `,
    format: 'JSONEachRow',
  });

  const combinedRows = await combinedAnalysis.json() as any[];
  console.log('| Signal Combination | N | Accuracy |');
  console.log('|--------------------|---|----------|');
  for (const r of combinedRows) {
    const accStr = r.accuracy !== null ? `${r.accuracy.toFixed(1)}%` : 'N/A';
    console.log(`| ${r.signal.padEnd(45)} | ${r.n.toString().padStart(6)} | ${accStr.padStart(7)} |`);
  }

  console.log('\n=== ANALYSIS COMPLETE ===\n');

  await clickhouse.close();
}

runAnalysis().catch(console.error);
