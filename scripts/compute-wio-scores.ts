/**
 * WIO Scores Computation Script
 *
 * Computes wallet scores based on metrics:
 * - Credibility: How trustworthy is this forecaster?
 * - Bot Likelihood: Is this wallet automated/MM?
 * - Copyability: How easy is it to follow this wallet?
 *
 * Also generates dot events for significant moves by credible wallets.
 *
 * Usage: npx tsx scripts/compute-wio-scores.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function computeWalletScores(): Promise<number> {
  console.log('  Computing wallet scores...');
  const startTime = Date.now();

  // Compute scores for 90d window (most relevant for current behavior)
  const query = `
    INSERT INTO wio_wallet_scores_v1
    SELECT
      wallet_id,
      2 as window_id,  -- 90d

      -- Credibility Score (0-1)
      -- Based on: skill (ROI, win rate) + consistency (profit factor) + sample size
      (
        -- Skill component (0-0.5): ROI and win rate
        (
          0.25 * least(greatest(roi_cost_weighted, 0), 1.0) +
          0.25 * IF(win_rate > 0.5, (win_rate - 0.5) * 2, 0)
        ) +
        -- Consistency component (0-0.3): profit factor
        (
          0.3 * IF(profit_factor > 1 AND profit_factor < 999,
            least((profit_factor - 1) / 3, 1),
            0
          )
        ) +
        -- Risk penalty component (0-0.2): negative for heavy losses
        (
          0.2 * IF(max_loss_roi > -1, 1, greatest(0, 1 + max_loss_roi))
        )
      ) *
      -- Sample size shrinkage (Bayesian prior)
      (resolved_positions_n / (resolved_positions_n + 20.0)) *
      -- Bot penalty
      IF(fills_per_day >= 100, 0.3, IF(fills_per_day >= 50, 0.7, 1.0))
      as credibility_score,

      -- Bot Likelihood (0-1)
      least(1.0,
        -- Fill rate signal (0-0.4)
        0.4 * least(fills_per_day / 100.0, 1.0) +
        -- Scalper signal (0-0.3): very short holds
        0.3 * IF(hold_minutes_p50 < 60 AND hold_minutes_p50 > 0,
          1 - hold_minutes_p50 / 60.0,
          0
        ) +
        -- High activity signal (0-0.3)
        0.3 * IF(active_days_n > 0 AND positions_n / active_days_n > 50,
          least((positions_n / active_days_n - 50) / 100.0, 1.0),
          0
        )
      ) as bot_likelihood,

      -- Copyability Score (0-1)
      -- Easy to copy = reasonable hold time, not too risky, consistent
      (
        -- Horizon component (0-0.3): reasonable hold time (1hr+)
        0.3 * IF(hold_minutes_p50 >= 60, 1, IF(hold_minutes_p50 > 0, hold_minutes_p50 / 60.0, 0)) +
        -- Risk component (0-0.25): not too much drawdown
        0.25 * IF(max_loss_roi > -0.5, 1, greatest(0, 1 + 2 * max_loss_roi)) +
        -- Consistency component (0-0.25): reasonable win rate
        0.25 * IF(win_rate > 0.4, least((win_rate - 0.4) / 0.3, 1), 0) +
        -- Not a bot component (0-0.2)
        0.2 * IF(fills_per_day < 50, 1, greatest(0, 1 - (fills_per_day - 50) / 50.0))
      ) as copyability_score,

      -- Component breakdowns
      -- Skill component
      0.25 * least(greatest(roi_cost_weighted, 0), 1.0) +
      0.25 * IF(win_rate > 0.5, (win_rate - 0.5) * 2, 0) as skill_component,

      -- Consistency component
      0.3 * IF(profit_factor > 1 AND profit_factor < 999, least((profit_factor - 1) / 3, 1), 0) as consistency_component,

      -- Sample size factor
      resolved_positions_n / (resolved_positions_n + 20.0) as sample_size_factor,

      -- Bot components
      0.4 * least(fills_per_day / 100.0, 1.0) as fill_rate_signal,
      0.3 * IF(hold_minutes_p50 < 60 AND hold_minutes_p50 > 0, 1 - hold_minutes_p50 / 60.0, 0) as scalper_signal,

      -- Copyability components
      0.3 * IF(hold_minutes_p50 >= 60, 1, IF(hold_minutes_p50 > 0, hold_minutes_p50 / 60.0, 0)) as horizon_component,
      0.25 * IF(max_loss_roi > -0.5, 1, greatest(0, 1 + 2 * max_loss_roi)) as risk_component,

      now() as computed_at

    FROM wio_metric_observations_v1
    WHERE scope_type = 'GLOBAL'
      AND window_id = 2  -- 90d
      AND positions_n >= 5  -- Minimum activity
  `;

  await clickhouse.command({ query });

  // Count inserted rows
  const countResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM wio_wallet_scores_v1 WHERE window_id = 2',
    format: 'JSONEachRow'
  });
  const countRows = await countResult.json() as { cnt: string }[];
  const insertedCount = parseInt(countRows[0]?.cnt || '0');

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`    Computed scores for ${insertedCount.toLocaleString()} wallets in ${elapsed.toFixed(1)}s`);

  return insertedCount;
}

async function generateDotEvents(): Promise<number> {
  console.log('  Generating dot events for recent smart money moves...');
  const startTime = Date.now();

  // Generate dots for recent fills by high-credibility wallets
  // Look at recent open positions (last 7 days) by wallets with credibility >= 0.3
  const query = `
    INSERT INTO wio_dot_events_v1
    SELECT
      -- Generate unique dot ID
      toString(cityHash64(concat(p.wallet_id, p.condition_id, toString(p.ts_open)))) as dot_id,
      p.ts_open as ts,

      -- Context
      p.wallet_id,
      p.condition_id as market_id,
      p.primary_bundle_id as bundle_id,

      -- Action (simplified - treat all as ENTER for initial positions)
      'ENTER' as action,
      p.side,
      p.cost_usd as size_usd,

      -- Classification based on credibility
      CASE
        WHEN s.credibility_score >= 0.5 THEN 'SUPERFORECASTER'
        WHEN s.credibility_score >= 0.3 THEN 'SMART_MONEY'
        ELSE 'SMART_MONEY'
      END as dot_type,

      s.credibility_score as confidence,

      -- Reason metrics
      arrayFilter(x -> x != '', [
        IF(s.credibility_score >= 0.5, 'high_credibility', ''),
        IF(s.skill_component >= 0.3, 'high_skill', ''),
        IF(s.sample_size_factor >= 0.7, 'large_sample', ''),
        IF(p.cost_usd >= 1000, 'large_position', '')
      ]) as reason_metrics,

      -- Scores
      s.credibility_score,
      s.bot_likelihood,

      -- Market context
      ifNull(mp.mark_price, 0.5) as crowd_odds,
      p.p_entry_side as entry_price,

      now() as created_at

    FROM wio_positions_v2 p
    INNER JOIN wio_wallet_scores_v1 s ON p.wallet_id = s.wallet_id AND s.window_id = 2
    LEFT JOIN pm_latest_mark_price_v1 mp ON p.condition_id = mp.condition_id
    WHERE p.ts_open >= now() - INTERVAL 7 DAY
      AND s.credibility_score >= 0.3
      AND s.bot_likelihood < 0.5
      AND p.cost_usd >= 100  -- Minimum $100 position
      AND p.is_resolved = 0  -- Still open
  `;

  await clickhouse.command({ query });

  // Count inserted rows
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM wio_dot_events_v1
      WHERE created_at >= now() - INTERVAL 1 MINUTE
    `,
    format: 'JSONEachRow'
  });
  const countRows = await countResult.json() as { cnt: string }[];
  const insertedCount = parseInt(countRows[0]?.cnt || '0');

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`    Generated ${insertedCount.toLocaleString()} dot events in ${elapsed.toFixed(1)}s`);

  return insertedCount;
}

async function validateScores(): Promise<void> {
  console.log('\nValidating scores...');

  // Score distribution
  const distResult = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN credibility_score >= 0.5 THEN 'superforecaster (>=0.5)'
          WHEN credibility_score >= 0.3 THEN 'smart_money (0.3-0.5)'
          WHEN credibility_score >= 0.1 THEN 'profitable (0.1-0.3)'
          ELSE 'low (<0.1)'
        END as tier,
        count() as wallets,
        round(avg(credibility_score), 3) as avg_cred,
        round(avg(bot_likelihood), 3) as avg_bot,
        round(avg(copyability_score), 3) as avg_copy
      FROM wio_wallet_scores_v1
      WHERE window_id = 2
      GROUP BY tier
      ORDER BY avg_cred DESC
    `,
    format: 'JSONEachRow'
  });
  const dist = await distResult.json() as any[];

  console.log('\nScore distribution:');
  console.log('Tier                    | Wallets   | Avg Cred | Avg Bot | Avg Copy');
  console.log('------------------------|-----------|----------|---------|----------');
  for (const d of dist) {
    console.log(`${d.tier.padEnd(23)} | ${String(d.wallets).padStart(9)} | ${String(d.avg_cred).padStart(8)} | ${String(d.avg_bot).padStart(7)} | ${String(d.avg_copy).padStart(8)}`);
  }

  // Top credible wallets
  const topResult = await clickhouse.query({
    query: `
      SELECT
        s.wallet_id,
        round(s.credibility_score, 3) as cred,
        round(s.bot_likelihood, 3) as bot,
        round(s.copyability_score, 3) as copy,
        m.resolved_positions_n as resolved,
        round(m.pnl_total_usd, 0) as pnl,
        round(m.win_rate * 100, 1) as win_pct
      FROM wio_wallet_scores_v1 s
      JOIN wio_metric_observations_v1 m ON s.wallet_id = m.wallet_id
        AND m.scope_type = 'GLOBAL' AND m.window_id = 2
      WHERE s.window_id = 2
        AND s.bot_likelihood < 0.3  -- Exclude bots
      ORDER BY s.credibility_score DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const top = await topResult.json() as any[];

  console.log('\nTop 10 credible non-bot wallets:');
  console.log('Wallet         | Cred  | Bot   | Copy  | Resolved | PnL       | Win%');
  console.log('---------------|-------|-------|-------|----------|-----------|------');
  for (const t of top) {
    const wallet = t.wallet_id.slice(0, 13);
    console.log(`${wallet}... | ${String(t.cred).padStart(5)} | ${String(t.bot).padStart(5)} | ${String(t.copy).padStart(5)} | ${String(t.resolved).padStart(8)} | $${String(t.pnl).padStart(8)} | ${String(t.win_pct).padStart(4)}%`);
  }

  // Sample dot events
  const dotResult = await clickhouse.query({
    query: `
      SELECT
        d.wallet_id,
        d.market_id,
        d.dot_type,
        d.side,
        round(d.size_usd, 0) as size,
        round(d.confidence, 3) as conf,
        round(d.crowd_odds * 100, 1) as crowd_pct,
        round(d.entry_price * 100, 1) as entry_pct,
        d.reason_metrics
      FROM wio_dot_events_v1 d
      WHERE d.created_at >= now() - INTERVAL 1 MINUTE
      ORDER BY d.confidence DESC, d.size_usd DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const dots = await dotResult.json() as any[];

  if (dots.length > 0) {
    console.log('\nRecent dot events (top 10):');
    console.log('Wallet         | Type            | Side | Size      | Conf  | Entry | Reasons');
    console.log('---------------|-----------------|------|-----------|-------|-------|--------');
    for (const d of dots) {
      const wallet = d.wallet_id.slice(0, 13);
      const reasons = d.reason_metrics.join(', ');
      console.log(`${wallet}... | ${d.dot_type.padEnd(15)} | ${d.side.padEnd(4)} | $${String(d.size).padStart(8)} | ${String(d.conf).padStart(5)} | ${String(d.entry_pct).padStart(4)}% | ${reasons}`);
    }
  } else {
    console.log('\nNo dot events generated (may need recent trading activity)');
  }
}

async function truncateScores(): Promise<void> {
  await clickhouse.command({
    query: 'TRUNCATE TABLE wio_wallet_scores_v1'
  });
  await clickhouse.command({
    query: 'TRUNCATE TABLE wio_dot_events_v1'
  });
}

async function main() {
  console.log('============================================================');
  console.log('WIO Scores & Dots Computation');
  console.log('============================================================\n');

  // Check for fresh start
  const existingResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM wio_wallet_scores_v1',
    format: 'JSONEachRow'
  });
  const existingRows = await existingResult.json() as { cnt: string }[];
  const existingCount = parseInt(existingRows[0]?.cnt || '0');

  if (existingCount > 0) {
    console.log(`Existing scores: ${existingCount.toLocaleString()}`);
    console.log('Truncating for fresh computation...\n');
    await truncateScores();
  }

  console.log('Step 1: Computing wallet scores...');
  const scoreCount = await computeWalletScores();

  console.log('\nStep 2: Generating dot events...');
  const dotCount = await generateDotEvents();

  console.log('\nStep 3: Summary');
  console.log(`  Wallet scores: ${scoreCount.toLocaleString()}`);
  console.log(`  Dot events: ${dotCount.toLocaleString()}`);

  await validateScores();

  console.log('\n============================================================');
  console.log('SCORES & DOTS COMPUTATION COMPLETE');
  console.log('============================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
