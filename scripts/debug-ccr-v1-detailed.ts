/**
 * Detailed debug of CCR-v1 engine to trace external sells
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import {
  Position,
  emptyPosition,
  updateWithBuy,
  updateWithSell,
} from '../lib/pnl/costBasisEngineV1';

const WALLET = '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61';
const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
];
const FIFTY_CENTS = 0.50;

interface RawTrade {
  event_id: string;
  token_id: string;
  side: string;
  usdc: number;
  tokens: number;
  trade_time: string;
  block_number: number;
  tx_hash: string;
  condition_id: string | null;
  outcome_index: number | null;
}

interface RawCTFEvent {
  event_type: string;
  condition_id: string;
  amount: number;
  event_timestamp: string;
  block_number: number;
  tx_hash: string;
}

interface UnifiedEvent {
  type: 'clob' | 'ctf_split' | 'ctf_merge' | 'ctf_redemption';
  token_id: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  timestamp: string;
  event_id: string;
  tx_hash: string;
}

async function main() {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Load trades (same as engine)
  console.log('Loading trades...');
  const tradeQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        any(block_number) as block_number,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.event_id,
      d.token_id,
      d.side,
      d.usdc,
      d.tokens,
      d.trade_time,
      d.block_number,
      d.tx_hash,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.block_number, d.event_id
  `;

  const tradeResult = await clickhouse.query({ query: tradeQuery, format: 'JSONEachRow' });
  const rawTrades = (await tradeResult.json()) as RawTrade[];
  console.log(`  Loaded ${rawTrades.length} trades (deduped)`);

  // Load CTF events (same as engine)
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
      event_timestamp,
      block_number,
      tx_hash
    FROM pm_ctf_events
    WHERE (
      (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
      OR lower(user_address) = lower('${WALLET}')
    )
    AND is_deleted = 0
    ORDER BY block_number, event_timestamp
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const rawCTFEvents = (await ctfResult.json()) as RawCTFEvent[];
  console.log(`  Loaded ${rawCTFEvents.length} CTF events`);

  // Get condition -> token mapping
  const conditionIds = [...new Set(rawCTFEvents.map(e => e.condition_id.toLowerCase()))];
  const conditionList = conditionIds.map(c => `'${c}'`).join(',');

  console.log('Loading token mappings...');
  const tokenMapQuery = `
    SELECT
      lower(condition_id) as condition_id,
      token_id_dec,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) IN (${conditionList || "''"})
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
  console.log(`  Mapped ${conditionToTokens.size} conditions`);

  // Load resolutions
  const allTokenIds = [
    ...new Set([
      ...rawTrades.map(t => t.token_id),
      ...[...conditionToTokens.values()].flatMap(t => [t.token_id_0, t.token_id_1]),
    ]),
  ];
  const tokenList = allTokenIds.slice(0, 500).map(t => `'${t}'`).join(',');

  console.log('Loading resolutions...');
  const resQuery = `
    WITH token_map AS (
      SELECT token_id_dec, condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${tokenList || "''"})
    )
    SELECT
      m.token_id_dec as token_id,
      r.payout_numerators,
      m.outcome_index
    FROM token_map m
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  const resolutions = new Map<string, { payout: number; is_resolved: boolean }>();
  for (const row of resRows) {
    let payout = 0.5;
    let isResolved = false;

    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        const outcomeIndex = Number(row.outcome_index);
        const payoutDenominator = payouts.reduce((a: number, b: number) => a + b, 0);
        payout = payoutDenominator > 0 ? payouts[outcomeIndex] / payoutDenominator : 0;
        isResolved = true;
      } catch {
        // Parse error
      }
    }

    resolutions.set(row.token_id, { payout, is_resolved: isResolved });
  }
  console.log(`  Loaded ${resolutions.size} resolutions`);

  // Build unified events (NO paired-outcome normalization for now)
  const unifiedEvents: UnifiedEvent[] = [];

  // Add CLOB events
  for (const trade of rawTrades) {
    const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;
    unifiedEvents.push({
      type: 'clob',
      token_id: trade.token_id,
      side: trade.side === 'buy' ? 'buy' : 'sell',
      amount: trade.tokens,
      price,
      timestamp: trade.trade_time,
      event_id: trade.event_id,
      tx_hash: trade.tx_hash,
    });
  }

  // Add CTF events
  for (const ctfEvent of rawCTFEvents) {
    const tokens = conditionToTokens.get(ctfEvent.condition_id.toLowerCase());
    if (!tokens) continue;

    const amount = ctfEvent.amount;

    switch (ctfEvent.event_type) {
      case 'PositionSplit':
        unifiedEvents.push({
          type: 'ctf_split',
          token_id: tokens.token_id_0,
          side: 'buy',
          amount,
          price: FIFTY_CENTS,
          timestamp: ctfEvent.event_timestamp,
          event_id: `split_0_${ctfEvent.tx_hash}`,
          tx_hash: ctfEvent.tx_hash,
        });
        unifiedEvents.push({
          type: 'ctf_split',
          token_id: tokens.token_id_1,
          side: 'buy',
          amount,
          price: FIFTY_CENTS,
          timestamp: ctfEvent.event_timestamp,
          event_id: `split_1_${ctfEvent.tx_hash}`,
          tx_hash: ctfEvent.tx_hash,
        });
        break;

      case 'PositionsMerge':
        unifiedEvents.push({
          type: 'ctf_merge',
          token_id: tokens.token_id_0,
          side: 'sell',
          amount,
          price: FIFTY_CENTS,
          timestamp: ctfEvent.event_timestamp,
          event_id: `merge_0_${ctfEvent.tx_hash}`,
          tx_hash: ctfEvent.tx_hash,
        });
        unifiedEvents.push({
          type: 'ctf_merge',
          token_id: tokens.token_id_1,
          side: 'sell',
          amount,
          price: FIFTY_CENTS,
          timestamp: ctfEvent.event_timestamp,
          event_id: `merge_1_${ctfEvent.tx_hash}`,
          tx_hash: ctfEvent.tx_hash,
        });
        break;

      case 'PayoutRedemption':
        const payout0 = resolutions.get(tokens.token_id_0)?.payout ?? 0.5;
        const payout1 = resolutions.get(tokens.token_id_1)?.payout ?? 0.5;

        if (payout0 > 0) {
          unifiedEvents.push({
            type: 'ctf_redemption',
            token_id: tokens.token_id_0,
            side: 'sell',
            amount,
            price: payout0,
            timestamp: ctfEvent.event_timestamp,
            event_id: `redemption_0_${ctfEvent.tx_hash}`,
            tx_hash: ctfEvent.tx_hash,
          });
        }
        if (payout1 > 0) {
          unifiedEvents.push({
            type: 'ctf_redemption',
            token_id: tokens.token_id_1,
            side: 'sell',
            amount,
            price: payout1,
            timestamp: ctfEvent.event_timestamp,
            event_id: `redemption_1_${ctfEvent.tx_hash}`,
            tx_hash: ctfEvent.tx_hash,
          });
        }
        break;
    }
  }

  console.log(`\nUnified events: ${unifiedEvents.length}`);
  console.log(`  CLOB: ${unifiedEvents.filter(e => e.type === 'clob').length}`);
  console.log(`  Split: ${unifiedEvents.filter(e => e.type === 'ctf_split').length}`);
  console.log(`  Merge: ${unifiedEvents.filter(e => e.type === 'ctf_merge').length}`);
  console.log(`  Redemption: ${unifiedEvents.filter(e => e.type === 'ctf_redemption').length}`);

  // Sort by timestamp
  unifiedEvents.sort((a, b) => {
    const timeCompare = a.timestamp.localeCompare(b.timestamp);
    if (timeCompare !== 0) return timeCompare;

    if (a.tx_hash === b.tx_hash) {
      const typeOrder = { ctf_split: 0, ctf_merge: 1, clob: 2, ctf_redemption: 3 };
      return typeOrder[a.type] - typeOrder[b.type];
    }

    return a.event_id.localeCompare(b.event_id);
  });

  // Process events and track external sells
  const positions = new Map<string, Position>();
  const externalSellDetails: { event: UnifiedEvent; had: number; needed: number }[] = [];
  let totalExternalSellTokens = 0;

  for (const event of unifiedEvents) {
    const tokenId = event.token_id;
    let position = positions.get(tokenId) || emptyPosition(WALLET, tokenId);

    if (event.side === 'buy') {
      position = updateWithBuy(position, event.amount, event.price);
    } else {
      const beforeAmount = position.amount;
      const { position: newPos, result } = updateWithSell(position, event.amount, event.price);
      position = newPos;

      if (result.externalSell > 0.01) {
        externalSellDetails.push({ event, had: beforeAmount, needed: event.amount });
        totalExternalSellTokens += result.externalSell;
      }
    }

    positions.set(tokenId, position);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('EXTERNAL SELL ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Total external sell tokens: ${totalExternalSellTokens.toFixed(2)}`);
  console.log(`External sell events: ${externalSellDetails.length}`);

  // Group by token_id
  const byToken = new Map<string, { had: number; needed: number; count: number }>();
  for (const { event, had, needed } of externalSellDetails) {
    const entry = byToken.get(event.token_id) || { had: 0, needed: 0, count: 0 };
    entry.had += had;
    entry.needed += needed;
    entry.count++;
    byToken.set(event.token_id, entry);
  }

  console.log(`\nTokens with external sells: ${byToken.size}`);
  console.log('\nTop 10 tokens by external sells:');
  console.log('Token (last 12) | Events | Had | Needed | External');
  console.log('-'.repeat(70));

  const sorted = [...byToken.entries()].sort((a, b) => (b[1].needed - b[1].had) - (a[1].needed - a[1].had));
  for (const [tokenId, data] of sorted.slice(0, 10)) {
    const external = data.needed - data.had;
    console.log(`...${tokenId.slice(-12)} | ${String(data.count).padStart(6)} | ${data.had.toFixed(2).padStart(10)} | ${data.needed.toFixed(2).padStart(10)} | ${external.toFixed(2).padStart(10)}`);
  }

  // Show first 20 external sell events
  console.log('\n\nFirst 20 external sell events:');
  console.log('Timestamp | Type | Token (last 12) | Had | Needed | External');
  console.log('-'.repeat(100));
  for (const { event, had, needed } of externalSellDetails.slice(0, 20)) {
    const external = needed - had;
    console.log(
      `${event.timestamp} | ${event.type.padEnd(15)} | ...${event.token_id.slice(-12)} | ${had.toFixed(2).padStart(10)} | ${needed.toFixed(2).padStart(10)} | ${external.toFixed(2).padStart(10)}`
    );
  }

  // Check if these tokens have CTF splits at all
  console.log('\n\nChecking CTF coverage for external sell tokens...');
  const ctfTokensSet = new Set<string>();
  for (const e of unifiedEvents) {
    if (e.type === 'ctf_split') {
      ctfTokensSet.add(e.token_id);
    }
  }

  let hasCtf = 0;
  let noCtf = 0;
  for (const tokenId of byToken.keys()) {
    if (ctfTokensSet.has(tokenId)) {
      hasCtf++;
    } else {
      noCtf++;
      console.log(`  Token ...${tokenId.slice(-12)} has NO CTF splits`);
    }
  }
  console.log(`\nSummary: ${hasCtf} tokens with CTF splits, ${noCtf} without`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
