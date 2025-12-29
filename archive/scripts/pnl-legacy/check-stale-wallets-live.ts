/**
 * Check Stale Wallets Against Live Polymarket
 *
 * Picks the top stale wallets and checks if they're still active on Polymarket
 *
 * Terminal: Claude 1
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function getPolymarketPnL(address: string): Promise<number | null> {
  try {
    const response = await fetch(`https://polymarket.com/profile/${address}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await response.text();
    const match = html.match(/"pnl":([0-9.-]+)/);
    if (match) {
      return parseFloat(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== CHECKING TOP STALE WALLETS AGAINST POLYMARKET ===');
  console.log('');

  // Get top 20 stale wallets by volume (last trade > 90 days ago)
  const result = await client.query({
    query: `
      SELECT
        trader_wallet,
        MAX(trade_time) as last_trade,
        COUNT(*) as trade_count,
        SUM(usdc_amount) / 1000000.0 as volume
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY trader_wallet
      HAVING last_trade < now() - INTERVAL 90 DAY
      ORDER BY volume DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const wallets = await result.json() as any[];

  console.log('Checking top 20 stale wallets (>90 days old) by volume...');
  console.log('');
  console.log('Wallet                                      | Our Last Trade | Our Volume   | Live PnL      | Status');
  console.log('--------------------------------------------|----------------|--------------|---------------|--------');

  let problemCount = 0;

  for (const w of wallets) {
    const lastTrade = new Date(w.last_trade).toISOString().split('T')[0];
    const volume = parseFloat(w.volume);

    // Check live PnL
    const livePnL = await getPolymarketPnL(w.trader_wallet);

    let status = '';
    let pnlStr = '';

    if (livePnL === null) {
      status = '?';
      pnlStr = 'N/A';
    } else if (Math.abs(livePnL) > volume * 0.1) {
      // If live PnL is significant relative to their volume, they might be active
      status = '⚠️ ACTIVE?';
      pnlStr = '$' + (livePnL / 1000000).toFixed(2) + 'M';
      problemCount++;
    } else {
      status = '✓ OK';
      pnlStr = '$' + (livePnL / 1000).toFixed(1) + 'K';
    }

    console.log(
      w.trader_wallet + ' | ' +
      lastTrade + '     | $' +
      (volume / 1000000).toFixed(2) + 'M'.padStart(8) + ' | ' +
      pnlStr.padStart(13) + ' | ' +
      status
    );

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('');
  console.log('=== RESULT ===');
  console.log('Wallets checked: 20');
  console.log('Potentially missing data:', problemCount);

  await client.close();
}

main().catch(console.error);
