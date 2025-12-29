/**
 * Debug Unmatched Trades
 *
 * Check where the unmatched Activity API trades exist
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

// Sample unmatched tx hashes from reconciliation
const unmatchedTxHashes = [
  '54dd9d5f7b6ccfa2',
  '826bc6c5d36ccd6a',
  '14228181210a6eb8',
  'c8349a3130f367e7',
  '764d787259fb4575',
];

async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG UNMATCHED TRADES');
  console.log('='.repeat(80));

  // Get full tx hashes from Activity API
  console.log('\n--- Fetching recent Activity API trades ---');
  const resp = await fetch(
    `https://data-api.polymarket.com/activity?user=${WALLET}&limit=500`,
    { headers: { accept: 'application/json' } }
  );
  const activities = (await resp.json()) as any[];

  // Find the unmatched ones
  const unmatchedFull: string[] = [];
  for (const a of activities) {
    if (a.type !== 'TRADE' || !a.transactionHash) continue;
    const txHash = a.transactionHash.toLowerCase().replace('0x', '');
    for (const prefix of unmatchedTxHashes) {
      if (txHash.startsWith(prefix)) {
        unmatchedFull.push(txHash);
        break;
      }
    }
  }

  console.log('Found full tx hashes:', unmatchedFull.length);

  // Check each in different tables
  for (const txHash of unmatchedFull.slice(0, 5)) {
    console.log('\n--- Checking: 0x' + txHash.slice(0, 16) + '... ---');

    // Check pm_trader_events_v2 (raw)
    const q1 = `
      SELECT count() as cnt
      FROM pm_trader_events_v2
      WHERE lower(hex(transaction_hash)) = '${txHash}'
    `;
    const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
    const raw = ((await r1.json()) as any[])[0]?.cnt;
    console.log('  pm_trader_events_v2 (raw):', raw);

    // Check pm_trader_events_dedup_v2_tbl
    const q2 = `
      SELECT count() as cnt
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(hex(transaction_hash)) = '${txHash}'
    `;
    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const dedup = ((await r2.json()) as any[])[0]?.cnt;
    console.log('  pm_trader_events_dedup_v2_tbl:', dedup);

    // Check pm_fpmm_trades
    const q3 = `
      SELECT count() as cnt
      FROM pm_fpmm_trades
      WHERE lower(transaction_hash) = '0x${txHash}'
         OR lower(transaction_hash) = '${txHash}'
    `;
    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const fpmm = ((await r3.json()) as any[])[0]?.cnt;
    console.log('  pm_fpmm_trades:', fpmm);

    // If in raw but not dedup, check why
    if (Number(raw) > 0 && Number(dedup) === 0) {
      console.log('  -> IN RAW BUT NOT IN DEDUP - possible sync issue');

      // Check the raw data
      const q4 = `
        SELECT trader_wallet, trade_time, side, usdc_amount / 1e6 as usdc
        FROM pm_trader_events_v2
        WHERE lower(hex(transaction_hash)) = '${txHash}'
        LIMIT 3
      `;
      const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
      const rawData = (await r4.json()) as any[];
      for (const r of rawData) {
        console.log('     raw:', r.trader_wallet, r.trade_time, r.side, '$' + r.usdc);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('CHECKING WALLET ASSIGNMENT');
  console.log('='.repeat(80));

  // Check if these trades are recorded under a different wallet
  if (unmatchedFull.length > 0) {
    const txList = unmatchedFull.slice(0, 10).map((t) => `'${t}'`).join(',');
    const q5 = `
      SELECT
        lower(trader_wallet) as wallet,
        count() as cnt
      FROM pm_trader_events_v2
      WHERE lower(hex(transaction_hash)) IN (${txList})
      GROUP BY wallet
    `;
    const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
    const wallets = (await r5.json()) as any[];
    console.log('\nWallets associated with unmatched tx hashes:');
    for (const w of wallets) {
      const isTarget = w.wallet.toLowerCase() === WALLET.toLowerCase() ? ' <- TARGET' : '';
      console.log('  ' + w.wallet + ': ' + w.cnt + ' trades' + isTarget);
    }
  }
}

main().catch(console.error);
