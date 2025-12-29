/**
 * Check if target wallet has FPMM trades
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

async function main() {
  console.log('='.repeat(80));
  console.log('CHECKING FPMM TRADES FOR WALLET');
  console.log('='.repeat(80));
  console.log('');
  console.log('Wallet:', WALLET);

  // Check FPMM trades for wallet
  const q1 = `
    SELECT count() as trades, sum(usdc_amount) as total_usdc
    FROM pm_fpmm_trades
    WHERE lower(trader_wallet) = lower('${WALLET}')
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const data1 = (await r1.json()) as any[];
  console.log('');
  console.log('FPMM Trades:', data1[0]?.trades);
  console.log('Total USDC:', data1[0]?.total_usdc);

  // If there are trades, show some details
  if (Number(data1[0]?.trades) > 0) {
    console.log('');
    console.log('--- Sample FPMM trades ---');
    const q2 = `
      SELECT trade_time, side, usdc_amount, transaction_hash
      FROM pm_fpmm_trades
      WHERE lower(trader_wallet) = lower('${WALLET}')
      ORDER BY trade_time DESC
      LIMIT 10
    `;
    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const trades = (await r2.json()) as any[];
    for (const t of trades) {
      console.log(
        '  ' + t.trade_time + ' | ' + t.side + ' | $' + Number(t.usdc_amount).toFixed(2)
      );
    }
  }

  // Check what's NOT in CLOB but might be in FPMM
  console.log('');
  console.log('--- Checking unmatched Activity tx hashes in FPMM ---');

  // Get some unmatched tx hashes from Activity API
  const activityUrl = `https://data-api.polymarket.com/activity?user=${WALLET}&limit=100`;
  const actResp = await fetch(activityUrl, { headers: { accept: 'application/json' } });
  const activities = (await actResp.json()) as any[];

  const tradeTxHashes = activities
    .filter((a: any) => a.type === 'TRADE' && a.transactionHash)
    .map((a: any) => a.transactionHash.toLowerCase());

  // Check how many are in CLOB
  const clobQuery = `
    SELECT lower(hex(transaction_hash)) as tx_hash
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${WALLET}')
  `;
  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobTxHashes = new Set((await clobResult.json() as any[]).map(r => r.tx_hash));

  // Check how many are in FPMM
  const fpmmQuery = `
    SELECT lower(transaction_hash) as tx_hash
    FROM pm_fpmm_trades
    WHERE lower(trader_wallet) = lower('${WALLET}')
  `;
  const fpmmResult = await clickhouse.query({ query: fpmmQuery, format: 'JSONEachRow' });
  const fpmmTxHashes = new Set((await fpmmResult.json() as any[]).map(r => r.tx_hash));

  let inClob = 0;
  let inFpmm = 0;
  let inNeither = 0;
  const neitherSamples: string[] = [];

  for (const txHash of tradeTxHashes) {
    const txHex = txHash.replace('0x', '');
    if (clobTxHashes.has(txHex)) {
      inClob++;
    } else if (fpmmTxHashes.has(txHash) || fpmmTxHashes.has(txHex)) {
      inFpmm++;
    } else {
      inNeither++;
      if (neitherSamples.length < 5) {
        neitherSamples.push(txHash);
      }
    }
  }

  console.log('Activity trades checked:', tradeTxHashes.length);
  console.log('  In CLOB:', inClob);
  console.log('  In FPMM:', inFpmm);
  console.log('  In neither:', inNeither);

  if (neitherSamples.length > 0) {
    console.log('');
    console.log('Sample tx hashes in neither CLOB nor FPMM:');
    for (const tx of neitherSamples) {
      console.log('  ' + tx);
    }
  }
}

main().catch(console.error);
