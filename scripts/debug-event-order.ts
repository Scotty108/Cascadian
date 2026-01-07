/**
 * Debug event ordering for a specific token
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

// Token from earlier debug (outcome_0 of condition de8f8e0...)
const TOKEN_ID = '22376982958416409916619551216711420358647134057678626504288624830021884171141';
const CONDITION_ID = 'de8f8e0aa45bd0855f9c1d4c85b1add4aaed2cf70b682f8e883ac06d2927ce8e';

async function main() {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Get all events for this token, with timestamps
  console.log('Events for token (outcome_0 of condition de8f8e0...):');
  console.log('='.repeat(70));

  // CTF splits for this condition
  const ctfQuery = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
    )
    SELECT
      'CTF' as source,
      event_type as type,
      toFloat64OrZero(amount_or_payout) / 1e6 as tokens,
      event_timestamp as timestamp,
      tx_hash
    FROM pm_ctf_events
    WHERE (
      (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
      OR lower(user_address) = lower('${WALLET}')
    )
    AND lower(condition_id) = lower('${CONDITION_ID}')
    AND is_deleted = 0
    ORDER BY event_timestamp
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as any[];

  // CLOB trades for this token
  const clobQuery = `
    SELECT
      'CLOB' as source,
      side as type,
      token_amount / 1e6 as tokens,
      trade_time as timestamp,
      lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND token_id = '${TOKEN_ID}'
      AND is_deleted = 0
    ORDER BY trade_time
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobRows = (await clobResult.json()) as any[];

  // Merge and sort all events
  interface Event {
    source: string;
    type: string;
    tokens: number;
    timestamp: string;
    tx_hash: string;
  }

  const allEvents: Event[] = [...ctfRows, ...clobRows];
  allEvents.sort((a, b) => {
    const timeCompare = a.timestamp.localeCompare(b.timestamp);
    if (timeCompare !== 0) return timeCompare;
    // Same timestamp: CTF before CLOB
    if (a.source === 'CTF' && b.source === 'CLOB') return -1;
    if (a.source === 'CLOB' && b.source === 'CTF') return 1;
    return 0;
  });

  console.log('Timestamp               | Source | Type           | Tokens   | TX (last 12)');
  console.log('-'.repeat(80));

  let inventory = 0;
  for (const e of allEvents) {
    let inventoryChange = 0;
    let inventoryIndicator = '';

    if (e.source === 'CTF' && e.type === 'PositionSplit') {
      inventoryChange = e.tokens; // Split adds to inventory
      inventory += inventoryChange;
      inventoryIndicator = ` [inv: +${inventoryChange.toFixed(2)} → ${inventory.toFixed(2)}]`;
    } else if (e.source === 'CLOB' && e.type === 'buy') {
      inventoryChange = e.tokens;
      inventory += inventoryChange;
      inventoryIndicator = ` [inv: +${inventoryChange.toFixed(2)} → ${inventory.toFixed(2)}]`;
    } else if (e.source === 'CLOB' && e.type === 'sell') {
      if (inventory >= e.tokens) {
        inventoryChange = -e.tokens;
        inventory += inventoryChange;
        inventoryIndicator = ` [inv: ${inventoryChange.toFixed(2)} → ${inventory.toFixed(2)}]`;
      } else {
        const external = e.tokens - inventory;
        inventoryChange = -inventory;
        inventory = 0;
        inventoryIndicator = ` [inv: ${inventoryChange.toFixed(2)} → 0, EXTERNAL: ${external.toFixed(2)}] ❌`;
      }
    }

    console.log(
      `${e.timestamp} | ${e.source.padEnd(4)} | ${e.type.padEnd(14)} | ${e.tokens.toFixed(2).padStart(8)} | ...${e.tx_hash.slice(-12)}${inventoryIndicator}`
    );
  }

  console.log('='.repeat(80));
  console.log(`Final inventory: ${inventory.toFixed(2)}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
