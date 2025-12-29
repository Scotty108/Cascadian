/**
 * Debug TX hash matching between Activity API and CLOB
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG TX HASH MATCHING');
  console.log('='.repeat(80));

  // Get sample CLOB tx hashes
  console.log('\n--- Sample CLOB tx hashes ---');
  const clobQuery = `
    SELECT
      lower(hex(transaction_hash)) as tx_hash_hex,
      transaction_hash as tx_hash_raw,
      trade_time
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${WALLET}')
    ORDER BY trade_time DESC
    LIMIT 5
  `;
  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobSamples = (await clobResult.json()) as any[];
  for (const r of clobSamples) {
    console.log('  hex:', r.tx_hash_hex);
    console.log('  raw:', r.tx_hash_raw);
    console.log('  time:', r.trade_time);
    console.log('');
  }

  // Get sample Activity API tx hashes
  console.log('--- Sample Activity API tx hashes ---');
  const activityUrl = `https://data-api.polymarket.com/activity?user=${WALLET}&limit=5`;
  const actResp = await fetch(activityUrl, { headers: { accept: 'application/json' } });
  const activities = (await actResp.json()) as any[];
  for (const a of activities) {
    if (a.transactionHash) {
      console.log('  raw:', a.transactionHash);
      console.log('  lower:', a.transactionHash.toLowerCase());
      console.log('  no 0x:', a.transactionHash.toLowerCase().replace('0x', ''));
      console.log('  type:', a.type);
      console.log('');
    }
  }

  // Now try to match one specific tx
  if (clobSamples.length > 0 && activities.length > 0) {
    const clobTxHex = clobSamples[0].tx_hash_hex;
    const activityTx = activities[0].transactionHash?.toLowerCase().replace('0x', '');

    console.log('--- Comparison ---');
    console.log('CLOB hex:    ', clobTxHex);
    console.log('Activity hex:', activityTx);
    console.log('Match:', clobTxHex === activityTx);
  }

  // Try to find a CLOB tx in Activity API
  console.log('\n--- Searching for CLOB tx in Activity API ---');
  if (clobSamples.length > 0) {
    const searchTx = '0x' + clobSamples[0].tx_hash_hex;
    console.log('Searching for:', searchTx);

    // Fetch more activities and search
    const allActivities: any[] = [];
    for (const offset of [0, 100, 200, 300, 400]) {
      const url = `https://data-api.polymarket.com/activity?user=${WALLET}&limit=100&offset=${offset}`;
      const resp = await fetch(url, { headers: { accept: 'application/json' } });
      const data = (await resp.json()) as any[];
      allActivities.push(...data);
      if (data.length < 100) break;
    }

    const found = allActivities.find(
      (a) => a.transactionHash?.toLowerCase() === searchTx.toLowerCase()
    );
    console.log('Found in Activity API:', found ? 'YES' : 'NO');
    if (found) {
      console.log('  Type:', found.type);
      console.log('  Timestamp:', found.timestamp);
    }
  }
}

main().catch(console.error);
