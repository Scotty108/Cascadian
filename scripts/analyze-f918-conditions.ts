/**
 * Analyze f918 by condition_id to find missing positions
 *
 * Theory: The SHORT positions (sold without buying) have matching
 * LONG positions from the same splits that aren't visible in CLOB.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = 1.16;

async function main() {
  console.log('f918 Condition-level Analysis\n');

  // Step 1: Get CLOB trades with dedup
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
  const rawTrades = (await result.json()) as any[];

  // Apply maker/taker dedup
  const seen = new Map<string, any>();
  for (const trade of rawTrades) {
    const key = `${trade.tx_hash}|${trade.token_id}|${trade.side}|${trade.usdc.toFixed(6)}|${trade.tokens.toFixed(6)}|${trade.trade_time}`;
    const existing = seen.get(key);
    if (existing) {
      if (trade.role === 'taker' && existing.role === 'maker') {
        seen.set(key, trade);
      }
    } else {
      seen.set(key, trade);
    }
  }

  const trades = [...seen.values()];
  console.log(`CLOB trades after full dedup: ${trades.length}`);

  // Step 2: Get CTF splits
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
      tx_hash
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_hashes)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const splits = (await ctfResult.json()) as any[];

  console.log(`CTF splits: ${splits.length}`);

  // Step 3: Get token mapping
  const conditionIds = [...new Set([
    ...trades.map(t => t.condition_id).filter(Boolean),
    ...splits.map(s => s.condition_id),
  ])];

  const condList = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');

  const mapQuery = `
    SELECT
      lower(condition_id) as condition_id,
      token_id_dec,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) IN (${condList || "''"})
  `;

  const mapResult = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' });
  const mapRows = (await mapResult.json()) as any[];

  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  const conditionToTokens = new Map<string, { token0: string; token1: string }>();

  for (const row of mapRows) {
    tokenToCondition.set(row.token_id_dec, { condition_id: row.condition_id, outcome_index: row.outcome_index });
    const entry = conditionToTokens.get(row.condition_id) || { token0: '', token1: '' };
    if (row.outcome_index === 0) entry.token0 = row.token_id_dec;
    else if (row.outcome_index === 1) entry.token1 = row.token_id_dec;
    conditionToTokens.set(row.condition_id, entry);
  }

  console.log(`Mapped ${conditionToTokens.size} conditions`);

  // Step 4: Get resolutions by condition
  const resQuery = `
    SELECT
      lower(condition_id) as condition_id,
      payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${condList || "''"})
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  const resolutions = new Map<string, number[]>();
  for (const row of resRows) {
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        resolutions.set(row.condition_id, payouts);
      } catch { }
    }
  }

  console.log(`Loaded ${resolutions.size} resolutions`);

  // Step 5: Build position by condition
  // Include BOTH CLOB and CTF splits
  interface ConditionPosition {
    condition_id: string;
    // Outcome 0
    buy0_usdc: number;
    buy0_tokens: number;
    sell0_usdc: number;
    sell0_tokens: number;
    // Outcome 1
    buy1_usdc: number;
    buy1_tokens: number;
    sell1_usdc: number;
    sell1_tokens: number;
    // From splits
    split_tokens: number;
  }

  const positions = new Map<string, ConditionPosition>();

  // Add CLOB trades
  for (const t of trades) {
    if (!t.condition_id) continue;

    const condId = t.condition_id.toLowerCase();
    const pos = positions.get(condId) || {
      condition_id: condId,
      buy0_usdc: 0, buy0_tokens: 0, sell0_usdc: 0, sell0_tokens: 0,
      buy1_usdc: 0, buy1_tokens: 0, sell1_usdc: 0, sell1_tokens: 0,
      split_tokens: 0,
    };

    if (t.outcome_index === 0) {
      if (t.side === 'buy') {
        pos.buy0_usdc += t.usdc;
        pos.buy0_tokens += t.tokens;
      } else {
        pos.sell0_usdc += t.usdc;
        pos.sell0_tokens += t.tokens;
      }
    } else if (t.outcome_index === 1) {
      if (t.side === 'buy') {
        pos.buy1_usdc += t.usdc;
        pos.buy1_tokens += t.tokens;
      } else {
        pos.sell1_usdc += t.usdc;
        pos.sell1_tokens += t.tokens;
      }
    }

    positions.set(condId, pos);
  }

  // Add CTF splits
  for (const s of splits) {
    const condId = s.condition_id.toLowerCase();
    const pos = positions.get(condId) || {
      condition_id: condId,
      buy0_usdc: 0, buy0_tokens: 0, sell0_usdc: 0, sell0_tokens: 0,
      buy1_usdc: 0, buy1_tokens: 0, sell1_usdc: 0, sell1_tokens: 0,
      split_tokens: 0,
    };

    pos.split_tokens += s.amount;
    positions.set(condId, pos);
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log('Position by Condition:');
  console.log('='.repeat(100));
  console.log('Condition (last 12) | Split | O0 Buy$ | O0 Sell$ | O0 Net | O1 Buy$ | O1 Sell$ | O1 Net | Pay');
  console.log('-'.repeat(100));

  let totalPnl_ClobOnly = 0;
  let totalPnl_WithSplits = 0;

  for (const [condId, pos] of positions) {
    const payouts = resolutions.get(condId);
    const isResolved = !!payouts;
    const payout0 = isResolved ? payouts![0] / payouts!.reduce((a, b) => a + b, 0) : 0.5;
    const payout1 = isResolved ? payouts![1] / payouts!.reduce((a, b) => a + b, 0) : 0.5;

    // Net tokens per outcome (CLOB only)
    const net0_clob = pos.buy0_tokens - pos.sell0_tokens;
    const net1_clob = pos.buy1_tokens - pos.sell1_tokens;

    // Net tokens with splits
    const net0_split = pos.buy0_tokens + pos.split_tokens - pos.sell0_tokens;
    const net1_split = pos.buy1_tokens + pos.split_tokens - pos.sell1_tokens;

    // Cash flow per outcome
    const cash0 = pos.sell0_usdc - pos.buy0_usdc;
    const cash1 = pos.sell1_usdc - pos.buy1_usdc;

    // Split cost (both outcomes at $0.50)
    const splitCost = pos.split_tokens * 1.0; // $1 for each split (creates both)

    // PnL CLOB-only
    const pnl0_clob = cash0 + (net0_clob * payout0);
    const pnl1_clob = cash1 + (net1_clob * payout1);
    const pnl_clob = pnl0_clob + pnl1_clob;

    // PnL with splits (subtract split cost, add split tokens as inventory)
    const pnl0_split = cash0 + (net0_split * payout0);
    const pnl1_split = cash1 + (net1_split * payout1);
    const pnl_split = pnl0_split + pnl1_split - splitCost;

    if (isResolved) {
      totalPnl_ClobOnly += pnl_clob;
      totalPnl_WithSplits += pnl_split;
    }

    console.log(
      `...${condId.slice(-12)} | ${pos.split_tokens.toFixed(1).padStart(5)} | ${pos.buy0_usdc.toFixed(2).padStart(7)} | ${pos.sell0_usdc.toFixed(2).padStart(8)} | ${net0_clob.toFixed(1).padStart(6)} | ${pos.buy1_usdc.toFixed(2).padStart(7)} | ${pos.sell1_usdc.toFixed(2).padStart(8)} | ${net1_clob.toFixed(1).padStart(6)} | ${payout0.toFixed(0)}/${payout1.toFixed(0)}`
    );
  }

  console.log('-'.repeat(100));

  console.log(`\nPnL Comparison:`);
  console.log(`  CLOB-only (V17): $${totalPnl_ClobOnly.toFixed(2)} (error: ${((totalPnl_ClobOnly - UI_PNL) / UI_PNL * 100).toFixed(1)}%)`);
  console.log(`  With Splits (CLOB + CTF): $${totalPnl_WithSplits.toFixed(2)} (error: ${((totalPnl_WithSplits - UI_PNL) / UI_PNL * 100).toFixed(1)}%)`);
  console.log(`  UI Target: $${UI_PNL}`);

  // Now let's try a different approach: effective cost per outcome
  console.log(`\n${'='.repeat(100)}`);
  console.log('Alternative: Subgraph-style with synthetic cost adjustment');
  console.log('='.repeat(100));

  // For each condition:
  // - If split + paired CLOB trade in same tx: user's net cost is just CLOB cashflow
  // - Splits without CLOB trade: cost is $0.50 per outcome
  // - CLOB trades without splits: use CLOB prices

  // The insight: Splits that occur with paired CLOB trades are the MECHANISM, not additional cost.
  // We should trace the actual cash the user put in.

  // User's actual spend = sum of all CLOB buys - sum of all CLOB sells
  const totalClobBuyUsdc = trades.filter(t => t.side === 'buy').reduce((s, t) => s + t.usdc, 0);
  const totalClobSellUsdc = trades.filter(t => t.side === 'sell').reduce((s, t) => s + t.usdc, 0);
  const netClobCash = totalClobBuyUsdc - totalClobSellUsdc;

  console.log(`\nActual Cash Flows:`);
  console.log(`  CLOB Buys: $${totalClobBuyUsdc.toFixed(2)}`);
  console.log(`  CLOB Sells: $${totalClobSellUsdc.toFixed(2)}`);
  console.log(`  Net Cash Out: $${netClobCash.toFixed(2)}`);

  // Final tokens held (per outcome)
  let totalFinal0 = 0;
  let totalFinal1 = 0;
  let totalResolutionValue = 0;

  for (const [condId, pos] of positions) {
    const payouts = resolutions.get(condId);
    if (!payouts) continue;

    const payout0 = payouts[0] / payouts.reduce((a, b) => a + b, 0);
    const payout1 = payouts[1] / payouts.reduce((a, b) => a + b, 0);

    // Final tokens = CLOB buys + splits - CLOB sells
    const final0 = pos.buy0_tokens + pos.split_tokens - pos.sell0_tokens;
    const final1 = pos.buy1_tokens + pos.split_tokens - pos.sell1_tokens;

    totalFinal0 += final0;
    totalFinal1 += final1;

    // Resolution value
    totalResolutionValue += final0 * payout0 + final1 * payout1;
  }

  console.log(`\nFinal Holdings (CLOB + Splits - Sells):`);
  console.log(`  Outcome 0 tokens: ${totalFinal0.toFixed(2)}`);
  console.log(`  Outcome 1 tokens: ${totalFinal1.toFixed(2)}`);
  console.log(`  Resolution value: $${totalResolutionValue.toFixed(2)}`);

  const realPnl = totalResolutionValue - netClobCash;
  const realError = ((realPnl - UI_PNL) / Math.abs(UI_PNL)) * 100;

  console.log(`\nSimple PnL = Resolution Value - Net Cash Out`);
  console.log(`  PnL: $${totalResolutionValue.toFixed(2)} - $${netClobCash.toFixed(2)} = $${realPnl.toFixed(2)}`);
  console.log(`  UI Target: $${UI_PNL}`);
  console.log(`  Error: ${realError.toFixed(1)}%`, Math.abs(realError) < 10 ? '✅' : '❌');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
