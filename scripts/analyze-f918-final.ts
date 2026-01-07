/**
 * Final analysis of f918 with proper deduplication
 *
 * Key insight: The CLOB trades capture the user's actual cash flows.
 * CTF splits are the internal mechanism, not additional costs.
 *
 * V17 formula: cash_flow + (final_shares × payout)
 * This should work IF we properly dedupe.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = 1.16;

interface Trade {
  event_id: string;
  token_id: string;
  side: string;
  usdc: number;
  tokens: number;
  trade_time: string;
  tx_hash: string;
  role: string;
  condition_id: string | null;
  outcome_index: number | null;
}

async function main() {
  console.log('f918 Final Analysis with Full Deduplication\n');

  // Step 1: Load CLOB trades with event_id dedup
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT d.*, m.condition_id, m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rawTrades = (await result.json()) as Trade[];

  console.log(`After event_id dedup: ${rawTrades.length} trades`);

  // Step 2: Apply maker/taker dedup
  const seen = new Map<string, Trade>();
  let makerTakerDupes = 0;

  for (const trade of rawTrades) {
    const key = `${trade.tx_hash}|${trade.token_id}|${trade.side}|${trade.usdc.toFixed(6)}|${trade.tokens.toFixed(6)}|${trade.trade_time}`;
    const existing = seen.get(key);
    if (existing) {
      makerTakerDupes++;
      if (trade.role === 'taker' && existing.role === 'maker') {
        seen.set(key, trade);
      }
    } else {
      seen.set(key, trade);
    }
  }

  const trades = [...seen.values()];
  console.log(`After maker/taker dedup: ${trades.length} trades (removed ${makerTakerDupes})`);

  // Step 3: Get resolutions
  const tokenIds = [...new Set(trades.map(t => t.token_id))];
  const tokenList = tokenIds.map(t => `'${t}'`).join(',');

  const resQuery = `
    WITH token_map AS (
      SELECT token_id_dec, condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${tokenList})
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

  const resolutions = new Map<string, { payout: number; isResolved: boolean }>();
  for (const row of resRows) {
    let payout = 0.5;
    let isResolved = false;
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        const outcomeIndex = Number(row.outcome_index);
        const denom = payouts.reduce((a: number, b: number) => a + b, 0);
        payout = denom > 0 ? payouts[outcomeIndex] / denom : 0.5;
        isResolved = true;
      } catch { }
    }
    resolutions.set(row.token_id, { payout, isResolved });
  }

  console.log(`Loaded ${resolutions.size} resolutions`);

  // Step 4: Aggregate by token_id
  const positions = new Map<string, { buyUsdc: number; sellUsdc: number; buyTokens: number; sellTokens: number }>();

  for (const t of trades) {
    const pos = positions.get(t.token_id) || { buyUsdc: 0, sellUsdc: 0, buyTokens: 0, sellTokens: 0 };
    if (t.side === 'buy') {
      pos.buyUsdc += t.usdc;
      pos.buyTokens += t.tokens;
    } else {
      pos.sellUsdc += t.usdc;
      pos.sellTokens += t.tokens;
    }
    positions.set(t.token_id, pos);
  }

  console.log(`Aggregated into ${positions.size} positions`);

  // Step 5: Calculate V17 PnL
  let realizedPnl = 0;
  let unrealizedPnl = 0;

  console.log('\n' + '='.repeat(85));
  console.log('Position-level PnL (V17 cash-flow formula, CLOB only):');
  console.log('Token (last 12) | Cash Flow | Final Tokens | Payout | Resolved | PnL');
  console.log('-'.repeat(85));

  for (const [tokenId, pos] of positions) {
    const cashFlow = pos.sellUsdc - pos.buyUsdc;
    const finalTokens = pos.buyTokens - pos.sellTokens;
    const res = resolutions.get(tokenId);
    const isResolved = res?.isResolved ?? false;
    const payout = res?.payout ?? 0.5;

    let pnl: number;
    if (isResolved) {
      pnl = cashFlow + (finalTokens * payout);
      realizedPnl += pnl;
    } else {
      pnl = 0; // Don't count unrealized
      unrealizedPnl += cashFlow + (finalTokens * 0.5);
    }

    console.log(
      `...${tokenId.slice(-12)} | ${cashFlow.toFixed(2).padStart(9)} | ${finalTokens.toFixed(2).padStart(12)} | ${payout.toFixed(2).padStart(6)} | ${(isResolved ? 'YES' : 'NO').padStart(8)} | ${pnl.toFixed(2).padStart(7)}`
    );
  }

  console.log('-'.repeat(85));

  const totalPnl = realizedPnl;
  const error = ((totalPnl - UI_PNL) / Math.abs(UI_PNL)) * 100;

  console.log(`\nV17 CLOB-only Results:`);
  console.log(`  Realized: $${realizedPnl.toFixed(2)}`);
  console.log(`  Total: $${totalPnl.toFixed(2)}`);
  console.log(`  UI Target: $${UI_PNL}`);
  console.log(`  Error: ${error.toFixed(1)}%`, Math.abs(error) < 10 ? '✅' : '❌');

  // Step 6: Analyze the gap
  console.log('\n' + '='.repeat(85));
  console.log('Gap Analysis:');
  console.log('='.repeat(85));

  // Check if any tokens appear in multiple condition_ids
  const tokenToConditions = new Map<string, Set<string>>();
  for (const t of trades) {
    if (t.condition_id) {
      const set = tokenToConditions.get(t.token_id) || new Set();
      set.add(t.condition_id);
      tokenToConditions.set(t.token_id, set);
    }
  }

  // Summary stats
  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');

  console.log(`\nTrade Summary:`);
  console.log(`  Buy trades: ${buys.length}, Total USDC: $${buys.reduce((s, t) => s + t.usdc, 0).toFixed(2)}`);
  console.log(`  Sell trades: ${sells.length}, Total USDC: $${sells.reduce((s, t) => s + t.usdc, 0).toFixed(2)}`);

  // Check for "short" positions (sold more than bought)
  let shortPositions = 0;
  let totalShortTokens = 0;
  for (const [tokenId, pos] of positions) {
    if (pos.sellTokens > pos.buyTokens) {
      shortPositions++;
      totalShortTokens += pos.sellTokens - pos.buyTokens;
      console.log(`  SHORT: ...${tokenId.slice(-12)} sold ${pos.sellTokens.toFixed(2)} but only bought ${pos.buyTokens.toFixed(2)}`);
    }
  }

  console.log(`\nShort positions: ${shortPositions} (total short tokens: ${totalShortTokens.toFixed(2)})`);
  console.log(`Note: Short positions are valid - they come from selling NO tokens from splits`);

  // The gap might be explained by what UI considers vs what we calculate
  console.log(`\nPossible explanations for ${error.toFixed(1)}% gap:`);
  console.log(`  1. UI may use different price/payout data`);
  console.log(`  2. UI may apply different rounding`);
  console.log(`  3. Data timing differences (UI snapshot vs live)`);
  console.log(`  4. Maker/taker dedup might not match UI logic`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
