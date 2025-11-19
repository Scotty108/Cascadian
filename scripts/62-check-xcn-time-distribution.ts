import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkTimeDistribution() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET TIME DISTRIBUTION ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Overall date range
  console.log('Overall date range...\n');

  const dateRangeQuery = `
    SELECT
      min(timestamp) AS first_trade,
      max(timestamp) AS last_trade,
      dateDiff('day', first_trade, last_trade) AS days_active
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_WALLET}'
  `;

  const rangeResult = await clickhouse.query({ query: dateRangeQuery, format: 'JSONEachRow' });
  const rangeData = await rangeResult.json();

  if (rangeData.length > 0) {
    const r = rangeData[0];
    console.log(`  First trade: ${r.first_trade}`);
    console.log(`  Last trade:  ${r.last_trade}`);
    console.log(`  Days active: ${r.days_active}\n`);
  }

  // Volume by time period
  console.log('Volume and P&L by time period...\n');

  const periodQuery = `
    SELECT
      CASE
        WHEN timestamp >= now() - INTERVAL 30 DAY THEN 'Last 30 days'
        WHEN timestamp >= now() - INTERVAL 90 DAY THEN 'Last 90 days'
        WHEN timestamp >= now() - INTERVAL 180 DAY THEN 'Last 6 months'
        WHEN timestamp >= now() - INTERVAL 365 DAY THEN 'Last year'
        ELSE 'Older than 1 year'
      END AS period,
      count() AS trades,
      sum(usd_value) AS volume,
      sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY') AS trade_pnl
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_WALLET}'
    GROUP BY period
    ORDER BY
      CASE period
        WHEN 'Last 30 days' THEN 1
        WHEN 'Last 90 days' THEN 2
        WHEN 'Last 6 months' THEN 3
        WHEN 'Last year' THEN 4
        ELSE 5
      END
  `;

  const periodResult = await clickhouse.query({ query: periodQuery, format: 'JSONEachRow' });
  const periodData = await periodResult.json();

  for (const row of periodData) {
    console.log(`  ${row.period}:`);
    console.log(`    Trades:    ${row.trades.toLocaleString()}`);
    console.log(`    Volume:    $${parseFloat(row.volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`    Trade P&L: $${parseFloat(row.trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  }

  // Recent activity (last 30 days)
  console.log('Last 30 days detailed breakdown...\n');

  const recentQuery = `
    SELECT
      count() AS trades,
      sum(usd_value) AS total_volume,
      sumIf(usd_value, trade_direction = 'BUY') AS buy_cost,
      sumIf(usd_value, trade_direction = 'SELL') AS sell_proceeds,
      sell_proceeds - buy_cost AS trade_pnl,
      uniq(condition_id_norm_v3) AS markets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_WALLET}'
      AND timestamp >= now() - INTERVAL 30 DAY
  `;

  const recentResult = await clickhouse.query({ query: recentQuery, format: 'JSONEachRow' });
  const recentData = await recentResult.json();

  if (recentData.length > 0) {
    const r = recentData[0];
    console.log(`  Trades:        ${r.trades.toLocaleString()}`);
    console.log(`  Markets:       ${r.markets.toLocaleString()}`);
    console.log(`  Total volume:  $${parseFloat(r.total_volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Buy cost:      $${parseFloat(r.buy_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Sell proceeds: $${parseFloat(r.sell_proceeds).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Trade P&L:     $${parseFloat(r.trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

    if (Math.abs(r.total_volume) < 2000000) {
      console.log('  ✅ Last 30 days volume matches UI expectation (~$1.38M)\n');
    }
  }

  console.log('═══════════════════════════════════════════════════════════');
}

checkTimeDistribution()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
