/**
 * Reconcile Wallet Cashflow V2
 *
 * Re-run after dedup sync to get accurate match rates.
 * Uses current time as cutoff (dedup is now fresh).
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';
// Use current timestamp as cutoff (dedup is now fresh)
const CUTOFF_TS = Math.floor(Date.now() / 1000);

interface ActivityTrade {
  txHash: string;
  timestamp: number;
  side: string;
  size: number;
  price: number;
  usdcSize: number;
}

async function fetchActivityTrades(): Promise<ActivityTrade[]> {
  const trades: ActivityTrade[] = [];
  const seenTxHashes = new Set<string>();

  // Sample across offsets, filter to cutoff
  const offsets = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

  for (const offset of offsets) {
    const url = `https://data-api.polymarket.com/activity?user=${WALLET}&limit=100&offset=${offset}`;
    const resp = await fetch(url, { headers: { accept: 'application/json' } });
    const activities = (await resp.json()) as any[];

    for (const a of activities) {
      if (a.type !== 'TRADE' || !a.transactionHash || a.timestamp > CUTOFF_TS) continue;

      const txHash = a.transactionHash.toLowerCase().replace('0x', '');
      if (seenTxHashes.has(txHash)) continue;
      seenTxHashes.add(txHash);

      trades.push({
        txHash,
        timestamp: a.timestamp,
        side: a.side?.toUpperCase() || '',
        size: Number(a.size) || 0,
        price: Number(a.price) || 0,
        usdcSize: Number(a.usdcSize) || 0,
      });

      if (trades.length >= 500) break;
    }

    if (trades.length >= 500) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  return trades;
}

async function main() {
  console.log('='.repeat(90));
  console.log('RECONCILE WALLET CASHFLOW V2 (Post-Dedup-Sync)');
  console.log('='.repeat(90));
  console.log('');
  console.log('Wallet:', WALLET);
  console.log('Cutoff:', new Date(CUTOFF_TS * 1000).toISOString());
  console.log('');

  // Step 1: Fetch Activity trades
  console.log('Fetching Activity API trades...');
  const activityTrades = await fetchActivityTrades();
  console.log('Total Activity trades (unique tx):', activityTrades.length);

  // Step 2: Get all CLOB tx hashes for this wallet
  console.log('');
  console.log('Querying CLOB tx hashes...');
  const clobQuery = `
    SELECT DISTINCT lower(hex(transaction_hash)) as tx_hash
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${WALLET}')
  `;
  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobTxHashes = new Set((await clobResult.json() as any[]).map((r) => r.tx_hash));
  console.log('Total unique CLOB tx hashes:', clobTxHashes.size);

  // Step 3: Compare
  let matched = 0;
  let unmatched = 0;
  let matchedUsdc = 0;
  let unmatchedUsdc = 0;
  const unmatchedSamples: Array<{ ts: string; tx: string; side: string; usdc: number }> = [];

  for (const trade of activityTrades) {
    if (clobTxHashes.has(trade.txHash)) {
      matched++;
      matchedUsdc += trade.usdcSize;
    } else {
      unmatched++;
      unmatchedUsdc += trade.usdcSize;
      if (unmatchedSamples.length < 10) {
        unmatchedSamples.push({
          ts: new Date(trade.timestamp * 1000).toISOString().slice(0, 10),
          tx: '0x' + trade.txHash.slice(0, 16) + '...',
          side: trade.side,
          usdc: trade.usdcSize,
        });
      }
    }
  }

  // Step 4: Results
  console.log('');
  console.log('='.repeat(90));
  console.log('RESULTS');
  console.log('='.repeat(90));
  console.log('');
  console.log('Activity trades checked:', activityTrades.length);
  console.log('Matched in CLOB:', matched);
  console.log('Unmatched:', unmatched);
  console.log('');
  console.log('Match rate:', ((matched / activityTrades.length) * 100).toFixed(1) + '%');
  console.log('');
  console.log('Matched USDC:', '$' + matchedUsdc.toFixed(2));
  console.log('Unmatched USDC:', '$' + unmatchedUsdc.toFixed(2));
  console.log('USDC match rate:', ((matchedUsdc / (matchedUsdc + unmatchedUsdc)) * 100).toFixed(1) + '%');

  if (unmatchedSamples.length > 0) {
    console.log('');
    console.log('Sample unmatched tx hashes:');
    for (const s of unmatchedSamples) {
      console.log(`  ${s.ts} | ${s.tx} | ${s.side} | $${s.usdc.toFixed(2)}`);
    }
  }

  console.log('');
  console.log('='.repeat(90));
  console.log('CONCLUSION');
  console.log('='.repeat(90));
  console.log('');

  if (matched / activityTrades.length >= 0.95) {
    console.log('HIGH MATCH RATE (>=95%)');
    console.log('Dome may be a valid truth target for this wallet.');
    console.log('The small gap is likely timing/rounding differences.');
  } else if (matched / activityTrades.length >= 0.85) {
    console.log('MODERATE MATCH RATE (85-95%)');
    console.log('Some Activity trades are not in CLOB.');
    console.log('Investigate unmatched trades - may be AMM/FPMM.');
  } else {
    console.log('LOW MATCH RATE (<85%)');
    console.log('Significant trades missing from CLOB.');
    console.log('Dome is NOT a valid CLOB-only truth target for this wallet.');
  }
}

main().catch(console.error);
