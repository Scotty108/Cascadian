/**
 * Smart Money Signal Backtest Framework
 *
 * Tests different signal formulas against resolved market outcomes to find
 * which combinations best predict winners.
 *
 * Metrics evaluated:
 * - Accuracy: % of time signal correctly predicted outcome
 * - Early accuracy: Correct predictions 24h+ before resolution
 * - Edge vs crowd: How much better than market price
 * - Calibration: When signal says 70%, does YES win ~70%?
 *
 * Usage: npx tsx scripts/backtest-smart-money-signals.ts [--min-snapshots=10]
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
  clickhouse_settings: {
    max_execution_time: 300,
  },
});

interface SignalFormula {
  name: string;
  description: string;
  calculate: (m: MetricsSnapshot) => number;
}

interface MetricsSnapshot {
  market_id: string;
  ts: string;
  hours_before_resolution: number;
  outcome_won: number; // 0 = YES won, 1 = NO won

  // Raw metrics
  crowd_price: number;
  smart_money_odds: number;
  yes_usd: number;
  no_usd: number;
  total_usd: number;
  wallet_count: number;
  avg_entry_price: number;
  entry_edge_pct: number;
  pct_wallets_underwater: number;
  total_unrealized_pnl: number;
  flow_1h: number;
  flow_24h: number;
  flow_7d: number;
  avg_position_size: number;
  top5_concentration: number;
  superforecaster_yes_usd: number;
  superforecaster_no_usd: number;
  smart_yes_usd: number;
  smart_no_usd: number;
}

interface BacktestResult {
  formula: string;
  description: string;
  totalPredictions: number;
  accuracy: number;
  accuracyAt24h: number;
  accuracyAt72h: number;
  edgeVsCrowd: number;
  calibrationError: number;
  avgConfidence: number;
}

// Define signal formulas to test
const SIGNAL_FORMULAS: SignalFormula[] = [
  {
    name: 'holdings_only',
    description: 'Pure smart money holdings ratio',
    calculate: (m) => m.smart_money_odds,
  },
  {
    name: 'holdings_tier_weighted',
    description: 'Superforecasters weighted 2x vs smart',
    calculate: (m) => {
      const sfYes = m.superforecaster_yes_usd * 2;
      const sfNo = m.superforecaster_no_usd * 2;
      const smYes = m.smart_yes_usd;
      const smNo = m.smart_no_usd;
      const totalYes = sfYes + smYes + (m.yes_usd - m.superforecaster_yes_usd - m.smart_yes_usd);
      const totalNo = sfNo + smNo + (m.no_usd - m.superforecaster_no_usd - m.smart_no_usd);
      const total = totalYes + totalNo;
      return total > 0 ? totalYes / total : 0.5;
    },
  },
  {
    name: 'holdings_flow_blend',
    description: '70% holdings + 30% flow direction',
    calculate: (m) => {
      const flowSignal = m.flow_24h > 0 ? 0.6 : (m.flow_24h < 0 ? 0.4 : 0.5);
      return 0.7 * m.smart_money_odds + 0.3 * flowSignal;
    },
  },
  {
    name: 'holdings_entry_blend',
    description: '60% holdings + 40% entry edge adjusted',
    calculate: (m) => {
      // If smart money has positive entry edge (bought cheaper), boost signal
      const edgeBoost = m.entry_edge_pct > 0 ? 0.1 : (m.entry_edge_pct < -10 ? -0.1 : 0);
      return Math.max(0, Math.min(1, m.smart_money_odds + edgeBoost));
    },
  },
  {
    name: 'conviction_weighted',
    description: 'Holdings weighted by conviction (position size)',
    calculate: (m) => {
      // Higher avg position size = more conviction, boost away from 0.5
      const convictionMultiplier = Math.min(2, m.avg_position_size / 500 + 1);
      const deviation = m.smart_money_odds - 0.5;
      return 0.5 + deviation * convictionMultiplier;
    },
  },
  {
    name: 'momentum_blend',
    description: '50% holdings + 30% 24h flow + 20% 7d flow',
    calculate: (m) => {
      const flow24Signal = m.flow_24h > 1000 ? 0.7 : (m.flow_24h < -1000 ? 0.3 : 0.5);
      const flow7dSignal = m.flow_7d > 5000 ? 0.7 : (m.flow_7d < -5000 ? 0.3 : 0.5);
      return 0.5 * m.smart_money_odds + 0.3 * flow24Signal + 0.2 * flow7dSignal;
    },
  },
  {
    name: 'underwater_adjusted',
    description: 'Holdings penalized if many wallets underwater',
    calculate: (m) => {
      // If >50% underwater, reduce confidence in signal
      const underwaterPenalty = m.pct_wallets_underwater > 50 ? 0.2 : 0;
      const rawSignal = m.smart_money_odds;
      // Pull signal toward 0.5 based on underwater %
      return rawSignal * (1 - underwaterPenalty) + 0.5 * underwaterPenalty;
    },
  },
  {
    name: 'superforecaster_only',
    description: 'Only superforecaster positions',
    calculate: (m) => {
      const total = m.superforecaster_yes_usd + m.superforecaster_no_usd;
      return total > 0 ? m.superforecaster_yes_usd / total : 0.5;
    },
  },
  {
    name: 'full_blend',
    description: '40% holdings + 25% flow + 20% entry + 15% conviction',
    calculate: (m) => {
      // Holdings component
      const holdings = m.smart_money_odds;

      // Flow component (normalized to 0-1)
      const flowScore = m.flow_24h > 2000 ? 0.8 :
                        m.flow_24h > 500 ? 0.65 :
                        m.flow_24h > 0 ? 0.55 :
                        m.flow_24h > -500 ? 0.45 :
                        m.flow_24h > -2000 ? 0.35 : 0.2;

      // Entry edge component
      const entryScore = m.entry_edge_pct > 10 ? 0.8 :
                         m.entry_edge_pct > 0 ? 0.6 :
                         m.entry_edge_pct > -10 ? 0.4 : 0.2;

      // Conviction component (high concentration = high conviction)
      const convictionScore = m.top5_concentration > 60 ? 0.7 :
                              m.top5_concentration > 40 ? 0.6 : 0.5;

      return 0.4 * holdings + 0.25 * flowScore + 0.2 * entryScore + 0.15 * convictionScore;
    },
  },
  {
    name: 'contrarian_crowd',
    description: 'Smart money odds inverted when crowd is extreme',
    calculate: (m) => {
      // If crowd is extreme (>80% or <20%), check if smart money disagrees
      if (m.crowd_price > 0.8 && m.smart_money_odds < 0.6) {
        return m.smart_money_odds * 0.8; // Boost NO signal
      }
      if (m.crowd_price < 0.2 && m.smart_money_odds > 0.4) {
        return m.smart_money_odds * 1.2; // Boost YES signal
      }
      return m.smart_money_odds;
    },
  },
];

async function getResolvedMarketsWithMetrics(): Promise<MetricsSnapshot[]> {
  console.log('Fetching resolved markets with metrics...');

  const result = await clickhouse.query({
    query: `
      WITH resolved_outcomes AS (
        SELECT
          condition_id,
          any(outcome_side) as outcome_won,
          max(ts_resolve) as resolution_time
        FROM wio_positions_v2
        WHERE is_resolved = 1 AND outcome_side IS NOT NULL
        GROUP BY condition_id
      )
      SELECT
        m.market_id,
        m.ts,
        dateDiff('hour', m.ts, r.resolution_time) as hours_before_resolution,
        r.outcome_won,
        m.crowd_price,
        m.smart_money_odds,
        m.yes_usd,
        m.no_usd,
        m.total_usd,
        m.wallet_count,
        m.avg_entry_price,
        m.entry_edge_pct,
        m.pct_wallets_underwater,
        m.total_unrealized_pnl,
        m.flow_1h,
        m.flow_24h,
        m.flow_7d,
        m.avg_position_size,
        m.top5_concentration,
        m.superforecaster_yes_usd,
        m.superforecaster_no_usd,
        m.smart_yes_usd,
        m.smart_no_usd
      FROM wio_smart_money_metrics_v1 m
      JOIN resolved_outcomes r ON m.market_id = r.condition_id
      WHERE m.total_usd >= 1000
        AND dateDiff('hour', m.ts, r.resolution_time) >= 1
      ORDER BY m.market_id, m.ts
    `,
    format: 'JSONEachRow',
  });

  return result.json() as Promise<MetricsSnapshot[]>;
}

function evaluateFormula(
  formula: SignalFormula,
  snapshots: MetricsSnapshot[]
): BacktestResult {
  let correct = 0;
  let correctAt24h = 0;
  let correctAt72h = 0;
  let count24h = 0;
  let count72h = 0;
  let totalEdge = 0;
  let totalConfidence = 0;

  // For calibration: bucket predictions and track actual outcomes
  const calibrationBuckets: Map<number, { predictions: number; wins: number }> = new Map();
  for (let i = 0; i <= 10; i++) {
    calibrationBuckets.set(i, { predictions: 0, wins: 0 });
  }

  for (const snapshot of snapshots) {
    const signal = formula.calculate(snapshot);
    const predictedYes = signal > 0.5;
    const actualYes = snapshot.outcome_won === 0; // outcome_side=0 means YES won

    const isCorrect = predictedYes === actualYes;
    if (isCorrect) correct++;

    // Track accuracy at different time horizons
    if (snapshot.hours_before_resolution >= 24) {
      count24h++;
      if (isCorrect) correctAt24h++;
    }
    if (snapshot.hours_before_resolution >= 72) {
      count72h++;
      if (isCorrect) correctAt72h++;
    }

    // Edge vs crowd
    const crowdPredictedYes = snapshot.crowd_price > 0.5;
    const crowdCorrect = crowdPredictedYes === actualYes;
    totalEdge += (isCorrect ? 1 : 0) - (crowdCorrect ? 1 : 0);

    // Confidence (distance from 0.5)
    totalConfidence += Math.abs(signal - 0.5);

    // Calibration tracking
    const bucket = Math.round(signal * 10);
    const bucketData = calibrationBuckets.get(bucket)!;
    bucketData.predictions++;
    if (actualYes) bucketData.wins++;
  }

  // Calculate calibration error (average difference between predicted and actual win rate)
  let calibrationError = 0;
  let calibrationCount = 0;
  for (const [bucket, data] of calibrationBuckets) {
    if (data.predictions >= 10) {
      const expectedWinRate = bucket / 10;
      const actualWinRate = data.wins / data.predictions;
      calibrationError += Math.abs(expectedWinRate - actualWinRate);
      calibrationCount++;
    }
  }

  return {
    formula: formula.name,
    description: formula.description,
    totalPredictions: snapshots.length,
    accuracy: snapshots.length > 0 ? (correct / snapshots.length) * 100 : 0,
    accuracyAt24h: count24h > 0 ? (correctAt24h / count24h) * 100 : 0,
    accuracyAt72h: count72h > 0 ? (correctAt72h / count72h) * 100 : 0,
    edgeVsCrowd: snapshots.length > 0 ? (totalEdge / snapshots.length) * 100 : 0,
    calibrationError: calibrationCount > 0 ? (calibrationError / calibrationCount) * 100 : 0,
    avgConfidence: snapshots.length > 0 ? (totalConfidence / snapshots.length) * 100 : 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const minSnapshotsArg = args.find(a => a.startsWith('--min-snapshots='));
  const minSnapshots = minSnapshotsArg ? parseInt(minSnapshotsArg.split('=')[1]) : 10;

  console.log('=== Smart Money Signal Backtest ===\n');

  const snapshots = await getResolvedMarketsWithMetrics();
  console.log(`Loaded ${snapshots.length.toLocaleString()} snapshots from resolved markets\n`);

  if (snapshots.length < minSnapshots) {
    console.log(`Not enough data for meaningful backtest (need ${minSnapshots}+ snapshots)`);
    console.log('Wait for more resolved markets to have metrics populated.');
    await clickhouse.close();
    return;
  }

  // Group by market for per-market stats
  const marketSnapshots = new Map<string, MetricsSnapshot[]>();
  for (const s of snapshots) {
    if (!marketSnapshots.has(s.market_id)) {
      marketSnapshots.set(s.market_id, []);
    }
    marketSnapshots.get(s.market_id)!.push(s);
  }
  console.log(`Covering ${marketSnapshots.size} resolved markets\n`);

  // Run backtest for each formula
  const results: BacktestResult[] = [];
  for (const formula of SIGNAL_FORMULAS) {
    const result = evaluateFormula(formula, snapshots);
    results.push(result);
  }

  // Sort by accuracy
  results.sort((a, b) => b.accuracy - a.accuracy);

  // Display results
  console.log('=== BACKTEST RESULTS ===\n');
  console.log('Ranked by overall accuracy:\n');

  console.log('| Rank | Formula | Accuracy | @24h | @72h | Edge vs Crowd | Calibration Err |');
  console.log('|------|---------|----------|------|------|---------------|-----------------|');

  results.forEach((r, i) => {
    console.log(
      `| ${(i + 1).toString().padStart(4)} | ${r.formula.padEnd(20).slice(0, 20)} | ` +
      `${r.accuracy.toFixed(1).padStart(6)}% | ${r.accuracyAt24h.toFixed(1).padStart(4)}% | ` +
      `${r.accuracyAt72h.toFixed(1).padStart(4)}% | ${r.edgeVsCrowd >= 0 ? '+' : ''}${r.edgeVsCrowd.toFixed(1).padStart(5)}% | ` +
      `${r.calibrationError.toFixed(1).padStart(7)}% |`
    );
  });

  console.log('\n=== TOP PERFORMER DETAILS ===\n');
  const top = results[0];
  console.log(`Best Formula: ${top.formula}`);
  console.log(`Description: ${top.description}`);
  console.log(`\nMetrics:`);
  console.log(`  Overall Accuracy: ${top.accuracy.toFixed(1)}%`);
  console.log(`  Accuracy at 24h+: ${top.accuracyAt24h.toFixed(1)}%`);
  console.log(`  Accuracy at 72h+: ${top.accuracyAt72h.toFixed(1)}%`);
  console.log(`  Edge vs Crowd: ${top.edgeVsCrowd >= 0 ? '+' : ''}${top.edgeVsCrowd.toFixed(2)}%`);
  console.log(`  Calibration Error: ${top.calibrationError.toFixed(1)}%`);
  console.log(`  Avg Confidence: ${top.avgConfidence.toFixed(1)}%`);

  // Additional analysis: accuracy by confidence level
  console.log('\n=== ACCURACY BY CONFIDENCE (Top Formula) ===\n');

  const topFormula = SIGNAL_FORMULAS.find(f => f.name === top.formula)!;
  const confidenceBuckets: Map<string, { correct: number; total: number }> = new Map([
    ['low (50-55%)', { correct: 0, total: 0 }],
    ['medium (55-65%)', { correct: 0, total: 0 }],
    ['high (65-80%)', { correct: 0, total: 0 }],
    ['very high (80%+)', { correct: 0, total: 0 }],
  ]);

  for (const snapshot of snapshots) {
    const signal = topFormula.calculate(snapshot);
    const confidence = Math.abs(signal - 0.5) * 2; // 0-1 scale
    const predictedYes = signal > 0.5;
    const actualYes = snapshot.outcome_won === 0;
    const isCorrect = predictedYes === actualYes;

    let bucket: string;
    if (confidence < 0.1) bucket = 'low (50-55%)';
    else if (confidence < 0.3) bucket = 'medium (55-65%)';
    else if (confidence < 0.6) bucket = 'high (65-80%)';
    else bucket = 'very high (80%+)';

    const data = confidenceBuckets.get(bucket)!;
    data.total++;
    if (isCorrect) data.correct++;
  }

  for (const [bucket, data] of confidenceBuckets) {
    const accuracy = data.total > 0 ? (data.correct / data.total) * 100 : 0;
    console.log(`  ${bucket.padEnd(20)}: ${accuracy.toFixed(1)}% (n=${data.total})`);
  }

  await clickhouse.close();
}

main().catch(console.error);
