/**
 * Detailed analysis of Theo4 positions WITH PROPER POSITION NETTING
 *
 * Key insight: In binary markets, YES + NO = $1
 * If you're long YES and short NO, the positions should be netted
 * before calculating PnL to avoid double-counting.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const theo4 = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';

async function analyzeNetted() {
  console.log('=== THEO4 POSITION ANALYSIS WITH NETTING ===\n');

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

  let totalNetPnl = 0;
  let totalUnnettedPnl = 0;

  console.log('Position Analysis by Condition:\n');

  conditions.forEach((c: any) => {
    const payouts = resMap.get(c.condition_id.toLowerCase());
    const outcomes = c.outcomes as [number, number, number][];

    if (!payouts) {
      console.log(`${c.condition_id.substring(0, 20)}... UNRESOLVED - skipping`);
      return;
    }

    // Find winning outcome index
    const winnerIndex = payouts.findIndex(p => p >= 0.99);
    if (winnerIndex === -1) {
      console.log(`${c.condition_id.substring(0, 20)}... No clear winner - skipping`);
      return;
    }

    // Calculate UNNETTED PnL (wrong way - double counting)
    let unnettedPnl = 0;
    outcomes.forEach(([outcomeIndex, shares, cost]) => {
      const resPrice = payouts[outcomeIndex] || 0;
      unnettedPnl += shares * resPrice - cost;
    });
    totalUnnettedPnl += unnettedPnl;

    // Calculate NETTED PnL (correct way)
    // For binary: net to the winning side
    let netShares = 0;
    let netCost = 0;

    outcomes.forEach(([outcomeIndex, shares, cost]) => {
      if (outcomeIndex === winnerIndex) {
        // This is the winning outcome - add position as-is
        netShares += shares;
        netCost += cost;
      } else {
        // This is the losing outcome - SHORT position converts to LONG on winner
        // If you're short 100 NO, you're effectively long 100 YES
        // The cost of shorting NO = -$X becomes +$X cost for the equivalent YES
        netShares += -shares; // Short NO = Long YES
        netCost += -cost;     // Received $X when shorting = Spent $X for equivalent long
      }
    });

    const nettedPnl = netShares * 1 - netCost; // Winner resolves at $1
    totalNetPnl += nettedPnl;

    console.log(`${c.condition_id.substring(0, 20)}...`);
    console.log(`  Winner: Outcome ${winnerIndex}`);
    console.log(`  Raw positions:`);
    outcomes.forEach(([idx, shares, cost]) => {
      console.log(`    Outcome ${idx}: ${Number(shares).toLocaleString()} shares, $${Number(cost).toLocaleString()} cost`);
    });
    console.log(`  Netted: ${Number(netShares).toLocaleString()} shares @ $${Number(netCost).toLocaleString()}`);
    console.log(`  Unnetted PnL: $${unnettedPnl.toLocaleString()}`);
    console.log(`  NETTED PnL:   $${nettedPnl.toLocaleString()}`);
    console.log('');
  });

  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Unnetted Total (wrong): $${totalUnnettedPnl.toLocaleString()}`);
  console.log(`NETTED Total (correct): $${totalNetPnl.toLocaleString()}`);
  console.log(`UI Expected: $22,053,934`);
  console.log(`Gap from Netted: $${(totalNetPnl - 22053934).toLocaleString()}`);
}

analyzeNetted().catch(console.error);
