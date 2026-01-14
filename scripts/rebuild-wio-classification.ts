/**
 * Rebuild WIO Wallet Classification Table
 *
 * This script rebuilds wio_wallet_classification_v1 from:
 * - wio_metric_observations_v1 (metrics per wallet per window)
 * - wio_wallet_scores_v1 (credibility, bot_likelihood, copyability)
 *
 * BUGS FIXED:
 * 1. Previously used wrong window data (1d data labeled as 90d)
 * 2. Bot detection now uses positions_per_day instead of fills_per_day
 *
 * Usage: npx tsx scripts/rebuild-wio-classification.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function truncateClassification(): Promise<void> {
  console.log('Truncating existing classification data...');
  await clickhouse.command({
    query: 'TRUNCATE TABLE wio_wallet_classification_v1'
  });
}

async function rebuildClassification(): Promise<number> {
  console.log('Rebuilding classification from metrics + scores...');
  const startTime = Date.now();

  // Build classification for 90d window (the primary window used for tier classification)
  const query = `
    INSERT INTO wio_wallet_classification_v1
    SELECT
      m.wallet_id,
      '90d' as window_id,

      -- Tier classification based on credibility score + profitability
      CASE
        -- Bot detection based on fills per day:
        -- >500 fills/day = likely automated (bot)
        -- 200-500 = very active human (not bot)
        -- <200 = typical human (not bot)
        WHEN m.fills_per_day > 500 THEN 'bot'

        -- Inactive: no activity in 90d
        WHEN m.positions_n < 5 THEN 'inactive'

        -- Superforecaster: high credibility
        WHEN s.credibility_score >= 0.5 THEN 'superforecaster'

        -- Smart money: moderate credibility
        WHEN s.credibility_score >= 0.3 THEN 'smart'

        -- Profitable: positive ROI and profit
        WHEN m.roi_cost_weighted > 0 AND m.pnl_total_usd > 0 THEN 'profitable'

        -- Slight loser: small negative
        WHEN m.roi_cost_weighted > -0.1 THEN 'slight_loser'

        -- Heavy loser: significant losses
        ELSE 'heavy_loser'
      END as tier,

      -- Metrics
      m.roi_cost_weighted,
      m.win_rate,
      m.pnl_total_usd,
      toInt32(m.resolved_positions_n) as resolved_positions_n,

      -- Use actual fills_per_day for bot detection
      -- >500 = bot, 200-500 = very active, <200 = typical human
      m.fills_per_day as fills_per_day,

      -- Scores
      coalesce(s.credibility_score, 0) as credibility_score,
      coalesce(s.bot_likelihood,
        -- Fallback bot detection if no scores exist
        -- >500 fills/day = bot (1.0), 200-500 = high activity (0.5), <200 = human (0.1)
        IF(m.fills_per_day > 500, 1.0,
          IF(m.fills_per_day > 200, 0.5, 0.1)
        )
      ) as bot_likelihood,

      now() as computed_at

    FROM wio_metric_observations_v1 m
    LEFT JOIN wio_wallet_scores_v1 s
      ON m.wallet_id = s.wallet_id
      AND s.window_id = '90d'  -- 90d window in scores table
    WHERE m.scope_type = 'GLOBAL'
      AND m.window_id = '90d'  -- 90d window (NOT '1d'!)
      AND m.positions_n >= 1  -- Has at least some activity
  `;

  await clickhouse.command({ query });

  const elapsed = (Date.now() - startTime) / 1000;

  // Count inserted rows
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM wio_wallet_classification_v1`,
    format: 'JSONEachRow'
  });
  const rows = await countResult.json() as { cnt: string }[];
  const insertedCount = parseInt(rows[0]?.cnt || '0');

  console.log(`Rebuilt ${insertedCount.toLocaleString()} wallet classifications in ${elapsed.toFixed(1)}s`);
  return insertedCount;
}

async function validateResults(): Promise<void> {
  console.log('\nValidating results...');

  // Check tier distribution
  const tierResult = await clickhouse.query({
    query: `
      SELECT
        tier,
        count() as wallets,
        round(avg(pnl_total_usd), 0) as avg_pnl,
        round(avg(roi_cost_weighted * 100), 2) as avg_roi_pct,
        round(avg(win_rate * 100), 1) as avg_win_pct
      FROM wio_wallet_classification_v1
      GROUP BY tier
      ORDER BY
        CASE tier
          WHEN 'superforecaster' THEN 1
          WHEN 'smart' THEN 2
          WHEN 'profitable' THEN 3
          WHEN 'slight_loser' THEN 4
          WHEN 'heavy_loser' THEN 5
          WHEN 'bot' THEN 6
          WHEN 'inactive' THEN 7
        END
    `,
    format: 'JSONEachRow'
  });
  const tiers = await tierResult.json() as any[];

  console.log('\nTier Distribution:');
  console.log('Tier            | Wallets    | Avg PnL       | Avg ROI% | Win%');
  console.log('----------------|------------|---------------|----------|------');
  for (const t of tiers) {
    const pnl = `$${Math.round(t.avg_pnl).toLocaleString()}`.padEnd(13);
    console.log(`${t.tier.padEnd(15)} | ${String(t.wallets).padStart(10)} | ${pnl} | ${String(t.avg_roi_pct).padStart(8)}% | ${String(t.avg_win_pct).padStart(4)}%`);
  }

  // Check @ScottyNooo specifically
  const scottyResult = await clickhouse.query({
    query: `
      SELECT
        wallet_id,
        tier,
        round(pnl_total_usd, 0) as pnl,
        resolved_positions_n,
        round(roi_cost_weighted * 100, 2) as roi_pct,
        round(win_rate * 100, 1) as win_pct,
        round(fills_per_day, 1) as positions_per_day,
        round(credibility_score, 3) as cred,
        round(bot_likelihood, 3) as bot
      FROM wio_wallet_classification_v1
      WHERE wallet_id = '0xbacd00c9080a82ded56f504ee8810af732b0ab35'
    `,
    format: 'JSONEachRow'
  });
  const scotty = await scottyResult.json() as any[];

  if (scotty.length > 0) {
    const s = scotty[0];
    console.log('\n@ScottyNooo Validation:');
    console.log(`  Tier: ${s.tier}`);
    console.log(`  PnL: $${s.pnl.toLocaleString()}`);
    console.log(`  Resolved Positions: ${s.resolved_positions_n}`);
    console.log(`  ROI: ${s.roi_pct}%`);
    console.log(`  Win Rate: ${s.win_pct}%`);
    console.log(`  Positions/Day: ${s.positions_per_day}`);
    console.log(`  Credibility: ${s.cred}`);
    console.log(`  Bot Likelihood: ${s.bot}`);

    // Compare to expected values
    console.log('\n  Expected vs Actual:');
    console.log(`    Positions: ${s.resolved_positions_n} (expected ~1,979 for 90d)`);
    console.log(`    PnL: $${s.pnl.toLocaleString()} (expected ~$316k for 90d)`);
  }
}

async function main() {
  console.log('============================================================');
  console.log('WIO Wallet Classification Rebuild');
  console.log('============================================================');
  console.log('Fixes: Uses correct 90d window data, positions/day for bot detection');
  console.log('============================================================\n');

  await truncateClassification();
  const count = await rebuildClassification();
  await validateResults();

  console.log('\n============================================================');
  console.log(`CLASSIFICATION REBUILD COMPLETE: ${count.toLocaleString()} wallets`);
  console.log('============================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
