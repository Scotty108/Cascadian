/**
 * Export Leaderboard V3
 *
 * Exports all wallets passing the copy trading leaderboard filters:
 * 1. At least 1 buy in last 5 days
 * 2. 10+ unique markets
 * 3. Average bet > $10
 * 4. Per-wallet winsorization (2.5%/97.5%)
 * 5. Log Growth/Trade (lifetime) > 0.10
 * 6. Log Growth/Trade (14 active days) > 0.10
 * 7. Ranked by Daily Log Growth
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

async function exportLeaderboard() {
  const client = getClickHouseClient();

  console.log('=== Export Leaderboard V3 ===\n');
  console.log('Running query...');

  const result = await client.query({
    query: `
      WITH
      base_wallets AS (
        SELECT wallet
        FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE resolved_at IS NOT NULL
        GROUP BY wallet
        HAVING
          max(if(is_short = 0 AND entry_time >= now() - INTERVAL 5 DAY, 1, 0)) = 1
          AND count(DISTINCT condition_id) >= 10
          AND avg(cost_usd) > 10
      ),
      wallet_percentiles AS (
        SELECT
          t.wallet,
          quantile(0.025)(t.roi) as roi_floor,
          quantile(0.975)(t.roi) as roi_ceiling
        FROM pm_trade_fifo_roi_v3_mat_unified t
        INNER JOIN base_wallets b ON t.wallet = b.wallet
        WHERE t.resolved_at IS NOT NULL
        GROUP BY t.wallet
      ),
      trades_with_info AS (
        SELECT
          t.wallet,
          t.roi,
          t.pnl_usd,
          t.cost_usd,
          toDate(t.entry_time) as trade_date,
          p.roi_floor,
          p.roi_ceiling,
          greatest(p.roi_floor, least(p.roi_ceiling, t.roi)) as roi_winsorized
        FROM pm_trade_fifo_roi_v3_mat_unified t
        INNER JOIN wallet_percentiles p ON t.wallet = p.wallet
        WHERE t.resolved_at IS NOT NULL
      ),
      wallet_day_ranks AS (
        SELECT
          wallet,
          trade_date,
          row_number() OVER (PARTITION BY wallet ORDER BY trade_date DESC) as day_rank
        FROM (SELECT DISTINCT wallet, trade_date FROM trades_with_info)
      ),
      wallet_metrics AS (
        SELECT
          t.wallet,
          count() as total_trades,
          count(DISTINCT t.trade_date) as total_active_days,
          sum(t.pnl_usd) as total_pnl,
          avg(t.cost_usd) as avg_bet,
          countIf(t.pnl_usd > 0) * 100.0 / count() as win_rate,
          avg(t.roi_floor) as roi_floor,
          avg(t.roi_ceiling) as roi_ceiling,
          avg(log(1 + t.roi_winsorized)) as log_growth_lifetime,
          countIf(d.day_rank <= 14) as trades_14d,
          count(DISTINCT if(d.day_rank <= 14, t.trade_date, NULL)) as active_days_14d,
          avgIf(log(1 + t.roi_winsorized), d.day_rank <= 14) as log_growth_14d
        FROM trades_with_info t
        LEFT JOIN wallet_day_ranks d ON t.wallet = d.wallet AND t.trade_date = d.trade_date
        GROUP BY t.wallet
      )
      SELECT
        wallet,
        total_trades,
        total_active_days,
        round(total_pnl, 2) as total_pnl,
        round(avg_bet, 2) as avg_bet,
        round(win_rate, 1) as win_rate_pct,
        round(roi_floor * 100, 2) as roi_floor_pct,
        round(roi_ceiling * 100, 2) as roi_ceiling_pct,
        round(log_growth_lifetime, 4) as log_growth_lifetime,
        trades_14d,
        active_days_14d,
        round(log_growth_14d, 4) as log_growth_14d,
        -- Cap trades per day at 50 to prevent market makers from dominating
        round(log_growth_14d * least(50, trades_14d / active_days_14d), 4) as daily_log_growth
      FROM wallet_metrics
      WHERE log_growth_lifetime > 0.10
        AND log_growth_14d > 0.10
        -- Exclude extreme market makers (more than 10k trades in 14 days)
        AND trades_14d <= 10000
      ORDER BY daily_log_growth DESC
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 600 },
  });

  const rows = await result.json() as any[];

  console.log(`Found ${rows.length} wallets\n`);

  // Add rank
  const rankedRows = rows.map((r, i) => ({
    rank: i + 1,
    ...r,
  }));

  // Save to JSON
  const outputPath = resolve(process.cwd(), 'leaderboard-v3-export.json');
  writeFileSync(outputPath, JSON.stringify(rankedRows, null, 2));
  console.log(`Saved to: ${outputPath}`);

  // Also save as CSV
  const csvPath = resolve(process.cwd(), 'leaderboard-v3-export.csv');
  const headers = Object.keys(rankedRows[0]).join(',');
  const csvRows = rankedRows.map(r => Object.values(r).join(','));
  writeFileSync(csvPath, [headers, ...csvRows].join('\n'));
  console.log(`Saved to: ${csvPath}`);

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`Total wallets: ${rows.length}`);
  console.log(`Top 10:`);
  rankedRows.slice(0, 10).forEach(r => {
    console.log(`  ${r.rank}. ${r.wallet.substring(0, 10)}... | DLG: ${r.daily_log_growth} | Trades: ${r.total_trades} | PnL: $${r.total_pnl}`);
  });
}

exportLeaderboard().catch(console.error);
