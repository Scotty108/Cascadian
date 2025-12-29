#!/usr/bin/env npx tsx
/**
 * Detailed V11 Trace
 *
 * Traces V11 calculation step-by-step for a specific wallet.
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface TradeEvent {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  side: 'buy' | 'sell';
  qty_tokens: number;
  price: number;
  usdc_notional: number;
}

interface PositionState {
  amount: number;
  avgPrice: number;
  totalBought: number;
  realized_pnl: number;
  trade_count: number;
}

function roundToCents(price: number): number {
  return Math.round(price * 100) / 100;
}

async function main() {
  const wallet = process.argv[2] || '0x569e2cb3cc89b7afb28f79a262aae30da6cb4175';

  console.log(`=== V11 Detailed Trace for ${wallet} ===\n`);

  // Load trades
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time,
      fills.side,
      fills.qty_tokens,
      fills.price,
      fills.usdc_notional
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_notional,
        CASE WHEN any(token_amount) > 0
          THEN any(usdc_amount) / any(token_amount)
          ELSE 0
        END as price
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v5 m ON fills.token_id = m.token_id_dec
    ORDER BY fills.trade_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const trades = (await result.json()) as any[];

  console.log(`Loaded ${trades.length} trades\n`);

  // Load resolutions
  const resResult = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`,
    format: 'JSONEachRow',
  });
  const resRows = await resResult.json() as any[];
  const resolutionCache = new Map<string, number[]>();
  for (const r of resRows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resolutionCache.set(r.condition_id.toLowerCase(), payouts);
  }
  console.log(`Loaded ${resolutionCache.size} resolutions\n`);

  // Process trades
  const states = new Map<string, PositionState>();
  const getKey = (cid: string, idx: number) => `${cid.toLowerCase()}_${idx}`;

  let tradingPnl = 0;

  for (const t of trades) {
    const trade: TradeEvent = {
      condition_id: t.condition_id,
      outcome_index: Number(t.outcome_index),
      trade_time: t.trade_time,
      side: t.side as 'buy' | 'sell',
      qty_tokens: Number(t.qty_tokens),
      price: Number(t.price),
      usdc_notional: Number(t.usdc_notional),
    };

    const key = getKey(trade.condition_id, trade.outcome_index);

    if (!states.has(key)) {
      states.set(key, {
        amount: 0,
        avgPrice: 0,
        totalBought: 0,
        realized_pnl: 0,
        trade_count: 0,
      });
    }

    const state = states.get(key)!;
    state.trade_count++;

    const price = roundToCents(trade.price);

    if (trade.side === 'buy') {
      if (trade.qty_tokens > 0) {
        const numerator = state.avgPrice * state.amount + price * trade.qty_tokens;
        const denominator = state.amount + trade.qty_tokens;
        state.avgPrice = numerator / denominator;
        state.amount += trade.qty_tokens;
        state.totalBought += trade.qty_tokens;
      }
    } else if (trade.side === 'sell') {
      const adjustedAmount = Math.min(trade.qty_tokens, state.amount);

      if (adjustedAmount > 0 && state.avgPrice > 0) {
        const deltaPnL = adjustedAmount * (price - state.avgPrice);
        state.realized_pnl += deltaPnL;
        tradingPnl += deltaPnL;
        state.amount -= adjustedAmount;
      }
    }
  }

  // Show top positions by trading pnl
  const positionSummaries: { key: string; state: PositionState; resolutionPayouts: number[] | null }[] = [];

  for (const [key, state] of states.entries()) {
    const [condId] = key.split('_');
    const payouts = resolutionCache.get(condId) || null;
    positionSummaries.push({ key, state, resolutionPayouts: payouts });
  }

  // Sort by absolute realized pnl
  positionSummaries.sort((a, b) => Math.abs(b.state.realized_pnl) - Math.abs(a.state.realized_pnl));

  console.log('=== Top 15 Positions by Trading PnL ===\n');
  for (let i = 0; i < Math.min(15, positionSummaries.length); i++) {
    const p = positionSummaries[i];
    const [condId, outcomeIdx] = p.key.split('_');
    const idx = parseInt(outcomeIdx, 10);
    const payout = p.resolutionPayouts ? p.resolutionPayouts[idx] : null;
    const resolved = payout !== null;

    console.log(`Position ${i + 1}: ${condId.slice(0, 16)}..._${outcomeIdx}`);
    console.log(`  Trading PnL: $${p.state.realized_pnl.toFixed(2)}`);
    console.log(`  Remaining: ${p.state.amount.toFixed(2)} tokens @ avg $${p.state.avgPrice.toFixed(4)}`);
    console.log(`  Resolution: ${resolved ? `payout=${payout}` : 'NOT RESOLVED'}`);
    console.log('');
  }

  // Calculate total pnl
  let resolutionPnl = 0;
  let unresolvedPositionCount = 0;
  let resolvedPositionCount = 0;

  for (const [key, state] of states.entries()) {
    if (state.amount > 0.01) {
      const [condId, outcomeIdx] = key.split('_');
      const idx = parseInt(outcomeIdx, 10);
      const payouts = resolutionCache.get(condId);

      if (payouts && payouts.length > idx) {
        const payout = payouts[idx];
        const resPnl = (payout - state.avgPrice) * state.amount;
        resolutionPnl += resPnl;
        resolvedPositionCount++;
      } else {
        unresolvedPositionCount++;
      }
    }
  }

  console.log('=== SUMMARY ===\n');
  console.log(`Total positions: ${states.size}`);
  console.log(`With remaining tokens: ${[...states.values()].filter(s => s.amount > 0.01).length}`);
  console.log(`  - Resolved: ${resolvedPositionCount}`);
  console.log(`  - Unresolved: ${unresolvedPositionCount}`);
  console.log('');
  console.log(`Trading PnL (sells only): $${tradingPnl.toFixed(2)}`);
  console.log(`Resolution PnL (hold to close): $${resolutionPnl.toFixed(2)}`);
  console.log(`TOTAL REALIZED PnL: $${(tradingPnl + resolutionPnl).toFixed(2)}`);

  // Fetch Dome value for comparison
  const domeQuery = `
    SELECT
      case
        when scaledRealizedProfitLoss < 0 THEN scaledRealizedProfitLoss / 1000000.0
        else scaledRealizedProfitLoss / 1000000.0
      end as realized_pnl
    FROM pm_dome_scaledprofit_v1
    WHERE lower(user_id) = lower('${wallet}')
  `;
  const domeResult = await clickhouse.query({ query: domeQuery, format: 'JSONEachRow' });
  const domeRows = await domeResult.json() as any[];

  if (domeRows.length > 0) {
    const domePnl = Number(domeRows[0].realized_pnl);
    console.log(`\nDome Realized PnL: $${domePnl.toFixed(2)}`);
    console.log(`Delta (V11 - Dome): $${(tradingPnl + resolutionPnl - domePnl).toFixed(2)}`);
    console.log(`Error %: ${(Math.abs(tradingPnl + resolutionPnl - domePnl) / Math.abs(domePnl) * 100).toFixed(1)}%`);
  }
}

main().catch(console.error);
