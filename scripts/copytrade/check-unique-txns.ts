/**
 * Check unique transactions to see if sells are overcounted
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== CHECKING UNIQUE TRANSACTIONS ===\n');

  // Count by transaction hash
  const q1 = `
    SELECT
      countDistinct(transaction_hash) as unique_txns,
      count() as total_rows,
      countDistinct(event_id) as unique_events
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const counts = (await r1.json())[0] as any;
  console.log('Transaction counts:');
  console.log(`  Unique transaction hashes: ${counts.unique_txns}`);
  console.log(`  Unique event IDs: ${counts.unique_events}`);
  console.log(`  Total rows: ${counts.total_rows}`);

  // Check if there are transactions with many events
  const q2 = `
    SELECT
      transaction_hash,
      count() as events,
      sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as buys,
      sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as sells
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    GROUP BY transaction_hash
    ORDER BY events DESC
    LIMIT 10
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const topTxns = await r2.json();
  console.log('\nTop 10 transactions by event count:');
  for (const t of topTxns as any[]) {
    console.log(`  ${t.transaction_hash.slice(0, 20)}... | events=${t.events} | buys=$${parseFloat(t.buys).toFixed(2)} sells=$${parseFloat(t.sells).toFixed(2)}`);
  }

  // CRITICAL CHECK: What if the wallet address appears in OTHER fields?
  // Check if this wallet appears as a different trader
  const q3 = `
    SELECT
      trader_wallet,
      count() as trades
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND (
        trader_wallet = '${WALLET}'
        OR trader_wallet LIKE '%925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e%'
      )
    GROUP BY trader_wallet
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const wallets = await r3.json();
  console.log('\nWallet appearances:');
  console.log(JSON.stringify(wallets, null, 2));

  // Check CLOB API for current positions
  console.log('\n=== CHECKING CLOB API ===');
  try {
    const url = `https://clob.polymarket.com/orders?market=&maker=${WALLET}`;
    console.log(`Fetching: ${url}`);
    const res = await fetch(url);
    const data = await res.json();
    console.log('Open orders:', JSON.stringify(data).slice(0, 500));
  } catch (e) {
    console.log('Error:', (e as Error).message);
  }

  // Also check positions API
  try {
    const url = `https://clob.polymarket.com/positions?user=${WALLET}`;
    console.log(`\nFetching: ${url}`);
    const res = await fetch(url);
    const data = await res.json();
    console.log('Positions:', JSON.stringify(data).slice(0, 500));
  } catch (e) {
    console.log('Error:', (e as Error).message);
  }

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
