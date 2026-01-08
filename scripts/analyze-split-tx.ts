#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const SPLIT_HEAVY = '0xb2e4567925b79231265adf5d54687ddfb761bc51';

async function main() {
  // Step 1: Get some tx_hashes from split-heavy wallet
  const walletTxQuery = `
    SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${SPLIT_HEAVY}'
      AND is_deleted = 0
    LIMIT 100
  `;
  const walletTxResult = await clickhouse.query({ query: walletTxQuery, format: 'JSONEachRow' });
  const walletTxs = (await walletTxResult.json() as any[]).map(r => r.tx_hash);

  console.log(`Got ${walletTxs.length} wallet txs\n`);

  // Step 2: Check which have proxy splits (batch query)
  const txList = walletTxs.map(t => `'${t}'`).join(',');
  const splitQuery = `
    SELECT DISTINCT tx_hash
    FROM pm_ctf_events
    WHERE tx_hash IN (${txList})
      AND user_address IN ('0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296')
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
    LIMIT 5
  `;
  const splitResult = await clickhouse.query({ query: splitQuery, format: 'JSONEachRow' });
  const splitTxs = (await splitResult.json() as any[]).map(r => r.tx_hash);

  console.log(`Found ${splitTxs.length} with proxy splits\n`);

  // Step 3: Analyze each tx
  for (const txHash of splitTxs.slice(0, 3)) {
    console.log('='.repeat(70));
    console.log('TX:', txHash);

    // Get CTF events
    const ctfQuery = `
      SELECT event_type, user_address, condition_id, toFloat64OrZero(amount_or_payout) / 1e6 as tokens
      FROM pm_ctf_events
      WHERE tx_hash = '${txHash}' AND is_deleted = 0
    `;
    const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
    const ctfEvents = await ctfResult.json();
    console.log('CTF events:');
    for (const e of ctfEvents as any[]) {
      console.log(`  ${e.event_type} by ${e.user_address.slice(0,10)}... ${e.tokens} tokens`);
    }

    // Get CLOB trades
    const clobQuery = `
      SELECT trader_wallet, role, side, toFloat64(usdc_amount) / 1e6 as usdc, toFloat64(token_amount) / 1e6 as tokens, token_id
      FROM pm_trader_events_v2
      WHERE lower(concat('0x', hex(transaction_hash))) = '${txHash}' AND is_deleted = 0
      GROUP BY trader_wallet, role, side, usdc_amount, token_amount, token_id
    `;
    const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
    const clobTrades = await clobResult.json();
    console.log('CLOB trades:');
    for (const t of clobTrades as any[]) {
      const wallet = t.trader_wallet === SPLIT_HEAVY ? 'SPLIT_HEAVY' : t.trader_wallet.slice(0,10) + '...';
      console.log(`  ${wallet} ${t.role} ${t.side} ${t.tokens} @ $${t.usdc} (token: ...${t.token_id.slice(-8)})`);
    }

    // Get ERC1155 transfers to/from split-heavy
    const transferQuery = `
      SELECT from_address, to_address, token_id,
        reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) / 1e6 as tokens
      FROM pm_erc1155_transfers
      WHERE tx_hash = '${txHash}'
        AND (from_address = '${SPLIT_HEAVY}' OR to_address = '${SPLIT_HEAVY}')
        AND is_deleted = 0
    `;
    const transferResult = await clickhouse.query({ query: transferQuery, format: 'JSONEachRow' });
    const transfers = await transferResult.json();
    if ((transfers as any[]).length > 0) {
      console.log('ERC1155 transfers involving split-heavy:');
      for (const tr of transfers as any[]) {
        const from = tr.from_address === SPLIT_HEAVY ? 'SPLIT_HEAVY' : tr.from_address.slice(0,10) + '...';
        const to = tr.to_address === SPLIT_HEAVY ? 'SPLIT_HEAVY' : tr.to_address.slice(0,10) + '...';
        console.log(`  ${from} -> ${to}: ${tr.tokens} tokens (...${tr.token_id.slice(-8)})`);
      }
    } else {
      console.log('No ERC1155 transfers involving split-heavy');
    }
    console.log('');
  }

  process.exit(0);
}

main().catch(console.error);
