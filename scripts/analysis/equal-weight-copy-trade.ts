import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
});

const query = `
SELECT
  wallet,
  total_trades,
  wins,
  losses,
  win_rate_pct,

  -- Equal-weight returns (avg ROI × number of trades)
  round(avg_roi_pct * total_trades, 2) as total_roi_pct,

  -- Simulated P&L at different position sizes
  round(avg_roi_pct * total_trades, 2) as profit_per_100_usd,
  round(avg_roi_pct * total_trades * 5, 2) as profit_per_500_usd,
  round(avg_roi_pct * total_trades * 10, 2) as profit_per_1k_usd,

  -- Per-trade metrics
  avg_roi_pct,
  roi_stddev_pct,
  max_win_roi_pct as best_trade_pct,
  max_loss_roi_pct as worst_trade_pct,

  -- Actual performance
  total_pnl_usd as actual_total_pnl,
  avg_trade_usd as avg_actual_position,

  -- Win breakdown
  avg_win_roi_pct,
  median_win_roi_pct,
  pct_wins_over_50,
  pct_wins_over_100,

  -- Loss risk
  avg_loss_roi_pct,
  pct_losses_over_50,
  pct_losses_over_90,

  -- Profit factor approximation
  if(avg_loss_roi_pct != 0,
    round((wins * avg_win_roi_pct) / (losses * abs(avg_loss_roi_pct)), 2),
    999
  ) as profit_factor,

  positions_traded as unique_markets,
  last_trade_time as last_trade,
  dateDiff('hour', last_trade_time, now()) as hours_since_last,
  days_active,
  trades_per_day,

  -- Trading style
  maker_pct,
  taker_pct,
  sold_early_pct

FROM pm_wallet_copy_trading_metrics_v1
WHERE last_trade_time >= now() - INTERVAL 30 DAY
  AND total_trades >= 5
  AND avg_trade_usd >= 5
ORDER BY profit_per_1k_usd DESC
LIMIT 20
`;

async function main() {
  // First, list available tables
  console.log('Checking available tables...\n');
  const tablesResult = await client.query({
    query: "SHOW TABLES LIKE '%wallet%'",
    format: 'JSONEachRow',
  });
  const tables = await tablesResult.json();
  console.log('Available wallet-related tables:', tables);
  console.log();

  console.log('Executing equal-weight copy trading analysis...\n');

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });

  const data = await result.json();

  // Format and display results
  console.log('='.repeat(120));
  console.log('TOP 20 WALLETS FOR EQUAL-WEIGHT COPY TRADING (LAST 30 DAYS)');
  console.log('='.repeat(120));
  console.log();

  data.forEach((row: any, idx: number) => {
    console.log(`\n${idx + 1}. WALLET: ${row.wallet}`);
    console.log('-'.repeat(120));

    console.log('\nEQUAL-WEIGHT SIMULATION:');
    console.log(`  Profit @ $100/trade:  $${row.profit_per_100_usd.toFixed(2)}`);
    console.log(`  Profit @ $500/trade:  $${row.profit_per_500_usd.toFixed(2)}`);
    console.log(`  Profit @ $1k/trade:   $${row.profit_per_1k_usd.toFixed(2)}`);
    console.log(`  Total ROI:            ${row.total_roi_pct}%`);

    console.log('\nPER-TRADE METRICS:');
    console.log(`  Avg ROI per trade:    ${row.avg_roi_pct}%`);
    console.log(`  Avg win ROI:          ${row.avg_win_roi_pct}%`);
    console.log(`  Median win ROI:       ${row.median_win_roi_pct}%`);
    console.log(`  Avg loss ROI:         ${row.avg_loss_roi_pct}%`);
    console.log(`  ROI Std Dev:          ${row.roi_stddev_pct}%`);
    console.log(`  Best trade:           ${row.best_trade_pct}%`);
    console.log(`  Worst trade:          ${row.worst_trade_pct}%`);

    console.log('\nWIN/LOSS STATS:');
    console.log(`  Total trades:         ${row.total_trades}`);
    console.log(`  Wins:                 ${row.wins}`);
    console.log(`  Losses:               ${row.losses}`);
    console.log(`  Win rate:             ${row.win_rate_pct}%`);
    console.log(`  Profit factor:        ${row.profit_factor}`);

    console.log('\nACTUAL PERFORMANCE:');
    console.log(`  Actual total PnL:     $${row.actual_total_pnl.toFixed(0)}`);
    console.log(`  Avg position size:    $${row.avg_actual_position.toFixed(0)}`);
    console.log(`  Wins > 50% ROI:       ${row.pct_wins_over_50.toFixed(1)}%`);
    console.log(`  Wins > 100% ROI:      ${row.pct_wins_over_100.toFixed(1)}%`);
    console.log(`  Losses > 50%:         ${row.pct_losses_over_50.toFixed(1)}%`);
    console.log(`  Losses > 90%:         ${row.pct_losses_over_90.toFixed(1)}%`);

    console.log('\nDIVERSIFICATION & ACTIVITY:');
    console.log(`  Unique markets:       ${row.unique_markets}`);
    console.log(`  Days active:          ${row.days_active}`);
    console.log(`  Trades per day:       ${row.trades_per_day.toFixed(1)}`);
    console.log(`  Last trade:           ${row.last_trade}`);
    console.log(`  Hours since last:     ${row.hours_since_last}`);
    console.log(`  Maker trades:         ${row.maker_pct.toFixed(1)}%`);
    console.log(`  Taker trades:         ${row.taker_pct.toFixed(1)}%`);
    console.log(`  Sold early:           ${row.sold_early_pct.toFixed(1)}%`);
  });

  console.log('\n' + '='.repeat(120));
  console.log('\nKEY INSIGHTS:');
  console.log('-'.repeat(120));
  console.log('Equal-weight copy trading assumes you invest the same amount in every trade the wallet makes.');
  console.log('This isolates trading skill (ROI per trade) from capital allocation strategy.');
  console.log('\nThe top wallets above would generate the most profit if you copied all their trades');
  console.log('with fixed position sizes of $100, $500, or $1000 per trade.');
  console.log('='.repeat(120));

  await client.close();
}

main().catch(console.error);
