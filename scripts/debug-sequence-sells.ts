/**
 * Debug event sequencing to find where sells happen before splits
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

interface UnifiedEvent {
  type: 'clob' | 'ctf_split' | 'ctf_merge';
  token_id: string;
  side: 'buy' | 'sell';
  amount: number;
  timestamp: string;
  tx_hash: string;
  source_table: string;
}

async function main() {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Step 1: Load all CLOB trades
  console.log('Loading CLOB trades...');
  const clobQuery = `
    SELECT
      token_id,
      side,
      token_amount / 1e6 as amount,
      trade_time as timestamp,
      lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
    ORDER BY trade_time
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobRows = (await clobResult.json()) as any[];
  console.log(`  Loaded ${clobRows.length} CLOB trades`);

  // Step 2: Load all CTF events
  console.log('Loading CTF events...');
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
      event_timestamp as timestamp,
      tx_hash
    FROM pm_ctf_events
    WHERE (
      (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
      OR lower(user_address) = lower('${WALLET}')
    )
    AND is_deleted = 0
    ORDER BY event_timestamp
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as any[];
  console.log(`  Loaded ${ctfRows.length} CTF events`);

  // Step 3: Get condition -> token mapping
  const conditionIds = [...new Set(ctfRows.map(r => r.condition_id.toLowerCase()))];
  const conditionList = conditionIds.map(c => `'${c}'`).join(',');

  console.log('Loading token mappings...');
  const tokenMapQuery = `
    SELECT
      lower(condition_id) as condition_id,
      token_id_dec,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) IN (${conditionList})
  `;

  const tokenMapResult = await clickhouse.query({ query: tokenMapQuery, format: 'JSONEachRow' });
  const tokenMapRows = (await tokenMapResult.json()) as any[];

  const conditionToTokens = new Map<string, { token_id_0: string; token_id_1: string }>();
  for (const row of tokenMapRows) {
    const entry = conditionToTokens.get(row.condition_id) || { token_id_0: '', token_id_1: '' };
    if (row.outcome_index === 0) entry.token_id_0 = row.token_id_dec;
    else if (row.outcome_index === 1) entry.token_id_1 = row.token_id_dec;
    conditionToTokens.set(row.condition_id, entry);
  }
  console.log(`  Mapped ${conditionToTokens.size} conditions to tokens`);

  // Step 4: Build unified event stream
  const events: UnifiedEvent[] = [];

  // Add CLOB events
  for (const r of clobRows) {
    events.push({
      type: 'clob',
      token_id: r.token_id,
      side: r.side,
      amount: r.amount,
      timestamp: r.timestamp,
      tx_hash: r.tx_hash,
      source_table: 'pm_trader_events_v2',
    });
  }

  // Add CTF events (split into per-token)
  for (const r of ctfRows) {
    const tokens = conditionToTokens.get(r.condition_id.toLowerCase());
    if (!tokens) continue;

    const eventType = r.event_type === 'PositionSplit' ? 'ctf_split' : 'ctf_merge';
    const side = r.event_type === 'PositionSplit' ? 'buy' : 'sell';

    if (tokens.token_id_0) {
      events.push({
        type: eventType as 'ctf_split' | 'ctf_merge',
        token_id: tokens.token_id_0,
        side,
        amount: r.amount,
        timestamp: r.timestamp,
        tx_hash: r.tx_hash,
        source_table: 'pm_ctf_events',
      });
    }
    if (tokens.token_id_1) {
      events.push({
        type: eventType as 'ctf_split' | 'ctf_merge',
        token_id: tokens.token_id_1,
        side,
        amount: r.amount,
        timestamp: r.timestamp,
        tx_hash: r.tx_hash,
        source_table: 'pm_ctf_events',
      });
    }
  }

  console.log(`\nUnified event stream: ${events.length} events`);

  // Sort by timestamp with CTF events before CLOB events in same tx
  events.sort((a, b) => {
    const timeCompare = a.timestamp.localeCompare(b.timestamp);
    if (timeCompare !== 0) return timeCompare;
    // Same timestamp - CTF events before CLOB
    if (a.tx_hash === b.tx_hash) {
      const typeOrder = { ctf_split: 0, ctf_merge: 1, clob: 2 };
      return typeOrder[a.type] - typeOrder[b.type];
    }
    return 0;
  });

  // Step 5: Process events and track inventory per token
  const inventory = new Map<string, number>();
  let totalExternalSells = 0;
  const externalSellEvents: { event: UnifiedEvent; had: number; needed: number }[] = [];

  for (const e of events) {
    const current = inventory.get(e.token_id) || 0;

    if (e.side === 'buy') {
      inventory.set(e.token_id, current + e.amount);
    } else {
      // sell
      if (current >= e.amount - 0.01) {
        inventory.set(e.token_id, current - e.amount);
      } else {
        const external = e.amount - current;
        totalExternalSells += external;
        inventory.set(e.token_id, 0);
        externalSellEvents.push({ event: e, had: current, needed: e.amount });
      }
    }
  }

  console.log(`\nTotal external sells: ${totalExternalSells.toFixed(2)}`);
  console.log(`External sell events: ${externalSellEvents.length}`);

  // Show first 20 external sell events
  console.log('\nFirst 20 external sell events:');
  console.log('Timestamp | Type | Token (last 12) | Had | Needed | External | TX (last 8)');
  console.log('-'.repeat(100));
  for (const { event, had, needed } of externalSellEvents.slice(0, 20)) {
    const external = needed - had;
    console.log(
      `${event.timestamp} | ${event.type.padEnd(10)} | ...${event.token_id.slice(-12)} | ${had.toFixed(2).padStart(8)} | ${needed.toFixed(2).padStart(8)} | ${external.toFixed(2).padStart(8)} | ...${event.tx_hash.slice(-8)}`
    );
  }

  // Check if these external sells have CTF events we might be missing
  if (externalSellEvents.length > 0) {
    console.log('\n\nChecking for missing CTF events on external sell tokens...');

    // Get unique tokens with external sells
    const externalTokens = [...new Set(externalSellEvents.map(e => e.event.token_id))];
    console.log(`Unique tokens with external sells: ${externalTokens.length}`);

    // Check if these tokens have condition mappings
    const tokenList = externalTokens.slice(0, 10).map(t => `'${t}'`).join(',');
    const reverseMapQuery = `
      SELECT
        token_id_dec,
        condition_id
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${tokenList})
    `;

    const reverseResult = await clickhouse.query({ query: reverseMapQuery, format: 'JSONEachRow' });
    const reverseRows = (await reverseResult.json()) as any[];

    console.log('\nCondition mappings for external sell tokens:');
    for (const r of reverseRows) {
      const hasEvents = conditionIds.includes(r.condition_id.toLowerCase());
      console.log(`  Token ...${r.token_id_dec.slice(-12)} -> ${r.condition_id.slice(0, 16)}... | CTF events: ${hasEvents ? '✅' : '❌ MISSING'}`);
    }
  }

  // Additional diagnostic: Show first few events in the unified stream
  console.log('\n\nFirst 30 events in unified stream:');
  console.log('Timestamp | Type | Side | Token (last 12) | Amount | TX (last 8)');
  console.log('-'.repeat(100));
  for (const e of events.slice(0, 30)) {
    console.log(
      `${e.timestamp} | ${e.type.padEnd(10)} | ${e.side.padEnd(4)} | ...${e.token_id.slice(-12)} | ${e.amount.toFixed(2).padStart(10)} | ...${e.tx_hash.slice(-8)}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
