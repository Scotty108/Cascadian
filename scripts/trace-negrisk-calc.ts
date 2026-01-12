/**
 * Trace calculation for the 2x error wallet
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x80cd0939e0f5ca565a7c1ae40caca1ea2a932b4e';

async function main() {
  console.log('=== Tracing PnL Calculation ===\n');
  console.log(`Wallet: ${WALLET}`);
  console.log('API PnL: -$0.39\n');

  // Get deduped trades per condition
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1e6 as tokens,
        any(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = '${WALLET}'
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      t.side,
      m.outcome_index,
      sum(t.tokens) as total_tokens,
      sum(t.usdc) as total_usdc
    FROM deduped t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index, t.side
    ORDER BY m.condition_id, m.outcome_index, t.side
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  // Group by condition
  const conditions = new Map<string, {
    outcome_0_buy_usdc: number;
    outcome_0_sell_usdc: number;
    outcome_1_buy_usdc: number;
    outcome_1_sell_usdc: number;
    outcome_0_buy_tokens: number;
    outcome_0_sell_tokens: number;
    outcome_1_buy_tokens: number;
    outcome_1_sell_tokens: number;
  }>();

  for (const r of rows) {
    if (!conditions.has(r.condition_id)) {
      conditions.set(r.condition_id, {
        outcome_0_buy_usdc: 0, outcome_0_sell_usdc: 0,
        outcome_1_buy_usdc: 0, outcome_1_sell_usdc: 0,
        outcome_0_buy_tokens: 0, outcome_0_sell_tokens: 0,
        outcome_1_buy_tokens: 0, outcome_1_sell_tokens: 0,
      });
    }
    const c = conditions.get(r.condition_id)!;
    if (r.outcome_index === 0) {
      if (r.side === 'buy') {
        c.outcome_0_buy_usdc = Number(r.total_usdc);
        c.outcome_0_buy_tokens = Number(r.total_tokens);
      } else {
        c.outcome_0_sell_usdc = Number(r.total_usdc);
        c.outcome_0_sell_tokens = Number(r.total_tokens);
      }
    } else {
      if (r.side === 'buy') {
        c.outcome_1_buy_usdc = Number(r.total_usdc);
        c.outcome_1_buy_tokens = Number(r.total_tokens);
      } else {
        c.outcome_1_sell_usdc = Number(r.total_usdc);
        c.outcome_1_sell_tokens = Number(r.total_tokens);
      }
    }
  }

  // Get resolutions
  const resQuery = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE is_deleted = 0
      AND condition_id IN (${Array.from(conditions.keys()).map(id => `'${id}'`).join(',')})
  `;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resolutions = new Map<string, [number, number]>();
  for (const r of await resResult.json() as any[]) {
    try {
      const payouts = JSON.parse(r.payout_numerators);
      resolutions.set(r.condition_id, [Number(payouts[0]) || 0, Number(payouts[1]) || 0]);
    } catch {}
  }

  console.log(`Found ${conditions.size} conditions, ${resolutions.size} resolved\n`);

  // Calculate PnL two ways
  let methodA = 0; // Current: separate outcome calculations
  let methodB = 0; // New: combined condition calculation

  console.log('=== Per-Condition Analysis ===\n');

  for (const [condId, c] of conditions) {
    const res = resolutions.get(condId) || [0, 0];
    const isResolved = resolutions.has(condId);

    // Net token positions
    const net0 = c.outcome_0_buy_tokens - c.outcome_0_sell_tokens;
    const net1 = c.outcome_1_buy_tokens - c.outcome_1_sell_tokens;

    // Method A: Separate (current engine logic)
    const pnl0 = (c.outcome_0_sell_usdc - c.outcome_0_buy_usdc) + (net0 > 0 && isResolved ? net0 * res[0] : 0);
    const pnl1 = (c.outcome_1_sell_usdc - c.outcome_1_buy_usdc) + (net1 > 0 && isResolved ? net1 * res[1] : 0);
    const methodA_condition = pnl0 + pnl1;
    methodA += methodA_condition;

    // Method B: Combined (total cash flow + net positions)
    const totalSells = c.outcome_0_sell_usdc + c.outcome_1_sell_usdc;
    const totalBuys = c.outcome_0_buy_usdc + c.outcome_1_buy_usdc;
    const posValue = isResolved ? (net0 * res[0] + net1 * res[1]) : 0;
    const methodB_condition = (totalSells - totalBuys) + posValue;
    methodB += methodB_condition;

    // Show first few conditions
    if (conditions.size <= 3 || Array.from(conditions.keys()).indexOf(condId) < 3) {
      console.log(`Condition: ${condId.slice(0, 12)}...`);
      console.log(`  O0: buy $${c.outcome_0_buy_usdc.toFixed(4)}, sell $${c.outcome_0_sell_usdc.toFixed(4)}, net ${net0.toFixed(4)} tokens`);
      console.log(`  O1: buy $${c.outcome_1_buy_usdc.toFixed(4)}, sell $${c.outcome_1_sell_usdc.toFixed(4)}, net ${net1.toFixed(4)} tokens`);
      console.log(`  Resolution: [${res[0]}, ${res[1]}]`);
      console.log(`  Method A (separate): O0=$${pnl0.toFixed(4)} + O1=$${pnl1.toFixed(4)} = $${methodA_condition.toFixed(4)}`);
      console.log(`  Method B (combined): sells-buys=$${(totalSells - totalBuys).toFixed(4)} + pos=$${posValue.toFixed(4)} = $${methodB_condition.toFixed(4)}`);
      console.log();
    }
  }

  console.log('=== Summary ===\n');
  console.log(`Total conditions: ${conditions.size}`);
  console.log(`Method A (separate outcomes): $${methodA.toFixed(4)}`);
  console.log(`Method B (combined condition): $${methodB.toFixed(4)}`);
  console.log(`API baseline: $-0.39`);
  console.log(`\nDifference A vs API: $${(methodA - (-0.39)).toFixed(4)}`);
  console.log(`Difference B vs API: $${(methodB - (-0.39)).toFixed(4)}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
