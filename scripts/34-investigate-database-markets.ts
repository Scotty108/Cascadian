import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Markets xcnstrategy has in our database (from script 28 output)
const DB_MARKETS = [
  'd7c014b675e422f96558e3ff16f26cfe97b6d8bda0ba5c1b9e01f12370b43c28',
  '3e24c8e2b0df3b8b5cbb55c0ea914c17e7af17ca5359db66b31f7bce0ac1ba0a',
  'f943579ac22e2c4cc5add76a3fc4a40f7ec7c84fc21ca0dbc00e0fb2e9d1d12a',
  '01c2d9c6df76defb67e58db5f55a9b6b42c14b85ed9730da2ec9be1c73a1cda1',
  '5f821786486260254ee7734ca5f5aa9de2e5b3f6d6c6e1494f61f88c4494d1f3',
  '6f6036f36cbe10cf6bddf64a3a95c60de7e5e2f61ec2b5b08e8e40f8c8e7d59d',
  'fcb61a7e6160c0ab312ab51b9cba1b2e0a7ee8e5e3e8d1a3e7b6f1e5e0c7e6a5',
  '7399a2004d759ee2c3e2f3e1e8e0e7d6c5b4a3921e8e7e6f5e4e3e2e1e0e7e6',
  '5515514b83c9bb32c9db75e2e1d0c8e7e6f5e4e3e2e1e0e7e6e5e4e3e2e1e0',
  '1dcf4c1446fcacb42af3e2e1d0c8e7e6f5e4e3e2e1e0e7e6e5e4e3e2e1e0e7'
];

