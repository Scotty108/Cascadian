/**
 * Test V17 cash-flow formula with ALL trades (no role filtering)
 * aggregated by (condition_id, outcome_index)
 *
 * The formula should naturally handle paired outcomes because:
 * - Buy YES: cash_flow -= $X, tokens += 1
 * - Sell NO: cash_flow += $Y, tokens -= 1
 *
 * At resolution:
 * - YES (wins): PnL = -$X + 1*$1 = $(1-X)
 * - NO (loses): PnL = +$Y + (-1)*$0 = $Y
 * - Total = $(1-X) + $Y
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = 1.16;

async function main() {
  console.log('Testing V17 formula with ALL trades (no role filtering)\n');

  // Get all trades aggregated by (condition_id, outcome_index)
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      sum(if(d.side = 'sell', d.usdc, -d.usdc)) AS cash_flow,
      sum(if(d.side = 'buy', d.tokens, -d.tokens)) AS final_tokens,
      count() AS trade_count
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    WHERE m.condition_id IS NOT NULL
    GROUP BY m.condition_id, m.outcome_index
    ORDER BY m.condition_id, m.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const positions = (await result.json()) as any[];

  console.log(`Found ${positions.length} positions`);

  // Get resolutions
  const conditionIds = [...new Set(positions.map((p: any) => p.condition_id))];
  const condList = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');

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

  // Calculate PnL
  console.log('\nPosition | Cash Flow | Tokens | Payout | PnL');
  console.log('-'.repeat(60));

  let totalPnl = 0;
  for (const pos of positions) {
    const payouts = resolutions.get(pos.condition_id.toLowerCase());
    if (!payouts) continue;

    const denom = payouts.reduce((a: number, b: number) => a + b, 0);
    const payout = denom > 0 ? payouts[pos.outcome_index] / denom : 0.5;

    const pnl = pos.cash_flow + (pos.final_tokens * payout);
    totalPnl += pnl;

    console.log(
      `...${pos.condition_id.slice(-12)}[${pos.outcome_index}] | ${pos.cash_flow.toFixed(2).padStart(9)} | ${pos.final_tokens.toFixed(2).padStart(6)} | ${payout.toFixed(2).padStart(6)} | ${pnl.toFixed(2).padStart(7)}`
    );
  }

  console.log('-'.repeat(60));
  console.log(`Total PnL (ALL trades): $${totalPnl.toFixed(2)}`);
  console.log(`UI Target: $${UI_PNL}`);
  console.log(`Error: ${((totalPnl - UI_PNL) / UI_PNL * 100).toFixed(1)}%`);

  // Now show what V17 formula gives at CONDITION level (sum both outcomes)
  console.log('\n\nCondition-level aggregation:');

  const byCondition = new Map<string, { cash_flow: number; tokens0: number; tokens1: number }>();
  for (const pos of positions) {
    const condId = pos.condition_id.toLowerCase();
    const entry = byCondition.get(condId) || { cash_flow: 0, tokens0: 0, tokens1: 0 };
    entry.cash_flow += pos.cash_flow;
    if (pos.outcome_index === 0) entry.tokens0 += pos.final_tokens;
    else entry.tokens1 += pos.final_tokens;
    byCondition.set(condId, entry);
  }

  let conditionLevelPnl = 0;
  for (const [condId, data] of byCondition) {
    const payouts = resolutions.get(condId);
    if (!payouts) continue;

    const denom = payouts.reduce((a: number, b: number) => a + b, 0);
    const payout0 = denom > 0 ? payouts[0] / denom : 0.5;
    const payout1 = denom > 0 ? payouts[1] / denom : 0.5;

    const pnl = data.cash_flow + (data.tokens0 * payout0) + (data.tokens1 * payout1);
    conditionLevelPnl += pnl;

    console.log(`...${condId.slice(-12)}: cash=${data.cash_flow.toFixed(2)}, t0=${data.tokens0.toFixed(2)}, t1=${data.tokens1.toFixed(2)}, p0=${payout0}, p1=${payout1} -> PnL=${pnl.toFixed(2)}`);
  }

  console.log(`\nCondition-level PnL: $${conditionLevelPnl.toFixed(2)}`);
  console.log(`(Should be same as outcome-level: $${totalPnl.toFixed(2)})`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
