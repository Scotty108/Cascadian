import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function completeTimeAnalysis() {
  console.log('=== Completing Time Window Analysis ===\n');

  const polymarketTimeWindow = {
    start: new Date(1724259231000), // Aug 21, 2024
    end: new Date(1763250566105)    // Nov 15, 2025
  };

  console.log(`Polymarket API time window:`);
  console.log(`  Start: ${polymarketTimeWindow.start.toISOString()} (${polymarketTimeWindow.start.toLocaleDateString()})`);
  console.log(`  End:   ${polymarketTimeWindow.end.toISOString()} (${polymarketTimeWindow.end.toLocaleDateString()})\n`);

  // Use date-only format to avoid DateTime conversion issues
  const startDate = polymarketTimeWindow.start.toISOString().split('T')[0];
  const endDate = polymarketTimeWindow.end.toISOString().split('T')[0];

  const inWindowQuery = `
    SELECT
      count() AS trades_in_window,
      sum(abs(usd_value)) AS volume_in_window,
      uniq(condition_id_norm_v3) AS markets_in_window
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND toDate(timestamp) >= toDate('${startDate}')
      AND toDate(timestamp) <= toDate('${endDate}')
  `;

  const inWindowResult = await clickhouse.query({ query: inWindowQuery, format: 'JSONEachRow' });
  const inWindowData = await inWindowResult.json<any[]>();

  const totalTradesQuery = `
    SELECT
      count() AS total_trades,
      sum(abs(usd_value)) AS total_volume,
      uniq(condition_id_norm_v3) AS total_markets
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const totalResult = await clickhouse.query({ query: totalTradesQuery, format: 'JSONEachRow' });
  const totalData = await totalResult.json<any[]>();

  const tradesInWindow = Number(inWindowData[0].trades_in_window);
  const totalTrades = Number(totalData[0].total_trades);
  const percentInWindow = ((tradesInWindow / totalTrades) * 100).toFixed(1);

  const marketsInWindow = Number(inWindowData[0].markets_in_window);
  const totalMarkets = Number(totalData[0].total_markets);
  const percentMarketsInWindow = ((marketsInWindow / totalMarkets) * 100).toFixed(1);

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('RESULTS:\n');
  console.log(`Total trades (all time):          ${totalTrades}`);
  console.log(`Trades in Polymarket window:      ${tradesInWindow} (${percentInWindow}%)`);
  console.log(`Trades OUTSIDE Polymarket window: ${totalTrades - tradesInWindow} (${(100 - Number(percentInWindow)).toFixed(1)}%)\n`);

  console.log(`Total markets (all time):         ${totalMarkets}`);
  console.log(`Markets in Polymarket window:     ${marketsInWindow} (${percentMarketsInWindow}%)`);
  console.log(`Markets OUTSIDE window:           ${totalMarkets - marketsInWindow} (${(100 - Number(percentMarketsInWindow)).toFixed(1)}%)\n`);

  console.log(`Total volume (all time):          $${Number(totalData[0].total_volume).toLocaleString()}`);
  console.log(`Volume in Polymarket window:      $${Number(inWindowData[0].volume_in_window).toLocaleString()}\n`);

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  if (Number(percentInWindow) < 50) {
    console.log('⚠️  CRITICAL: Less than 50% of trades are in Polymarket API time window!');
    console.log(`   ${totalTrades - tradesInWindow} trades (${(100 - Number(percentInWindow)).toFixed(1)}%) are OUTSIDE the API period.`);
    console.log('   This suggests:\n');
    console.log('   1. Database contains older trades not in API');
    console.log('   2. OR API filtered by time window');
    console.log('   3. OR these are two different data sources entirely\n');
  } else {
    console.log(`✅ Most trades (${percentInWindow}%) are within Polymarket API time window\n`);
  }

  // Check: What's the earliest and latest trade?
  const dateRangeQuery = `
    SELECT
      min(timestamp) AS earliest_trade,
      max(timestamp) AS latest_trade
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const dateRangeResult = await clickhouse.query({ query: dateRangeQuery, format: 'JSONEachRow' });
  const dateRangeData = await dateRangeResult.json<any[]>();

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('TRADE DATE RANGE:\n');
  console.log(`Earliest trade: ${dateRangeData[0].earliest_trade}`);
  console.log(`Latest trade:   ${dateRangeData[0].latest_trade}\n`);

  const earliestDate = new Date(dateRangeData[0].earliest_trade);
  const latestDate = new Date(dateRangeData[0].latest_trade);

  if (earliestDate < polymarketTimeWindow.start) {
    const daysBefore = Math.floor((polymarketTimeWindow.start.getTime() - earliestDate.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`⚠️  Earliest trade is ${daysBefore} days BEFORE Polymarket API window starts`);
  }

  if (latestDate > polymarketTimeWindow.end) {
    const daysAfter = Math.floor((latestDate.getTime() - polymarketTimeWindow.end.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`⚠️  Latest trade is ${daysAfter} days AFTER Polymarket API window ends`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  // Sample trades investigation - why did it return 0 rows?
  console.log('Investigating sample trades from top market...\n');

  const topMarketCID = 'd7c014b675e422f96558e3ff16f26cfe97b6d8bda0ba5c1b9e01f12370b43c28';

  // First check: Does this market exist at all?
  const marketExistsQuery = `
    SELECT
      count() AS total_trades,
      uniq(wallet_address) AS total_wallets
    FROM pm_trades_canonical_v3
    WHERE condition_id_norm_v3 = '${topMarketCID}'
  `;

  const marketExistsResult = await clickhouse.query({ query: marketExistsQuery, format: 'JSONEachRow' });
  const marketExistsData = await marketExistsResult.json<any[]>();

  console.log(`Market d7c014b675... exists: ${Number(marketExistsData[0].total_trades) > 0 ? 'YES' : 'NO'}`);
  console.log(`Total trades: ${marketExistsData[0].total_trades}`);
  console.log(`Total wallets: ${marketExistsData[0].total_wallets}\n`);

  // Second check: Are there trades for xcnstrategy in this market?
  const xcnTradesQuery = `
    SELECT
      count() AS xcn_trades
    FROM pm_trades_canonical_v3
    WHERE condition_id_norm_v3 = '${topMarketCID}'
      AND lower(wallet_address) = lower('${EOA}')
  `;

  const xcnTradesResult = await clickhouse.query({ query: xcnTradesQuery, format: 'JSONEachRow' });
  const xcnTradesData = await xcnTradesResult.json<any[]>();

  console.log(`xcnstrategy trades in this market: ${xcnTradesData[0].xcn_trades}\n`);

  if (Number(xcnTradesData[0].xcn_trades) > 0) {
    // Get actual sample trades
    const sampleQuery = `
      SELECT
        timestamp,
        trade_direction,
        outcome_index_v3,
        shares,
        usd_value,
        condition_id_norm_v3
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = '${topMarketCID}'
        AND lower(wallet_address) = lower('${EOA}')
      ORDER BY timestamp ASC
      LIMIT 5
    `;

    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleResult.json<any[]>();

    console.log('Sample trades:\n');
    console.log('| Timestamp           | Side | Out | Shares        | USD Value    |');
    console.log('|---------------------|------|-----|---------------|--------------|');

    sampleData.forEach(trade => {
      console.log(`| ${trade.timestamp} | ${trade.trade_direction.padEnd(4)} | ${String(trade.outcome_index_v3).padStart(3)} | ${String(trade.shares).padStart(13)} | $${String(Number(trade.usd_value).toLocaleString()).padStart(10)} |`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  return {
    tradesInWindow,
    totalTrades,
    percentInWindow,
    marketsInWindow,
    totalMarkets,
    earliestTrade: dateRangeData[0].earliest_trade,
    latestTrade: dateRangeData[0].latest_trade
  };
}

completeTimeAnalysis().catch(console.error);