async function investigateDatabaseMarkets() {
  console.log('=== Investigating Database Markets for xcnstrategy ===\n');
  console.log(`Wallet: ${EOA}\n`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get ALL markets xcnstrategy traded (not just top 10)
  const allMarketsQuery = `
    SELECT
      condition_id_norm_v3 AS condition_id,
      outcome_index_v3 AS outcome_idx,
      count() AS trades,
      sum(abs(usd_value)) AS volume,
      min(timestamp) AS first_trade,
      max(timestamp) AS last_trade
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
    GROUP BY condition_id, outcome_idx
    ORDER BY volume DESC
  `;

  const allMarketsResult = await clickhouse.query({ query: allMarketsQuery, format: 'JSONEachRow' });
  const allMarkets = await allMarketsResult.json<any[]>();

  console.log(`TOTAL MARKETS xcnstrategy traded: ${allMarkets.length}\n`);
  console.log('Top 20 by volume:\n');
  console.log('| # | Condition ID         | Out | Trades | Volume         | First Trade          | Last Trade           |');
  console.log('|---|----------------------|-----|--------|----------------|----------------------|----------------------|');

  allMarkets.slice(0, 20).forEach((m, idx) => {
    console.log(`| ${String(idx + 1).padStart(2)} | ${m.condition_id.substring(0, 20)}... | ${String(m.outcome_idx).padStart(3)} | ${String(m.trades).padStart(6)} | $${String(Number(m.volume).toLocaleString()).padStart(12)} | ${m.first_trade} | ${m.last_trade} |`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  // Check: Are these markets exclusive to xcnstrategy or do other wallets trade them?
  console.log('Checking if these markets are traded by OTHER wallets...\n');

  const exclusivityResults: any[] = [];

  for (const market of allMarkets.slice(0, 10)) {
    const exclusivityQuery = `
      SELECT
        uniq(wallet_address) AS unique_wallets,
        count() AS total_trades,
        sum(abs(usd_value)) AS total_volume
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = '${market.condition_id}'
    `;

    const result = await clickhouse.query({ query: exclusivityQuery, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    exclusivityResults.push({
      condition_id: market.condition_id.substring(0, 20) + '...',
      xcn_trades: market.trades,
      xcn_volume: Number(market.volume),
      total_wallets: Number(data[0].unique_wallets),
      total_trades: Number(data[0].total_trades),
      total_volume: Number(data[0].total_volume),
      exclusive: Number(data[0].unique_wallets) === 1
    });
  }

  console.log('| # | Condition ID         | xcn Trades | Total Wallets | Total Trades | Exclusive? |');
  console.log('|---|----------------------|------------|---------------|--------------|------------|');

  exclusivityResults.forEach((r, idx) => {
    const exclusiveSymbol = r.exclusive ? '🔒 YES' : '🌐 NO';
    console.log(`| ${String(idx + 1).padStart(2)} | ${r.condition_id} | ${String(r.xcn_trades).padStart(10)} | ${String(r.total_wallets).padStart(13)} | ${String(r.total_trades).padStart(12)} | ${exclusiveSymbol.padEnd(10)} |`);
  });

  const exclusiveCount = exclusivityResults.filter(r => r.exclusive).length;

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');
  console.log(`Markets exclusive to xcnstrategy: ${exclusiveCount} / 10\n`);

  if (exclusiveCount > 5) {
    console.log('🚨 CRITICAL: Many markets are EXCLUSIVE to xcnstrategy!');
    console.log('   This is highly unusual for real market data.');
    console.log('   Suggests these trades might be:');
    console.log('   - Test/dummy data');
    console.log('   - Misattributed from another source');
    console.log('   - From a different time period/data pipeline\n');
  } else {
    console.log('✅ Markets are traded by multiple wallets (expected behavior)\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Check wallet address format consistency
  console.log('Checking wallet address format/consistency in database...\n');

  const addressCheckQuery = `
    SELECT DISTINCT
      wallet_address,
      count() AS trades,
      sum(abs(usd_value)) AS volume
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) LIKE lower('%cce2b7c71f21e358%')
      OR lower(wallet_address) LIKE lower('%d59d03eeb0fd5979%')
    GROUP BY wallet_address
    ORDER BY volume DESC
  `;

  const addressResult = await clickhouse.query({ query: addressCheckQuery, format: 'JSONEachRow' });
  const addressData = await addressResult.json<any[]>();

  if (addressData.length > 0) {
    console.log('Found wallet addresses matching target patterns:\n');
    addressData.forEach(row => {
      const isEOA = row.wallet_address.toLowerCase() === EOA.toLowerCase();
      const label = isEOA ? '(EOA - TARGET)' : '(VARIANT)';
      console.log(`  ${row.wallet_address} ${label}`);
      console.log(`    Trades: ${row.trades}, Volume: $${Number(row.volume).toLocaleString()}\n`);
    });
  } else {
    console.log('No matching wallet addresses found.\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get sample trades to check data quality
  console.log('Sample trades from top market (d7c014b675...):\n');

  const sampleQuery = `
    SELECT
      timestamp,
      trade_direction,
      outcome_index_v3,
      shares,
      usd_value,
      wallet_address,
      condition_id_norm_v3
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 = 'd7c014b675e422f96558e3ff16f26cfe97b6d8bda0ba5c1b9e01f12370b43c28'
    ORDER BY timestamp ASC
    LIMIT 10
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json<any[]>();

  console.log('| Timestamp           | Side | Out | Shares        | USD Value    | Wallet Match |');
  console.log('|---------------------|------|-----|---------------|--------------|--------------|');

  sampleData.forEach(trade => {
    const walletMatch = trade.wallet_address.toLowerCase() === EOA.toLowerCase() ? '✅' : '❌';
    console.log(`| ${trade.timestamp} | ${trade.trade_direction.padEnd(4)} | ${String(trade.outcome_index_v3).padStart(3)} | ${String(trade.shares).padStart(13)} | $${String(Number(trade.usd_value).toLocaleString()).padStart(10)} | ${walletMatch.padEnd(12)} |`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  // Final check: Time distribution
  console.log('Time distribution of xcnstrategy trades:\n');

  const timeDistQuery = `
    SELECT
      toYYYYMM(timestamp) AS month,
      count() AS trades,
      sum(abs(usd_value)) AS volume
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
    GROUP BY month
    ORDER BY month DESC
  `;

  const timeResult = await clickhouse.query({ query: timeDistQuery, format: 'JSONEachRow' });
  const timeData = await timeResult.json<any[]>();

  console.log('| Month   | Trades | Volume         |');
  console.log('|---------|--------|----------------|');

  timeData.forEach(row => {
    console.log(`| ${row.month} | ${String(row.trades).padStart(6)} | $${String(Number(row.volume).toLocaleString()).padStart(12)} |`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  const polymarketTimeWindow = {
    start: new Date(1724259231000), // Aug 2024
    end: new Date(1763250566105)    // Nov 2025
  };

  const inWindowQuery = `
    SELECT
      count() AS trades_in_window,
      sum(abs(usd_value)) AS volume_in_window
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND timestamp >= '${polymarketTimeWindow.start.toISOString()}'
      AND timestamp <= '${polymarketTimeWindow.end.toISOString()}'
  `;

  const inWindowResult = await clickhouse.query({ query: inWindowQuery, format: 'JSONEachRow' });
  const inWindowData = await inWindowResult.json<any[]>();

  const totalTradesQuery = `
    SELECT
      count() AS total_trades,
      sum(abs(usd_value)) AS total_volume
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const totalResult = await clickhouse.query({ query: totalTradesQuery, format: 'JSONEachRow' });
  const totalData = await totalResult.json<any[]>();

  const tradesInWindow = Number(inWindowData[0].trades_in_window);
  const totalTrades = Number(totalData[0].total_trades);
  const percentInWindow = ((tradesInWindow / totalTrades) * 100).toFixed(1);

  console.log('TIME WINDOW ANALYSIS:\n');
  console.log(`Polymarket API time window: ${polymarketTimeWindow.start.toISOString()} to ${polymarketTimeWindow.end.toISOString()}`);
  console.log(`Trades in Polymarket window: ${tradesInWindow} / ${totalTrades} (${percentInWindow}%)`);
  console.log(`Volume in Polymarket window: $${Number(inWindowData[0].volume_in_window).toLocaleString()} / $${Number(totalData[0].total_volume).toLocaleString()}\n`);

  if (Number(percentInWindow) < 50) {
    console.log('⚠️  Less than 50% of trades in Polymarket API time window');
    console.log('   Most trades are OUTSIDE the API time period.\n');
  }

  return {
    totalMarkets: allMarkets.length,
    exclusiveMarkets: exclusiveCount,
    tradesInWindow,
    totalTrades,
    percentInWindow
  };
}

investigateDatabaseMarkets().catch(console.error);
