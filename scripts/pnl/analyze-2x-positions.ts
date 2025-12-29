#!/usr/bin/env npx tsx
/**
 * Analyze positions for 2x bug wallet
 *
 * Check if the 2x bug is caused by counting both YES and NO positions
 * for paired-outcome trades.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const WALLET = '0x586744c62f4b87872d4e616e1273b88b5eb324b3';

async function main() {
  // Get all positions for this wallet grouped by condition_id
  const query = `
    SELECT
      condition_id,
      outcome_index,
      sum(if(side = 'buy', tokens, 0)) as buy_tokens,
      sum(if(side = 'sell', tokens, 0)) as sell_tokens,
      sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_tokens,
      sum(if(side = 'buy', usdc, 0)) as buy_usdc,
      sum(if(side = 'sell', usdc, 0)) as sell_usdc,
      sum(if(side = 'sell', usdc, 0)) - sum(if(side = 'buy', usdc, 0)) as cash_flow,
      count() as trade_count
    FROM (
      SELECT
        any(lower(f.side)) as side,
        any(f.token_amount) / 1e6 as tokens,
        any(f.usdc_amount) / 1e6 as usdc,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_dedup_v2_tbl f
      INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      WHERE lower(f.trader_wallet) = lower('${WALLET}')
      GROUP BY f.event_id
    )
    GROUP BY condition_id, outcome_index
    ORDER BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('POSITIONS BY (condition_id, outcome_index):');
  console.log('-'.repeat(100));

  // Group by condition_id to see if both outcomes present
  const byCondition = new Map<string, any[]>();
  for (const r of rows) {
    const cid = r.condition_id;
    if (!byCondition.has(cid)) {
      byCondition.set(cid, []);
    }
    byCondition.get(cid)!.push(r);
  }

  let totalCashFlow = 0;
  let totalNetTokens = 0;

  for (const [cid, positions] of byCondition) {
    const hasBoth = positions.length > 1;
    console.log('\n' + cid.slice(0, 16) + '... ' + (hasBoth ? '[BOTH OUTCOMES]' : '[SINGLE]'));
    for (const p of positions) {
      console.log(
        '  Outcome ' +
          p.outcome_index +
          ': buy=' +
          Number(p.buy_tokens).toFixed(2) +
          ', sell=' +
          Number(p.sell_tokens).toFixed(2) +
          ', net=' +
          Number(p.net_tokens).toFixed(2) +
          ', cashFlow=' +
          Number(p.cash_flow).toFixed(2)
      );
      totalCashFlow += Number(p.cash_flow);
      totalNetTokens += Number(p.net_tokens);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('TOTAL CASH FLOW: $' + totalCashFlow.toFixed(2));
  console.log('TOTAL NET TOKENS: ' + totalNetTokens.toFixed(2));
  console.log('Markets with BOTH outcomes: ' + [...byCondition.values()].filter((p) => p.length > 1).length);
  console.log('Markets with SINGLE outcome: ' + [...byCondition.values()].filter((p) => p.length === 1).length);

  // Now get resolution prices for these conditions
  console.log('\n\nRESOLUTION PRICES:');
  console.log('-'.repeat(100));

  const conditionIds = [...byCondition.keys()];
  const resQuery = `
    SELECT condition_id, payout_numerators, resolved_at
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN ('${conditionIds.join("','").toLowerCase()}')
  `;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resolutions = (await resResult.json()) as any[];

  for (const r of resolutions) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    console.log(r.condition_id.slice(0, 16) + '... payouts=' + JSON.stringify(payouts));
  }

  // Calculate expected PnL using V17 formula
  console.log('\n\nEXPECTED PNL CALCULATION (V17 formula):');
  console.log('-'.repeat(100));

  const resMap = new Map<string, number[]>();
  for (const r of resolutions) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resMap.set(r.condition_id.toLowerCase(), payouts);
  }

  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;

  for (const [cid, positions] of byCondition) {
    const payouts = resMap.get(cid.toLowerCase()) || [];
    for (const p of positions) {
      const cashFlow = Number(p.cash_flow);
      const netTokens = Number(p.net_tokens);
      const resPrice = payouts[p.outcome_index];

      if (resPrice !== undefined) {
        const realized = cashFlow + netTokens * resPrice;
        totalRealizedPnl += realized;
        console.log(
          '  RESOLVED: cid=' +
            cid.slice(0, 8) +
            ' out=' +
            p.outcome_index +
            ' cf=$' +
            cashFlow.toFixed(2) +
            ' net=' +
            netTokens.toFixed(2) +
            ' price=' +
            resPrice +
            ' => realized=$' +
            realized.toFixed(2)
        );
      } else {
        const unrealized = cashFlow + netTokens * 0.5;
        totalUnrealizedPnl += unrealized;
        console.log(
          '  UNRESOLVED: cid=' +
            cid.slice(0, 8) +
            ' out=' +
            p.outcome_index +
            ' cf=$' +
            cashFlow.toFixed(2) +
            ' net=' +
            netTokens.toFixed(2) +
            ' @0.5 => unrealized=$' +
            unrealized.toFixed(2)
        );
      }
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('V17 EXPECTED REALIZED PNL: $' + totalRealizedPnl.toFixed(2));
  console.log('V17 EXPECTED UNREALIZED PNL: $' + totalUnrealizedPnl.toFixed(2));
  console.log('V17 EXPECTED TOTAL PNL: $' + (totalRealizedPnl + totalUnrealizedPnl).toFixed(2));
  console.log('\nUI REPORTED: -$341.38');
  console.log('V17 REPORTED: -$683.06');
  console.log('RATIO: ' + (totalRealizedPnl / -341.38).toFixed(2) + 'x');

  // NEW: Check if both-outcome markets contribute to the doubling
  console.log('\n\nBOTH-OUTCOME ANALYSIS:');
  console.log('-'.repeat(100));

  let bothOutcomePnl = 0;
  let singleOutcomePnl = 0;

  for (const [cid, positions] of byCondition) {
    const payouts = resMap.get(cid.toLowerCase()) || [];
    const hasBoth = positions.length > 1;

    for (const p of positions) {
      const cashFlow = Number(p.cash_flow);
      const netTokens = Number(p.net_tokens);
      const resPrice = payouts[p.outcome_index] ?? 0.5;
      const pnl = cashFlow + netTokens * resPrice;

      if (hasBoth) {
        bothOutcomePnl += pnl;
      } else {
        singleOutcomePnl += pnl;
      }
    }
  }

  console.log('PnL from BOTH-OUTCOME markets: $' + bothOutcomePnl.toFixed(2));
  console.log('PnL from SINGLE-OUTCOME markets: $' + singleOutcomePnl.toFixed(2));

  // If both-outcome markets have equal positive and negative components,
  // dropping one would halve the loss
  console.log('\nIf the 2x bug is from both-outcome markets, dropping hedge legs should fix it.');

  await clickhouse.close();
}

main().catch(console.error);
