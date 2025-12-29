/**
 * Check wallet data freshness in CLOB vs Activity API
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

async function main() {
  // Check this wallet's latest trade in CLOB
  const q1 = `
    SELECT
      max(trade_time) as latest_trade,
      min(trade_time) as earliest_trade,
      count() as total_trades
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${WALLET}')
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const data = (await r1.json()) as any[];

  console.log('=== Wallet CLOB trades ===');
  console.log('  Wallet:', WALLET);
  console.log('  Latest trade:', data[0]?.latest_trade);
  console.log('  Earliest trade:', data[0]?.earliest_trade);
  console.log('  Total trades:', data[0]?.total_trades);

  // Check recent Activity API trade timestamps
  console.log('\n=== Activity API recent trades ===');
  const resp = await fetch(
    `https://data-api.polymarket.com/activity?user=${WALLET}&limit=10`,
    { headers: { accept: 'application/json' } }
  );
  const activities = (await resp.json()) as any[];
  for (const a of activities.slice(0, 5)) {
    if (a.type === 'TRADE') {
      const ts = new Date(a.timestamp * 1000).toISOString();
      console.log('  ' + ts + ' | ' + a.side + ' | $' + Number(a.usdcSize).toFixed(2));
    }
  }

  // Calculate the gap
  const clobLatest = new Date(data[0]?.latest_trade).getTime();
  const activityLatest = activities[0]?.timestamp * 1000;

  if (clobLatest && activityLatest) {
    const gapHours = (activityLatest - clobLatest) / (1000 * 60 * 60);
    console.log('\n=== Data Gap ===');
    console.log('  CLOB latest:', new Date(clobLatest).toISOString());
    console.log('  Activity latest:', new Date(activityLatest).toISOString());
    console.log('  Gap:', gapHours.toFixed(1), 'hours');
  }
}

main().catch(console.error);
