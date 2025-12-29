/**
 * Detailed analysis of Theo4 positions by condition
 * Goal: Understand the $11M gap between calculated ($33.5M) and UI ($22M) PnL
 */

import { clickhouse } from '../../lib/clickhouse/client';

const theo4 = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';

async function analyzeByCondition() {
  console.log('=== THEO4 DETAILED POSITION ANALYSIS ===\n');

  // Get positions with condition mapping
  const result = await clickhouse.query({
    query: `
      WITH trades AS (
        SELECT
          token_id,
          sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_shares,
          sum(if(side = 'buy', usdc_amount, -usdc_amount)) / 1e6 as net_cost
        FROM (
          SELECT event_id, any(token_id) as token_id,
                 any(side) as side, any(token_amount) as token_amount, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${theo4}') AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      ),
      mapped AS (
        SELECT
          t.token_id,
          t.net_shares,
          t.net_cost,
          m.condition_id,
          m.outcome_index
        FROM trades t
        INNER JOIN pm_token_to_condition_map_v3 m ON t.token_id = toString(m.token_id_dec)
        WHERE abs(t.net_shares) > 1
      )
      SELECT
        condition_id,
        groupArray(tuple(outcome_index, net_shares, net_cost)) as outcomes
      FROM mapped
      GROUP BY condition_id
      HAVING count() > 0
    `,
    format: 'JSONEachRow'
  });
  const conditions = await result.json() as any[];

  // Get resolutions
  const conditionIds = conditions.map((c: any) => "'" + c.condition_id + "'").join(',');
  const resResult = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators
      FROM pm_condition_resolutions
      WHERE lower(condition_id) IN (${conditionIds.toLowerCase()})
    `,
    format: 'JSONEachRow'
  });
  const resolutions = await resResult.json() as any[];
  const resMap = new Map<string, number[]>();
  resolutions.forEach((r: any) => {
    resMap.set(r.condition_id.toLowerCase(), JSON.parse(r.payout_numerators || '[]'));
  });

  let totalGain = 0;
  let totalLoss = 0;
  let unresolvedCost = 0;

  console.log('Conditions with positions:');
  conditions.forEach((c: any) => {
    const payouts = resMap.get(c.condition_id.toLowerCase());
    const outcomes = c.outcomes as [number, number, number][];

    let conditionPnl = 0;
    let desc = '';
    let isResolved = payouts !== undefined;

    outcomes.forEach(([outcomeIndex, shares, cost]) => {
      const resPrice = payouts ? (payouts[outcomeIndex] || 0) : null;
      let pnl = 0;

      if (resPrice !== null) {
        pnl = shares * resPrice - cost;
      } else {
        unresolvedCost += cost;
      }

      conditionPnl += pnl;
      const status = resPrice !== null ? `res=${resPrice}` : 'UNRESOLVED';
      desc += `  Outcome ${outcomeIndex}: ${Number(shares).toLocaleString()} shares, cost $${Number(cost).toLocaleString()}, ${status}, pnl=$${pnl.toLocaleString()}\n`;
    });

    console.log('\n' + c.condition_id.substring(0, 20) + '...');
    console.log(desc);
    console.log(`  -> Condition PnL: $${conditionPnl.toLocaleString()} ${isResolved ? '' : '(UNRESOLVED)'}`);

    if (conditionPnl > 0) totalGain += conditionPnl;
    else totalLoss += conditionPnl;
  });

  console.log('\n=== SUMMARY ===');
  console.log(`Total Gain: $${totalGain.toLocaleString()}`);
  console.log(`Total Loss: $${Math.abs(totalLoss).toLocaleString()}`);
  console.log(`Net PnL: $${(totalGain + totalLoss).toLocaleString()}`);
  console.log(`Unresolved Cost: $${unresolvedCost.toLocaleString()}`);
  console.log(`UI Expected: $22,053,934`);
  console.log(`Gap: $${((totalGain + totalLoss) - 22053934).toLocaleString()}`);
}

analyzeByCondition().catch(console.error);
