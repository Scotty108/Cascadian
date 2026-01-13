/**
 * One-time script to compute WIO metrics and scores
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('Creating metrics table...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS wio_wallet_metrics_v1 (
        wallet_id String,
        scope String,
        time_window String,
        total_positions UInt32,
        total_cost_usd Float64,
        total_pnl_usd Float64,
        roi Float64,
        win_rate Float64,
        avg_position_size Float64,
        avg_brier_score Nullable(Float64),
        resolved_positions UInt32,
        avg_hold_minutes Float64,
        avg_clv_4h Nullable(Float64),
        avg_clv_24h Nullable(Float64),
        computed_at DateTime DEFAULT now(),
        PRIMARY KEY (wallet_id, scope, time_window)
      ) ENGINE = ReplacingMergeTree(computed_at)
      ORDER BY (wallet_id, scope, time_window)
    `,
  });

  console.log('Computing GLOBAL ALL metrics...');

  await clickhouse.command({
    query: `
      INSERT INTO wio_wallet_metrics_v1 (
        wallet_id, scope, time_window,
        total_positions, total_cost_usd, total_pnl_usd,
        roi, win_rate, avg_position_size,
        avg_brier_score, resolved_positions,
        avg_hold_minutes, avg_clv_4h, avg_clv_24h
      )
      SELECT
        wallet_id,
        'GLOBAL' as scope,
        'ALL' as time_window,
        count() as total_positions,
        sum(cost_usd) as total_cost_usd,
        sum(pnl_usd) as total_pnl_usd,
        if(sum(cost_usd) > 0, sum(pnl_usd) / sum(cost_usd), 0) as roi,
        countIf(pnl_usd > 0) / count() as win_rate,
        avg(cost_usd) as avg_position_size,
        avgIf(brier_score, brier_score IS NOT NULL) as avg_brier_score,
        countIf(is_resolved = 1) as resolved_positions,
        avg(hold_minutes) as avg_hold_minutes,
        avgIf(p_anchor_4h_side - p_entry_side, p_anchor_4h_side IS NOT NULL) as avg_clv_4h,
        avgIf(p_anchor_24h_side - p_entry_side, p_anchor_24h_side IS NOT NULL) as avg_clv_24h
      FROM wio_positions_v1
      GROUP BY wallet_id
      HAVING total_positions >= 5
    `,
  });

  const metricsCount = await clickhouse.query({
    query: `SELECT count() as cnt, uniqExact(wallet_id) as wallets FROM wio_wallet_metrics_v1`,
    format: 'JSONEachRow',
  });
  const mc = ((await metricsCount.json()) as any[])[0];
  console.log(`Metrics computed: ${mc.cnt} rows, ${mc.wallets} wallets`);

  console.log('Creating scores table...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS wio_wallet_scores_v1 (
        wallet_id String,
        composite_score Float64,
        roi_percentile Float64,
        brier_percentile Float64,
        volume_percentile Float64,
        consistency_score Float64,
        rank UInt32,
        tier String,
        computed_at DateTime DEFAULT now(),
        PRIMARY KEY (wallet_id)
      ) ENGINE = ReplacingMergeTree(computed_at)
      ORDER BY wallet_id
    `,
  });

  console.log('Computing scores...');

  await clickhouse.command({
    query: `
      INSERT INTO wio_wallet_scores_v1 (
        wallet_id, composite_score, roi_percentile, brier_percentile,
        volume_percentile, consistency_score, rank, tier
      )
      WITH
        base_metrics AS (
          SELECT wallet_id, roi, avg_brier_score, total_cost_usd, win_rate
          FROM wio_wallet_metrics_v1
          WHERE scope = 'GLOBAL' AND time_window = 'ALL'
            AND total_positions >= 10
            AND total_cost_usd >= 100
        ),
        percentiles AS (
          SELECT
            wallet_id, roi, avg_brier_score, total_cost_usd, win_rate,
            percent_rank() OVER (ORDER BY roi) as roi_pct,
            percent_rank() OVER (ORDER BY avg_brier_score DESC) as brier_pct,
            percent_rank() OVER (ORDER BY total_cost_usd) as volume_pct
          FROM base_metrics
        ),
        scored AS (
          SELECT
            wallet_id,
            roi_pct * 0.35 + brier_pct * 0.35 + volume_pct * 0.15 + win_rate * 0.15 as composite,
            roi_pct, brier_pct, volume_pct, win_rate
          FROM percentiles
        )
      SELECT
        wallet_id,
        composite as composite_score,
        roi_pct as roi_percentile,
        brier_pct as brier_percentile,
        volume_pct as volume_percentile,
        win_rate as consistency_score,
        row_number() OVER (ORDER BY composite DESC) as rank,
        CASE
          WHEN composite >= 0.9 THEN 'S'
          WHEN composite >= 0.75 THEN 'A'
          WHEN composite >= 0.5 THEN 'B'
          ELSE 'C'
        END as tier
      FROM scored
    `,
  });

  const scoresCount = await clickhouse.query({
    query: `SELECT count() as cnt FROM wio_wallet_scores_v1`,
    format: 'JSONEachRow',
  });
  const sc = ((await scoresCount.json()) as any[])[0];
  console.log(`Scores computed: ${sc.cnt} wallets`);

  // Show tier distribution
  const tiers = await clickhouse.query({
    query: `SELECT tier, count() as cnt FROM wio_wallet_scores_v1 GROUP BY tier ORDER BY tier`,
    format: 'JSONEachRow',
  });
  console.log('Tier distribution:', await tiers.json());

  // Show top 10
  const top10 = await clickhouse.query({
    query: `
      SELECT wallet_id, rank, tier, round(composite_score, 3) as score
      FROM wio_wallet_scores_v1
      ORDER BY rank
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  console.log('Top 10 wallets:', await top10.json());

  await clickhouse.close();
  console.log('Done!');
}

main().catch(console.error);
