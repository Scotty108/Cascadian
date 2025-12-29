/**
 * Verify Theo NegRisk PnL formula
 *
 * Tests: V1 (shares * res) + redemption = UI benchmark
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const wallet = '0x9d36c904930a7d06c5403f9e16996e919f586486';

  // Get positions
  const positions = await clickhouse.query({
    query: `
      SELECT
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        SUM(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END) / 1e6 as cash_flow,
        SUM(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1e6 as shares
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount, any(token_amount) as token_amount, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      ) t
      INNER JOIN pm_token_to_condition_map_v4 m ON toString(t.token_id) = toString(m.token_id_dec)
      GROUP BY condition_id, outcome_index
    `,
    format: 'JSONEachRow'
  });
  const posRows = await positions.json() as any[];

  // Get redemptions
  const redemptions = await clickhouse.query({
    query: `
      SELECT cond, SUM(toFloat64(red))/1e6 as redemption
      FROM (SELECT lower(condition_id) as cond, amount_or_payout as red FROM pm_ctf_events WHERE event_type = 'PayoutRedemption' AND lower(user_address) = lower('${wallet}'))
      GROUP BY cond
    `,
    format: 'JSONEachRow'
  });
  const redRows = await redemptions.json() as any[];
  const redMap = new Map(redRows.map((r: any) => [r.cond, Number(r.redemption)]));

  // Get resolutions
  const resolutions = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        CASE WHEN payout_numerators LIKE '[1,%' THEN 1.0 ELSE 0.0 END as res0,
        CASE WHEN payout_numerators LIKE '[0,%' THEN 1.0 ELSE 0.0 END as res1
      FROM pm_condition_resolutions WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const resRows = await resolutions.json() as any[];
  const resMap = new Map(resRows.map((r: any) => [r.condition_id, { res0: Number(r.res0), res1: Number(r.res1) }]));

  console.log('=== POSITIONS WITH REDEMPTIONS ===');
  for (const p of posRows) {
    const red = redMap.get(p.condition_id) || 0;
    if (red === 0) continue;

    const res = resMap.get(p.condition_id) || { res0: 0, res1: 0 };
    const resPrice = p.outcome_index === 0 ? res.res0 : res.res1;
    const shares = Number(p.shares);
    const payout = shares * resPrice;

    console.log(`${p.condition_id.slice(0, 12)}... | idx ${p.outcome_index} | shares: ${shares.toFixed(2).padStart(10)} | res: ${resPrice} | payout: $${payout.toFixed(2).padStart(10)} | redemption: $${red.toFixed(2)}`);
  }

  // Calculate total
  let totalCash = 0;
  let totalSharePayout = 0;
  let totalRedemption = 0;
  const conditionRedemptionUsed = new Set<string>();

  for (const p of posRows) {
    totalCash += Number(p.cash_flow);
    const res = resMap.get(p.condition_id) || { res0: 0, res1: 0 };
    const resPrice = p.outcome_index === 0 ? res.res0 : res.res1;
    totalSharePayout += Number(p.shares) * resPrice;

    // Only add redemption once per condition
    if (!conditionRedemptionUsed.has(p.condition_id)) {
      totalRedemption += redMap.get(p.condition_id) || 0;
      conditionRedemptionUsed.add(p.condition_id);
    }
  }

  console.log('');
  console.log('=== TOTALS ===');
  console.log(`Total cash: $${totalCash.toFixed(2)}`);
  console.log(`Total share payout (shares * res): $${totalSharePayout.toFixed(2)}`);
  console.log(`Total redemption: $${totalRedemption.toFixed(2)}`);
  console.log('');
  console.log(`V1 (cash + shares*res): $${(totalCash + totalSharePayout).toFixed(2)}`);
  console.log(`V1 + redemption: $${(totalCash + totalSharePayout + totalRedemption).toFixed(2)}`);
  console.log(`UI benchmark: -$6,138.90`);
  console.log(`Error: ${Math.abs((totalCash + totalSharePayout + totalRedemption - (-6138.9)) / 6138.9 * 100).toFixed(1)}%`);
}

main().catch(console.error);
