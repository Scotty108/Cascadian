/**
 * Debug W2 Activity PnL calculation step by step
 */
import { clickhouse } from '../../lib/clickhouse/client';

const W2 = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';

interface ActivityEvent {
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_type: 'CLOB_BUY' | 'CLOB_SELL' | 'REDEMPTION';
  qty_tokens: number;
  usdc_notional: number;
  price: number;
}

interface OutcomeState {
  position_qty: number;
  position_cost: number;
  realized_pnl: number;
}

async function getClobFills(): Promise<ActivityEvent[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time as event_time,
      fills.side,
      fills.qty_tokens,
      fills.usdc_notional,
      fills.price
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
      WHERE lower(trader_wallet) = lower('${W2}') AND is_deleted = 0
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
    ORDER BY fills.trade_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    event_time: r.event_time,
    event_type: r.side === 'buy' ? 'CLOB_BUY' : 'CLOB_SELL' as const,
    qty_tokens: Number(r.qty_tokens),
    usdc_notional: Number(r.usdc_notional),
    price: Number(r.price),
  }));
}

async function getRedemptions(): Promise<ActivityEvent[]> {
  const query = `
    SELECT
      e.condition_id,
      e.amount_or_payout,
      e.event_timestamp,
      r.payout_numerators
    FROM pm_ctf_events e
    LEFT JOIN pm_condition_resolutions r ON lower(e.condition_id) = lower(r.condition_id)
    WHERE lower(e.user_address) = lower('${W2}')
      AND e.event_type = 'PayoutRedemption'
      AND e.is_deleted = 0
    ORDER BY e.event_timestamp ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const events: ActivityEvent[] = [];

  for (const r of rows) {
    const payout_usdc = Number(r.amount_or_payout) / 1e6;
    const payout_numerators = r.payout_numerators ? JSON.parse(r.payout_numerators) : null;

    if (!payout_numerators || payout_usdc <= 0) continue;

    for (let i = 0; i < payout_numerators.length; i++) {
      const payout_price = payout_numerators[i];
      if (payout_price > 0) {
        const tokens_burned = payout_usdc / payout_price;
        events.push({
          condition_id: r.condition_id,
          outcome_index: i,
          event_time: r.event_timestamp,
          event_type: 'REDEMPTION',
          qty_tokens: tokens_burned,
          usdc_notional: payout_usdc,
          price: payout_price,
        });
      }
    }
  }

  return events;
}

async function main() {
  const clobFills = await getClobFills();
  const redemptions = await getRedemptions();
  const allEvents = [...clobFills, ...redemptions];
  allEvents.sort((a, b) => a.event_time.localeCompare(b.event_time));

  console.log(`W2 has ${clobFills.length} CLOB events and ${redemptions.length} redemptions`);
  console.log('');

  // Process and track by outcome
  const outcomeStates = new Map<string, OutcomeState>();
  const getKey = (e: ActivityEvent): string => `${e.condition_id}_${e.outcome_index}`;

  let totalRealized = 0;

  // Focus on first condition to debug
  const firstCondition = clobFills[0]?.condition_id;
  console.log(`Debugging first condition: ${firstCondition}`);
  console.log('');

  for (const event of allEvents) {
    const key = getKey(event);

    if (!outcomeStates.has(key)) {
      outcomeStates.set(key, {
        position_qty: 0,
        position_cost: 0,
        realized_pnl: 0,
      });
    }

    const state = outcomeStates.get(key)!;
    const beforeQty = state.position_qty;
    const beforeCost = state.position_cost;

    if (event.event_type === 'CLOB_BUY') {
      state.position_cost += event.usdc_notional;
      state.position_qty += event.qty_tokens;
    } else if (event.event_type === 'CLOB_SELL' || event.event_type === 'REDEMPTION') {
      if (state.position_qty > 0) {
        const avg_cost = state.position_cost / state.position_qty;
        const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);
        const pnl_now = (event.price - avg_cost) * qty_to_sell;
        state.realized_pnl += pnl_now;
        state.position_cost -= avg_cost * qty_to_sell;
        state.position_qty -= qty_to_sell;

        if (event.condition_id === firstCondition) {
          console.log(`${event.event_type} ${event.qty_tokens.toFixed(2)} tokens @ $${event.price.toFixed(4)}`);
          console.log(`  Before: qty=${beforeQty.toFixed(2)}, cost=$${beforeCost.toFixed(2)}, avg=${(beforeQty > 0 ? beforeCost/beforeQty : 0).toFixed(4)}`);
          console.log(`  PnL this event: $${pnl_now.toFixed(2)}`);
          console.log(`  After: qty=${state.position_qty.toFixed(2)}, cost=$${state.position_cost.toFixed(2)}, realized_pnl=$${state.realized_pnl.toFixed(2)}`);
          console.log('');
        }
      }
    } else if (event.event_type === 'CLOB_BUY' && event.condition_id === firstCondition) {
      console.log(`BUY ${event.qty_tokens.toFixed(2)} tokens @ $${event.price.toFixed(4)} = $${event.usdc_notional.toFixed(2)}`);
      console.log(`  Before: qty=${beforeQty.toFixed(2)}, cost=$${beforeCost.toFixed(2)}`);
      console.log(`  After: qty=${state.position_qty.toFixed(2)}, cost=$${state.position_cost.toFixed(2)}`);
      console.log('');
    }
  }

  // Aggregate
  let pnl_total = 0;
  let gain_total = 0;
  let loss_total = 0;

  for (const [key, state] of outcomeStates.entries()) {
    pnl_total += state.realized_pnl;
    if (state.realized_pnl > 0) gain_total += state.realized_pnl;
    else loss_total += state.realized_pnl;
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('FINAL TOTALS');
  console.log('='.repeat(60));
  console.log(`Total realized PnL: $${pnl_total.toFixed(2)}`);
  console.log(`Gains: $${gain_total.toFixed(2)}`);
  console.log(`Losses: $${loss_total.toFixed(2)}`);
  console.log('');
  console.log('Expected (cash flow): ~$4,396');
  console.log('UI shows: $4,404.92');
  console.log('V9 shows: $4,417.84');

  // Check for any remaining positions
  console.log('');
  console.log('Remaining positions:');
  let hasRemaining = false;
  for (const [key, state] of outcomeStates.entries()) {
    if (Math.abs(state.position_qty) > 0.01) {
      hasRemaining = true;
      console.log(`  ${key}: ${state.position_qty.toFixed(2)} tokens, cost=$${state.position_cost.toFixed(2)}`);
    }
  }
  if (!hasRemaining) console.log('  None');
}
main().catch(console.error);
