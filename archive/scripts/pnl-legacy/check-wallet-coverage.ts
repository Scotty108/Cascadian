/**
 * Wallet Coverage Checker
 *
 * Compares data from Polymarket API vs our indexed data
 * Uses lightweight queries to minimize ClickHouse costs
 *
 * Terminal: Claude 1
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 60000,
});

// The 9 test wallets from build-pnl-unified.ts
const WALLETS = [
  { address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', label: 'WHALE', uiPnl: 22053934, uiVolume: null },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', label: 'EGG', uiPnl: 95976, uiVolume: null },
  { address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', label: 'NEW', uiPnl: -10021172, uiVolume: null },
  { address: '0x9d36c904930a7d06c5403f9e16996e919f586486', label: 'W1', uiPnl: -6138.90, uiVolume: null },
  { address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', label: 'W2', uiPnl: 4404.92, uiVolume: null },
  { address: '0x418db17eaa8f25eaf2085657d0becd82462c6786', label: 'W3', uiPnl: 5.44, uiVolume: null },
  { address: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', label: 'W4', uiPnl: -294.61, uiVolume: null },
  { address: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', label: 'W5', uiPnl: 146.90, uiVolume: null },
  { address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', label: 'W6', uiPnl: 470.40, uiVolume: null },
];

interface PolymarketUserStats {
  pnl: number;
  volume: number;
  positions: number;
  trades: number;
}

async function getPolymarketStats(address: string): Promise<PolymarketUserStats | null> {
  try {
    // Polymarket Gamma API endpoint for user stats
    const url = `https://gamma-api.polymarket.com/users/${address}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.log(`  API returned ${response.status} for ${address}`);
      return null;
    }

    const data = await response.json();
    return {
      pnl: parseFloat(data.pnl || data.profitLoss || '0'),
      volume: parseFloat(data.volume || data.totalVolume || '0'),
      positions: parseInt(data.positionsCount || data.positions || '0'),
      trades: parseInt(data.tradesCount || data.trades || '0'),
    };
  } catch (e) {
    console.log(`  API error for ${address}: ${e}`);
    return null;
  }
}

async function getOurStats(address: string): Promise<{ trades: number; volume: number; firstTrade: string; lastTrade: string } | null> {
  try {
    // Use a targeted query with filter pushdown for efficiency
    const result = await clickhouse.query({
      query: `
        SELECT
          COUNT(DISTINCT event_id) as unique_trades,
          SUM(usdc_amount) / 1000000.0 as total_volume,
          MIN(trade_time) as first_trade,
          MAX(trade_time) as last_trade
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String}
          AND is_deleted = 0
      `,
      query_params: { wallet: address },
      format: 'JSONEachRow'
    });

    const rows = await result.json() as any[];
    if (rows.length === 0) return null;

    const r = rows[0];
    return {
      trades: parseInt(r.unique_trades) || 0,
      volume: parseFloat(r.total_volume) || 0,
      firstTrade: r.first_trade ? new Date(r.first_trade).toISOString().split('T')[0] : 'N/A',
      lastTrade: r.last_trade ? new Date(r.last_trade).toISOString().split('T')[0] : 'N/A',
    };
  } catch (e) {
    console.log(`  DB error for ${address}: ${e}`);
    return null;
  }
}

async function main() {
  console.log('\n📊 WALLET COVERAGE ANALYSIS');
  console.log('═'.repeat(100));
  console.log('Comparing Polymarket API stats vs our indexed data\n');

  console.log('Wallet    | UI PnL        | API PnL       | API Volume    | Our Trades | API Trades | Coverage');
  console.log('─'.repeat(100));

  for (const w of WALLETS) {
    process.stdout.write(`${w.label.padEnd(10)}`);

    // Get API stats
    const apiStats = await getPolymarketStats(w.address);

    // Get our stats
    const ourStats = await getOurStats(w.address);

    if (!apiStats) {
      console.log('| API unavailable');
      continue;
    }

    const uiPnlStr = w.uiPnl >= 0
      ? `+$${(Math.abs(w.uiPnl) / 1000).toFixed(1)}K`
      : `-$${(Math.abs(w.uiPnl) / 1000).toFixed(1)}K`;

    const apiPnlStr = apiStats.pnl >= 0
      ? `+$${(Math.abs(apiStats.pnl) / 1000).toFixed(1)}K`
      : `-$${(Math.abs(apiStats.pnl) / 1000).toFixed(1)}K`;

    const apiVolStr = `$${(apiStats.volume / 1000000).toFixed(2)}M`;

    const ourTrades = ourStats?.trades || 0;
    const tradeCoverage = apiStats.trades > 0
      ? ((ourTrades / apiStats.trades) * 100).toFixed(0) + '%'
      : 'N/A';

    console.log(
      `| ${uiPnlStr.padStart(12)} ` +
      `| ${apiPnlStr.padStart(12)} ` +
      `| ${apiVolStr.padStart(12)} ` +
      `| ${ourTrades.toString().padStart(10)} ` +
      `| ${apiStats.trades.toString().padStart(10)} ` +
      `| ${tradeCoverage.padStart(8)}`
    );

    // Add a small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('─'.repeat(100));
  console.log('\nNotes:');
  console.log('- "Coverage" = Our Trades / API Trades');
  console.log('- Low coverage indicates missing historical data');
  console.log('- API may have slightly different definitions than UI');

  await clickhouse.close();
}

main().catch(console.error);
