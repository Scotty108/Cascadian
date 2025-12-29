/**
 * Debug V10 Per-Position PnL Comparison
 *
 * Compares V10's calculated avg_price and realized_pnl per position
 * against Polymarket API ground truth data from pm_api_positions.
 *
 * This will identify exactly where the calculation diverges.
 */

import { clickhouse } from '../../lib/clickhouse/client';

// Test wallet with ground truth data
const TEST_WALLET = '0x9d36c904930a7d06c5403f9e16996e919f586486';

interface ApiPosition {
  condition_id: string;
  outcome: string;
  size: number;
  avg_price: number;
  initial_value: number;
  current_value: number;
  cash_pnl: number;
  realized_pnl: number;
  is_closed: number;
}

interface TradeEvent {
  event_id: string;
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
  trades: {type: string, qty: number, price: number, deltaPnL: number, newAvg: number, newAmt: number}[];
}

async function getApiPositions(wallet: string): Promise<ApiPosition[]> {
  const query = `
    SELECT
      condition_id,
      outcome,
      size,
      avg_price,
      initial_value,
      current_value,
      cash_pnl,
      realized_pnl,
      is_closed
    FROM pm_api_positions
    WHERE lower(wallet) = lower('${wallet}')
    ORDER BY condition_id, outcome
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map(r => ({
    condition_id: r.condition_id,
    outcome: r.outcome,
    size: Number(r.size),
    avg_price: Number(r.avg_price),
    initial_value: Number(r.initial_value),
    current_value: Number(r.current_value),
    cash_pnl: Number(r.cash_pnl),
    realized_pnl: Number(r.realized_pnl),
    is_closed: Number(r.is_closed),
  }));
}

async function getClobTradesForCondition(wallet: string, conditionId: string): Promise<TradeEvent[]> {
  // Strip 0x prefix from condition_id to match token map format
  const cleanConditionId = conditionId.replace(/^0x/, '').toLowerCase();

  const query = `
    SELECT
      fills.event_id,
      m.condition_id,
      m.outcome_index,
      fills.trade_time,
      fills.side,
      fills.qty_tokens,
      fills.price,
      fills.usdc_notional
    FROM (
      SELECT
        event_id,
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
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
    WHERE lower(m.condition_id) = lower('${cleanConditionId}')
    ORDER BY fills.trade_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map(r => ({
    event_id: r.event_id,
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    trade_time: r.trade_time,
    side: r.side as 'buy' | 'sell',
    qty_tokens: Number(r.qty_tokens),
    price: Number(r.price),
    usdc_notional: Number(r.usdc_notional),
  }));
}

async function getCtfEventsForCondition(wallet: string, conditionId: string): Promise<any[]> {
  // Strip 0x prefix from condition_id to match token map format
  const cleanConditionId = conditionId.replace(/^0x/, '').toLowerCase();

  const query = `
    SELECT
      e.event_type,
      e.event_timestamp,
      e.amount_or_payout,
      r.payout_numerators
    FROM pm_ctf_events e
    LEFT JOIN pm_condition_resolutions r ON lower(e.condition_id) = lower(r.condition_id)
    WHERE lower(e.user_address) = lower('${wallet}')
      AND lower(e.condition_id) = lower('${cleanConditionId}')
      AND e.is_deleted = 0
    ORDER BY e.event_timestamp ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as any[];
}

function calculatePositionPnL(trades: TradeEvent[], outcomeIndex: number): PositionState {
  const state: PositionState = {
    amount: 0,
    avgPrice: 0,
    totalBought: 0,
    realized_pnl: 0,
    trades: [],
  };

  // Filter to this outcome only
  const outcomeTrades = trades.filter(t => t.outcome_index === outcomeIndex);

  for (const trade of outcomeTrades) {
    if (trade.side === 'buy') {
      // BUY: avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
      if (trade.qty_tokens > 0) {
        const numerator = state.avgPrice * state.amount + trade.price * trade.qty_tokens;
        const denominator = state.amount + trade.qty_tokens;
        const newAvg = denominator > 0 ? numerator / denominator : 0;
        const newAmt = state.amount + trade.qty_tokens;

        state.trades.push({
          type: 'BUY',
          qty: trade.qty_tokens,
          price: trade.price,
          deltaPnL: 0,
          newAvg,
          newAmt,
        });

        state.avgPrice = newAvg;
        state.amount = newAmt;
        state.totalBought += trade.qty_tokens;
      }
    } else if (trade.side === 'sell') {
      // SELL: adjustedAmount = min(sellAmount, amount), deltaPnL = adjustedAmount * (price - avgPrice)
      const adjustedAmount = Math.min(trade.qty_tokens, state.amount);

      if (adjustedAmount > 0 && state.avgPrice > 0) {
        const deltaPnL = adjustedAmount * (trade.price - state.avgPrice);
        const newAmt = state.amount - adjustedAmount;

        state.trades.push({
          type: 'SELL',
          qty: trade.qty_tokens,
          price: trade.price,
          deltaPnL,
          newAvg: state.avgPrice,
          newAmt,
        });

        state.realized_pnl += deltaPnL;
        state.amount = newAmt;
      } else {
        state.trades.push({
          type: 'SELL (no position)',
          qty: trade.qty_tokens,
          price: trade.price,
          deltaPnL: 0,
          newAvg: state.avgPrice,
          newAmt: state.amount,
        });
      }
    }
  }

  return state;
}

async function debugPosition(wallet: string, apiPos: ApiPosition): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(`POSITION: ${apiPos.condition_id.substring(0, 20)}... outcome=${apiPos.outcome}`);
  console.log('='.repeat(80));

  console.log('\n--- API Ground Truth ---');
  console.log(`  Size: ${apiPos.size.toFixed(6)}`);
  console.log(`  Avg Price: $${apiPos.avg_price.toFixed(6)}`);
  console.log(`  Realized PnL: $${apiPos.realized_pnl.toFixed(2)}`);
  console.log(`  Cash PnL: $${apiPos.cash_pnl.toFixed(2)}`);
  console.log(`  Is Closed: ${apiPos.is_closed}`);

  // Get CLOB trades for this condition
  const trades = await getClobTradesForCondition(wallet, apiPos.condition_id);
  console.log(`\n--- Found ${trades.length} CLOB trades for this condition ---`);

  // Determine outcome index from outcome string
  const outcomeIndex = apiPos.outcome.toLowerCase() === 'yes' ? 0 : 1;
  console.log(`  Outcome: ${apiPos.outcome} -> index ${outcomeIndex}`);

  // Count trades per outcome
  const outcome0Trades = trades.filter(t => t.outcome_index === 0);
  const outcome1Trades = trades.filter(t => t.outcome_index === 1);
  console.log(`  Trades for outcome 0 (Yes): ${outcome0Trades.length}`);
  console.log(`  Trades for outcome 1 (No): ${outcome1Trades.length}`);

  // Calculate PnL for this outcome
  const calc = calculatePositionPnL(trades, outcomeIndex);

  console.log('\n--- V10 Calculation ---');
  console.log(`  Amount: ${calc.amount.toFixed(6)}`);
  console.log(`  Avg Price: $${calc.avgPrice.toFixed(6)}`);
  console.log(`  Realized PnL: $${calc.realized_pnl.toFixed(2)}`);
  console.log(`  Total Bought: ${calc.totalBought.toFixed(6)}`);

  console.log('\n--- Trade-by-Trade Breakdown ---');
  for (let i = 0; i < Math.min(calc.trades.length, 10); i++) {
    const t = calc.trades[i];
    console.log(`  ${i+1}. ${t.type}: ${t.qty.toFixed(4)} @ $${t.price.toFixed(4)} -> PnL: $${t.deltaPnL.toFixed(2)}, newAvg: $${t.newAvg.toFixed(4)}, newAmt: ${t.newAmt.toFixed(4)}`);
  }
  if (calc.trades.length > 10) {
    console.log(`  ... and ${calc.trades.length - 10} more trades`);
  }

  // Get CTF events
  const ctfEvents = await getCtfEventsForCondition(wallet, apiPos.condition_id);
  console.log(`\n--- CTF Events for this condition: ${ctfEvents.length} ---`);
  for (const e of ctfEvents.slice(0, 5)) {
    console.log(`  ${e.event_type}: ${(Number(e.amount_or_payout) / 1e6).toFixed(4)} USDC`);
  }

  // Comparison
  console.log('\n--- COMPARISON ---');
  const avgPriceDiff = calc.avgPrice - apiPos.avg_price;
  const pnlDiff = calc.realized_pnl - apiPos.realized_pnl;
  console.log(`  Avg Price Diff: $${avgPriceDiff.toFixed(6)} (V10 - API)`);
  console.log(`  Realized PnL Diff: $${pnlDiff.toFixed(2)} (V10 - API)`);

  if (Math.abs(pnlDiff) > 1) {
    console.log(`  ⚠️ SIGNIFICANT DISCREPANCY`);
  } else {
    console.log(`  ✓ Within tolerance`);
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('V10 PER-POSITION DEBUG');
  console.log(`Wallet: ${TEST_WALLET}`);
  console.log('='.repeat(80));

  // Get API positions
  const apiPositions = await getApiPositions(TEST_WALLET);
  console.log(`\nFound ${apiPositions.length} positions in pm_api_positions`);

  // Summary
  const totalApiPnL = apiPositions.reduce((sum, p) => sum + p.realized_pnl, 0);
  console.log(`Total API realized_pnl: $${totalApiPnL.toFixed(2)}`);

  // Debug each position
  let totalV10Pnl = 0;
  for (const pos of apiPositions) {
    await debugPosition(TEST_WALLET, pos);

    // Get trades and calculate
    const trades = await getClobTradesForCondition(TEST_WALLET, pos.condition_id);
    const outcomeIndex = pos.outcome.toLowerCase() === 'yes' ? 0 : 1;
    const calc = calculatePositionPnL(trades, outcomeIndex);
    totalV10Pnl += calc.realized_pnl;
  }

  console.log('\n' + '='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total API realized_pnl: $${totalApiPnL.toFixed(2)}`);
  console.log(`Total V10 realized_pnl: $${totalV10Pnl.toFixed(2)}`);
  console.log(`Difference: $${(totalV10Pnl - totalApiPnL).toFixed(2)}`);
}

main().catch(console.error);
