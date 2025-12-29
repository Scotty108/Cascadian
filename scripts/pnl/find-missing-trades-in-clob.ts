/**
 * Check if recent Activity API trades exist in CLOB under ANY wallet
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

async function main() {
  console.log('='.repeat(80));
  console.log('FINDING MISSING TRADES IN CLOB');
  console.log('='.repeat(80));

  // Get recent Activity API trades with tx hashes
  console.log('\n--- Fetching recent Activity API trades ---');
  const resp = await fetch(
    `https://data-api.polymarket.com/activity?user=${WALLET}&limit=20`,
    { headers: { accept: 'application/json' } }
  );
  const activities = (await resp.json()) as any[];

  const recentTrades = activities
    .filter((a) => a.type === 'TRADE' && a.transactionHash)
    .slice(0, 10);

  console.log('Recent trades with tx hashes:', recentTrades.length);

  // Check each tx hash in CLOB globally (any wallet)
  console.log('\n--- Checking tx hashes in CLOB (global search) ---');
  for (const trade of recentTrades.slice(0, 5)) {
    const txHash = trade.transactionHash.toLowerCase().replace('0x', '');
    const ts = new Date(trade.timestamp * 1000).toISOString();

    const q = `
      SELECT
        trader_wallet,
        side,
        usdc_amount / 1e6 as usdc,
        trade_time
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(hex(transaction_hash)) = '${txHash}'
      LIMIT 1
    `;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const rows = (await r.json()) as any[];

    if (rows.length > 0) {
      console.log(
        '  FOUND: ' + txHash.slice(0, 16) + '... | wallet: ' + rows[0].trader_wallet
      );
    } else {
      console.log('  NOT FOUND: ' + txHash.slice(0, 16) + '... | Activity: ' + ts);
    }
  }

  // Check if these trades exist in FPMM
  console.log('\n--- Checking tx hashes in FPMM ---');
  for (const trade of recentTrades.slice(0, 5)) {
    const txHash = trade.transactionHash.toLowerCase();
    const txHashNoPrefix = txHash.replace('0x', '');

    const q = `
      SELECT
        trader_wallet,
        side,
        usdc_amount,
        trade_time
      FROM pm_fpmm_trades
      WHERE lower(transaction_hash) = '${txHash}'
         OR lower(transaction_hash) = '${txHashNoPrefix}'
      LIMIT 1
    `;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const rows = (await r.json()) as any[];

    if (rows.length > 0) {
      console.log(
        '  FOUND in FPMM: ' + txHash.slice(0, 20) + '... | wallet: ' + rows[0].trader_wallet
      );
    } else {
      console.log('  NOT in FPMM: ' + txHash.slice(0, 20) + '...');
    }
  }

  // Summary
  console.log('\n='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  console.log('');
  console.log('If trades are NOT in CLOB or FPMM, they may be:');
  console.log('  1. From a new/different data source we dont index');
  console.log('  2. Processed through a system change after Dec 12');
  console.log('  3. Using a contract we dont have in our pipeline');
}

main().catch(console.error);
