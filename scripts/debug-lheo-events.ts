/**
 * Debug Lheo's event ordering to understand why PnL is wrong
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61';
const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
];

async function main() {
  // Get CLOB trades with block_number
  const clobQuery = `
    SELECT
      event_id,
      side,
      token_id,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      block_number,
      trade_time
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
    ORDER BY block_number
    LIMIT 20
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobTrades = await clobResult.json() as any[];

  console.log('CLOB Trades (first 20):');
  console.log('Block | Side | Tokens | USDC | Token ID (last 8)');
  console.log('-'.repeat(70));
  for (const t of clobTrades) {
    console.log(`${t.block_number} | ${t.side} | ${t.tokens.toFixed(2)} | $${t.usdc.toFixed(2)} | ...${t.token_id.slice(-8)}`);
  }

  // Get CTF events with block_number
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');
  const ctfQuery = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
    )
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      block_number
    FROM pm_ctf_events
    WHERE (
      (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
      OR lower(user_address) = lower('${WALLET}')
    )
    AND is_deleted = 0
    ORDER BY block_number
    LIMIT 20
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfEvents = await ctfResult.json() as any[];

  console.log('\nCTF Events (first 20):');
  console.log('Block | Type | Amount | Condition ID (last 8)');
  console.log('-'.repeat(70));
  for (const e of ctfEvents) {
    console.log(`${e.block_number} | ${e.event_type} | ${e.amount.toFixed(2)} | ...${e.condition_id.slice(-8)}`);
  }

  // Check block_number ranges
  const clobBlocks = clobTrades.map(t => Number(t.block_number));
  const ctfBlocks = ctfEvents.map(e => Number(e.block_number));

  console.log('\nBlock Number Ranges:');
  console.log(`CLOB: ${Math.min(...clobBlocks)} - ${Math.max(...clobBlocks)}`);
  console.log(`CTF: ${Math.min(...ctfBlocks)} - ${Math.max(...ctfBlocks)}`);

  // Check for overlapping transactions (same tx_hash for CLOB and CTF)
  const sameBlockQuery = `
    WITH clob_blocks AS (
      SELECT DISTINCT block_number
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
    ),
    wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
    ),
    ctf_blocks AS (
      SELECT DISTINCT block_number
      FROM pm_ctf_events
      WHERE (
        (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
        OR lower(user_address) = lower('${WALLET}')
      )
      AND is_deleted = 0
    )
    SELECT
      'clob_only' as source,
      count() as cnt
    FROM clob_blocks
    WHERE block_number NOT IN (SELECT block_number FROM ctf_blocks)
    UNION ALL
    SELECT
      'ctf_only' as source,
      count() as cnt
    FROM ctf_blocks
    WHERE block_number NOT IN (SELECT block_number FROM clob_blocks)
    UNION ALL
    SELECT
      'both' as source,
      count() as cnt
    FROM clob_blocks
    WHERE block_number IN (SELECT block_number FROM ctf_blocks)
  `;

  const overlapResult = await clickhouse.query({ query: sameBlockQuery, format: 'JSONEachRow' });
  const overlap = await overlapResult.json() as any[];

  console.log('\nBlock Overlap:');
  for (const o of overlap) {
    console.log(`${o.source}: ${o.cnt} blocks`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
