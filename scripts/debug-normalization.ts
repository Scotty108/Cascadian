/**
 * Debug paired-outcome normalization to understand what trades are being removed
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61';

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

async function main() {
  // Load trades
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

  const result = await clickhouse.query({ query: tradeQuery, format: 'JSONEachRow' });
  const rawTrades = (await result.json()) as RawTrade[];

  console.log(`Loaded ${rawTrades.length} trades`);

  // Find paired trades
  const phantomIndices = new Set<number>();
  const groups = new Map<string, { index: number; trade: RawTrade }[]>();

  for (let i = 0; i < rawTrades.length; i++) {
    const t = rawTrades[i];
    if (!t.condition_id || !t.tx_hash) continue;
    const key = `${t.tx_hash}|${t.condition_id}`;
    const list = groups.get(key) || [];
    list.push({ index: i, trade: t });
    groups.set(key, list);
  }

  console.log(`\nFound ${groups.size} tx+condition groups`);

  // Find and log paired trades
  const pairs: { buy: RawTrade; sell: RawTrade }[] = [];

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      if (phantomIndices.has(group[i].index)) continue;

      for (let j = i + 1; j < group.length; j++) {
        if (phantomIndices.has(group[j].index)) continue;

        const t1 = group[i].trade;
        const t2 = group[j].trade;

        if (t1.outcome_index === t2.outcome_index) continue;
        if (t1.outcome_index === null || t2.outcome_index === null) continue;
        if (t1.side === t2.side) continue;

        const amountDiff = Math.abs(t1.tokens - t2.tokens);
        const avgAmount = (t1.tokens + t2.tokens) / 2;
        if (avgAmount > 0 && amountDiff / avgAmount > 0.01) continue;

        const price1 = t1.tokens > 0 ? t1.usdc / t1.tokens : 0;
        const price2 = t2.tokens > 0 ? t2.usdc / t2.tokens : 0;
        const priceSum = price1 + price2;
        if (Math.abs(priceSum - 1.0) > 0.05) continue;

        // Found a paired trade
        const sellIndex = t1.side === 'sell' ? group[i].index : group[j].index;
        phantomIndices.add(sellIndex);

        const buyTrade = t1.side === 'buy' ? t1 : t2;
        const sellTrade = t1.side === 'sell' ? t1 : t2;
        pairs.push({ buy: buyTrade, sell: sellTrade });
      }
    }
  }

  console.log(`\nPaired trades found: ${pairs.length}`);
  console.log('Phantom (removed) indices:', phantomIndices.size);

  // Show what's being removed
  console.log('\n' + '='.repeat(80));
  console.log('REMOVED TRADES (Phantom legs)');
  console.log('='.repeat(80));

  let totalRemovedTokens = 0;
  for (const idx of [...phantomIndices].sort((a, b) => a - b)) {
    const t = rawTrades[idx];
    totalRemovedTokens += t.tokens;
    console.log(`  [${idx}] ${t.side} ${t.tokens.toFixed(2)} of outcome ${t.outcome_index} @ $${(t.usdc / t.tokens).toFixed(4)} | TX: ...${t.tx_hash.slice(-8)}`);
  }

  console.log(`\nTotal removed tokens: ${totalRemovedTokens.toFixed(2)}`);

  // Check impact on specific tokens
  console.log('\n' + '='.repeat(80));
  console.log('IMPACT ANALYSIS');
  console.log('='.repeat(80));

  // Aggregate by token before and after normalization
  const beforeByToken = new Map<string, { buys: number; sells: number }>();
  const afterByToken = new Map<string, { buys: number; sells: number }>();

  for (let i = 0; i < rawTrades.length; i++) {
    const t = rawTrades[i];

    // Before normalization
    const beforeEntry = beforeByToken.get(t.token_id) || { buys: 0, sells: 0 };
    if (t.side === 'buy') beforeEntry.buys += t.tokens;
    else beforeEntry.sells += t.tokens;
    beforeByToken.set(t.token_id, beforeEntry);

    // After normalization (skip phantom)
    if (!phantomIndices.has(i)) {
      const afterEntry = afterByToken.get(t.token_id) || { buys: 0, sells: 0 };
      if (t.side === 'buy') afterEntry.buys += t.tokens;
      else afterEntry.sells += t.tokens;
      afterByToken.set(t.token_id, afterEntry);
    }
  }

  // Find tokens where normalization changes the balance
  const impactedTokens: { tokenId: string; beforeNet: number; afterNet: number }[] = [];
  for (const [tokenId, before] of beforeByToken) {
    const after = afterByToken.get(tokenId) || { buys: 0, sells: 0 };
    const beforeNet = before.buys - before.sells;
    const afterNet = after.buys - after.sells;
    if (Math.abs(beforeNet - afterNet) > 0.01) {
      impactedTokens.push({ tokenId, beforeNet, afterNet });
    }
  }

  console.log(`Tokens with changed net balance: ${impactedTokens.length}`);
  for (const { tokenId, beforeNet, afterNet } of impactedTokens) {
    console.log(`  Token ...${tokenId.slice(-12)}: ${beforeNet.toFixed(2)} -> ${afterNet.toFixed(2)} (diff: ${(afterNet - beforeNet).toFixed(2)})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
