/**
 * Debug open positions and their resolution status
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const client = getClickHouseClient();
const wallet = '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd';

async function main() {
  console.log('=== CHECKING OPEN POSITIONS RESOLUTION ===');

  // Get open positions (simplified - just get tokens with net positive amount)
  const openTokens = await client.query({
    query: `
      SELECT
        token_id,
        sumIf(token_amount, side = 'buy') - sumIf(token_amount, side = 'sell') as net_tokens
      FROM (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000.0 as token_amount
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      )
      GROUP BY token_id
      HAVING net_tokens > 1000
      ORDER BY net_tokens DESC
    `,
    format: 'JSONEachRow',
  });

  const tokens = await openTokens.json() as Array<{token_id: string; net_tokens: number}>;
  console.log('Tokens with significant open positions:', tokens.length);

  // Get condition_ids for these tokens
  const tokenIds = tokens.map(t => t.token_id);
  const conditionQuery = await client.query({
    query: `
      SELECT
        token_id_dec,
        condition_id,
        outcome_index,
        question
      FROM pm_token_to_condition_map_current
      WHERE token_id_dec IN (${tokenIds.map(t => `'${t}'`).join(',')})
    `,
    format: 'JSONEachRow',
  });

  type ConditionInfo = {
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
    question: string;
  };

  const conditionMap = new Map<string, ConditionInfo>();
  for (const row of await conditionQuery.json() as ConditionInfo[]) {
    conditionMap.set(row.token_id_dec, row);
  }

  // Check resolutions
  const conditionIds = [...new Set([...conditionMap.values()].map(c => c.condition_id))];
  console.log('\nUnique conditions:', conditionIds.length);

  const resolutions = await client.query({
    query: `
      SELECT
        condition_id,
        payout_numerators,
        payout_denominator,
        resolved_at
      FROM pm_condition_resolutions
      WHERE condition_id IN (${conditionIds.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow',
  });

  type Resolution = {
    condition_id: string;
    payout_numerators: string;
    payout_denominator: string;
    resolved_at: string;
  };

  const resolutionMap = new Map<string, Resolution>();
  for (const row of await resolutions.json() as Resolution[]) {
    resolutionMap.set(row.condition_id, row);
  }

  console.log('Resolved conditions:', resolutionMap.size);
  console.log('Unresolved conditions:', conditionIds.length - resolutionMap.size);

  // Calculate value based on resolutions
  let totalCostBasis = 0;
  let totalCurrentValue = 0;

  for (const token of tokens) {
    const cond = conditionMap.get(token.token_id);
    if (!cond) continue;

    const res = resolutionMap.get(cond.condition_id);

    // Simplified: avg price ~0.5 for these positions
    const avgPrice = 0.5;
    const costBasis = token.net_tokens * avgPrice;
    totalCostBasis += costBasis;

    let currentValue = 0;
    let status = 'OPEN';
    let payoffStr = '';

    if (res) {
      // Parse payout
      const payouts = JSON.parse(res.payout_numerators);
      const denom = parseInt(res.payout_denominator);
      const outcomePayoff = payouts[cond.outcome_index] / denom;
      currentValue = token.net_tokens * outcomePayoff;
      status = outcomePayoff > 0 ? 'WON' : 'LOST';
      payoffStr = `${payouts[cond.outcome_index]}/${res.payout_denominator}`;
    } else {
      // Unresolved - assume current price equals avg price (conservative)
      currentValue = costBasis;
    }
    totalCurrentValue += currentValue;

    console.log(`\n${(cond.question || 'Unknown').substring(0, 50)}`);
    console.log(`  Tokens: ${token.net_tokens.toLocaleString()}, Outcome idx: ${cond.outcome_index}`);
    console.log(`  Cost: $${costBasis.toLocaleString()}, Value: $${currentValue.toLocaleString()}`);
    console.log(`  Status: ${status}${payoffStr ? ` (payoff: ${payoffStr})` : ''}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total cost basis:', '$' + totalCostBasis.toLocaleString());
  console.log('Total current value:', '$' + totalCurrentValue.toLocaleString());
  console.log('Unrealized P&L:', '$' + (totalCurrentValue - totalCostBasis).toLocaleString());
  console.log('\nExpected Total PnL = Realized + Unrealized');
  console.log('  = $2,743,062 + $' + (totalCurrentValue - totalCostBasis).toLocaleString());
  console.log('  = $' + (2743062 + (totalCurrentValue - totalCostBasis)).toLocaleString());
  console.log('\nUI PnL:', '$1,409,525');
}

main().catch(console.error);
