/**
 * Try deterministic outcome assignment WITHOUT ground truth
 *
 * Theory: For resolved markets, we know WHICH outcome won ($1).
 * If we observe the trader's final position and the market resolution,
 * we might be able to infer the mapping.
 *
 * Key insight: For each condition pair with 2 tokens:
 * - One token resolved to $1 (winner)
 * - One token resolved to $0 (loser)
 *
 * If trader has net POSITIVE position on token X:
 * - If market result = $1 for outcome 0, and we assume X = outcome 0, trader wins
 * - If market result = $0 for outcome 0, and we assume X = outcome 0, trader loses
 *
 * Without ground truth, we CAN'T distinguish which scenario is correct.
 * UNLESS... we use redemptions as signal!
 *
 * If trader redeemed tokens, they received payout = position * resolution_price.
 * The redemption amount tells us if they held winning or losing tokens.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== DETERMINISTIC OUTCOME ASSIGNMENT ANALYSIS ===\n');

  // Get redemptions for this wallet
  const redemptionQ = `
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as payout
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    GROUP BY condition_id
  `;
  const redemptionR = await clickhouse.query({ query: redemptionQ, format: 'JSONEachRow' });
  const redemptions = (await redemptionR.json()) as any[];
  console.log('Redemption events by condition:', redemptions.length);

  // Get token positions by condition (via tx_hash correlation)
  const posQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    ),
    ctf_conditions AS (
      SELECT tx_hash, condition_id
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
    ),
    trades AS (
      SELECT
        t.token_id,
        c.condition_id,
        sum(if(t.side = 'buy', t.token_amount, -t.token_amount)) / 1e6 as net_position
      FROM pm_trader_events_v2 t
      JOIN ctf_conditions c ON c.tx_hash = lower(concat('0x', hex(t.transaction_hash)))
      WHERE t.trader_wallet = '${WALLET}' AND t.is_deleted = 0
      GROUP BY t.token_id, c.condition_id
    )
    SELECT
      condition_id,
      groupArray(token_id) as tokens,
      groupArray(net_position) as positions
    FROM trades
    GROUP BY condition_id
    HAVING length(tokens) = 2
  `;
  const posR = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
  const positions = (await posR.json()) as any[];
  console.log('Conditions with 2 tokens:', positions.length);

  // Get resolution prices
  const condList = positions.map((p) => `'${p.condition_id}'`).join(',');
  const resQ = `
    SELECT condition_id, outcome_index, resolved_price
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (${condList})
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = (await resR.json()) as any[];

  const resMap = new Map<string, { 0: number; 1: number }>();
  for (const r of resolutions) {
    if (!resMap.has(r.condition_id)) {
      resMap.set(r.condition_id, { 0: 0, 1: 0 });
    }
    resMap.get(r.condition_id)![r.outcome_index as 0 | 1] = parseFloat(r.resolved_price);
  }

  // Build redemption map
  const redemptionMap = new Map<string, number>();
  for (const r of redemptions) {
    redemptionMap.set(r.condition_id, parseFloat(r.payout));
  }

  console.log('\n=== ANALYZING POSITIONS + REDEMPTIONS + RESOLUTIONS ===\n');

  let inferrableCount = 0;
  let ambiguousCount = 0;

  for (const p of positions.slice(0, 10)) {
    const res = resMap.get(p.condition_id);
    const redemption = redemptionMap.get(p.condition_id) || 0;

    if (!res) {
      console.log(`Condition ${p.condition_id.slice(0, 16)}... - NO RESOLUTION`);
      continue;
    }

    const [token0, token1] = p.tokens;
    const [pos0, pos1] = p.positions.map(parseFloat);

    // Calculate expected payout for each mapping hypothesis
    // Hypothesis A: token0 = outcome 0, token1 = outcome 1
    const payoutA =
      (pos0 > 0 ? pos0 * res[0] : 0) + (pos1 > 0 ? pos1 * res[1] : 0);

    // Hypothesis B: token0 = outcome 1, token1 = outcome 0
    const payoutB =
      (pos0 > 0 ? pos0 * res[1] : 0) + (pos1 > 0 ? pos1 * res[0] : 0);

    console.log(`Condition ${p.condition_id.slice(0, 16)}...`);
    console.log(`  Positions: [${pos0.toFixed(2)}, ${pos1.toFixed(2)}]`);
    console.log(`  Resolution: outcome0=$${res[0]}, outcome1=$${res[1]}`);
    console.log(`  Hypothesis A payout: $${payoutA.toFixed(2)}`);
    console.log(`  Hypothesis B payout: $${payoutB.toFixed(2)}`);
    console.log(`  Actual redemption: $${redemption.toFixed(2)}`);

    // Can we infer from redemption?
    if (redemption > 0) {
      const errorA = Math.abs(payoutA - redemption);
      const errorB = Math.abs(payoutB - redemption);

      if (errorA < 0.01 && errorB > 0.01) {
        console.log(`  ✅ Hypothesis A matches redemption!`);
        inferrableCount++;
      } else if (errorB < 0.01 && errorA > 0.01) {
        console.log(`  ✅ Hypothesis B matches redemption!`);
        inferrableCount++;
      } else {
        console.log(`  ❓ Ambiguous (errorA=${errorA.toFixed(2)}, errorB=${errorB.toFixed(2)})`);
        ambiguousCount++;
      }
    } else {
      // No redemption - position might still be open or resolved to 0
      if (payoutA === 0 && payoutB === 0) {
        console.log(`  ⚪ Both hypotheses = $0 (can't distinguish)`);
        ambiguousCount++;
      } else if (payoutA === 0 || payoutB === 0) {
        console.log(`  ⚠️ One hypothesis = $0, unredeemed - might indicate mapping`);
        ambiguousCount++;
      } else {
        console.log(`  ❓ No redemption, can't determine`);
        ambiguousCount++;
      }
    }
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Inferrable from redemptions: ${inferrableCount}`);
  console.log(`Ambiguous: ${ambiguousCount}`);
  console.log(`Total analyzed: ${Math.min(10, positions.length)}`);

  if (inferrableCount === 0) {
    console.log('\n⚠️ Cannot deterministically infer outcome mapping without ground truth');
    console.log('Recommendation: Use greedy optimization with captured P&L');
  }
}

main().catch(console.error);
