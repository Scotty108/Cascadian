/**
 * CORRECTED P&L calculation
 *
 * Key insight: Redemptions BURN tokens. CLOB position doesn't account for this.
 * For winning tokens: actual_held = CLOB_position - redeemed_tokens
 *
 * Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
 * Where HeldValue = sum((CLOB_position - redeemed) * winner) for each token
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
const GROUND_TRUTH = -86.66;

async function main() {
  console.log('=== CORRECTED P&L CALCULATION ===\n');

  const client = new ClobClient('https://clob.polymarket.com', 137);

  // Step 1: Get basic P&L components
  console.log('Step 1: Basic components...');
  const clobQ = `
    WITH deduped AS (
      SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      sum(if(side = 'buy', usdc, 0)) as buys,
      sum(if(side = 'sell', usdc, 0)) as sells
    FROM deduped
  `;
  const { buys, sells } = (await (await clickhouse.query({ query: clobQ, format: 'JSONEachRow' })).json() as any[])[0];

  const splitQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_cost
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit' AND is_deleted = 0
  `;
  const { split_cost: splitCost } = (await (await clickhouse.query({ query: splitQ, format: 'JSONEachRow' })).json() as any[])[0];

  const redTotalQ = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemptions
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption' AND is_deleted = 0
  `;
  const { redemptions } = (await (await clickhouse.query({ query: redTotalQ, format: 'JSONEachRow' })).json() as any[])[0];

  console.log(`  Buys: $${parseFloat(buys).toFixed(2)}`);
  console.log(`  Sells: $${parseFloat(sells).toFixed(2)}`);
  console.log(`  Splits: $${parseFloat(splitCost || 0).toFixed(2)}`);
  console.log(`  Redemptions: $${parseFloat(redemptions || 0).toFixed(2)}`);

  // Step 2: Get redemptions by condition
  console.log('\nStep 2: Redemptions by condition...');
  const redByCondQ = `
    SELECT condition_id, sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redeemed
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption' AND is_deleted = 0
    GROUP BY condition_id
  `;
  const redemptionsByCondition = new Map<string, number>();
  const redRows = (await (await clickhouse.query({ query: redByCondQ, format: 'JSONEachRow' })).json()) as any[];
  for (const r of redRows) {
    redemptionsByCondition.set(r.condition_id, parseFloat(r.redeemed));
  }
  console.log(`  Conditions with redemptions: ${redemptionsByCondition.size}`);

  // Step 3: Get CLOB positions by token
  console.log('\nStep 3: CLOB positions...');
  const posQ = `
    SELECT
      token_id,
      sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as clob_position
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    GROUP BY token_id
  `;
  const positions = new Map<string, number>();
  const posRows = (await (await clickhouse.query({ query: posQ, format: 'JSONEachRow' })).json()) as any[];
  for (const p of posRows) {
    positions.set(p.token_id, parseFloat(p.clob_position));
  }

  // Step 4: Get condition_ids and token metadata from CLOB API
  console.log('\nStep 4: Fetching CLOB metadata...');
  const condQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit' AND is_deleted = 0
  `;
  const conditions = (await (await clickhouse.query({ query: condQ, format: 'JSONEachRow' })).json()) as any[];

  // Map: token_id -> { condition_id, winner, outcome }
  const tokenInfo = new Map<string, { condition_id: string; winner: boolean | null; outcome: string }>();

  for (const { condition_id } of conditions) {
    try {
      const m = await client.getMarket(`0x${condition_id}`);
      if (m?.tokens) {
        for (const t of m.tokens) {
          tokenInfo.set(t.token_id, {
            condition_id,
            winner: t.winner ?? null,
            outcome: t.outcome,
          });
        }
      }
    } catch {
      // Skip
    }
  }
  console.log(`  Token metadata fetched: ${tokenInfo.size}`);

  // Step 5: Calculate CORRECTED held value
  console.log('\nStep 5: Calculating corrected held value...');
  console.log('\nToken details:');
  console.log('Token (30 chars)               | CLOB Pos | Outcome | Winner | Redeemed | Actual Held | Value');
  console.log('-'.repeat(100));

  let heldValue = 0;

  for (const [tokenId, clobPos] of positions) {
    if (clobPos <= 0) continue; // Only positive positions

    const info = tokenInfo.get(tokenId);
    if (!info) continue;

    const { condition_id, winner, outcome } = info;

    // For winners: actual_held = CLOB_position - redeemed_tokens
    // Redeemed tokens = redemption_amount (since winner pays $1 per token)
    let redeemed = 0;
    if (winner === true) {
      // Redemption for this condition goes to the winning token
      redeemed = redemptionsByCondition.get(condition_id) || 0;
    }

    const actualHeld = Math.max(0, clobPos - redeemed);
    const tokenValue = winner === true ? actualHeld : 0;
    heldValue += tokenValue;

    console.log(
      `${tokenId.slice(0, 30)}... | ${clobPos.toFixed(2).padStart(8)} | ${outcome.padEnd(7)} | ${String(winner).padEnd(6)} | ${redeemed.toFixed(2).padStart(8)} | ${actualHeld.toFixed(2).padStart(11)} | $${tokenValue.toFixed(2)}`
    );
  }

  console.log('-'.repeat(100));
  console.log(`TOTAL CORRECTED HELD VALUE: $${heldValue.toFixed(2)}`);

  // Step 6: Calculate final P&L
  console.log('\n' + '='.repeat(60));
  console.log('FINAL P&L (CORRECTED)');
  console.log('='.repeat(60));

  const pnl =
    parseFloat(sells) +
    parseFloat(redemptions || 0) -
    parseFloat(buys) -
    parseFloat(splitCost || 0) +
    heldValue;

  console.log(`  Sells:       $${parseFloat(sells).toFixed(2)}`);
  console.log(`  Redemptions: $${parseFloat(redemptions || 0).toFixed(2)}`);
  console.log(`  Buys:        $${parseFloat(buys).toFixed(2)}`);
  console.log(`  Splits:      $${parseFloat(splitCost || 0).toFixed(2)}`);
  console.log(`  Held value:  $${heldValue.toFixed(2)}`);
  console.log(`  ---`);
  console.log(`  Calculated P&L: $${pnl.toFixed(2)}`);
  console.log(`  Ground truth:   $${GROUND_TRUTH.toFixed(2)}`);
  console.log(`  Error:          $${Math.abs(pnl - GROUND_TRUTH).toFixed(2)}`);

  const status = Math.abs(pnl - GROUND_TRUTH) < 1 ? '✅ SUCCESS' : '❌ NEEDS WORK';
  console.log(`\n${status}`);
}

main().catch(console.error);
