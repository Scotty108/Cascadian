/**
 * FULLY AUTOMATED P&L CALCULATION via CLOB API
 *
 * No ground truth needed! Uses CLOB getMarket(conditionId) to get:
 * - token_id → outcome label
 * - token_id → winner (true/false when resolved)
 * - token_id → price (for unresolved)
 *
 * Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
 * Where HeldValue = sum(position * (winner ? 1 : 0)) for resolved
 *                 = sum(position * price) for unresolved
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
const GROUND_TRUTH = -86.66; // For validation

async function main() {
  console.log('=== FULLY AUTOMATED P&L via CLOB API ===\n');

  const client = new ClobClient('https://clob.polymarket.com', 137);

  // ============================================================
  // STEP 1: Get CLOB aggregates
  // ============================================================
  console.log('Step 1: CLOB aggregates...');
  const clobQ = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      sum(if(side = 'buy', usdc, 0)) as buys,
      sum(if(side = 'sell', usdc, 0)) as sells
    FROM deduped
  `;
  const clobR = await clickhouse.query({ query: clobQ, format: 'JSONEachRow' });
  const { buys, sells } = (await clobR.json() as any[])[0];
  console.log(`  Buys: $${parseFloat(buys).toFixed(2)}`);
  console.log(`  Sells: $${parseFloat(sells).toFixed(2)}`);

  // ============================================================
  // STEP 2: Get CTF redemptions
  // ============================================================
  console.log('\nStep 2: CTF redemptions...');
  const redemptionQ = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemptions
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;
  const redemptionR = await clickhouse.query({ query: redemptionQ, format: 'JSONEachRow' });
  const { redemptions } = (await redemptionR.json() as any[])[0];
  console.log(`  Redemptions: $${parseFloat(redemptions || 0).toFixed(2)}`);

  // ============================================================
  // STEP 3: Get split cost via tx_hash join
  // ============================================================
  console.log('\nStep 3: Split cost...');
  const splitQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_cost
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const splitR = await clickhouse.query({ query: splitQ, format: 'JSONEachRow' });
  const { split_cost: splitCost } = (await splitR.json() as any[])[0];
  console.log(`  Split cost: $${parseFloat(splitCost || 0).toFixed(2)}`);

  // ============================================================
  // STEP 4: Get condition_ids via tx_hash correlation
  // ============================================================
  console.log('\nStep 4: Getting condition_ids...');
  const condQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const condR = await clickhouse.query({ query: condQ, format: 'JSONEachRow' });
  const conditions = (await condR.json()) as { condition_id: string }[];
  console.log(`  Found ${conditions.length} conditions`);

  // ============================================================
  // STEP 5: Fetch token metadata from CLOB API
  // ============================================================
  console.log('\nStep 5: Fetching token metadata from CLOB API...');

  const tokenWinnerMap = new Map<string, boolean | null>();
  const tokenPriceMap = new Map<string, number>();
  const tokenOutcomeMap = new Map<string, string>();

  let apiSuccess = 0;
  let apiFail = 0;

  for (const { condition_id } of conditions) {
    try {
      const formattedCondId = condition_id.startsWith('0x') ? condition_id : `0x${condition_id}`;
      const market = await client.getMarket(formattedCondId);

      if (market && market.tokens) {
        for (const t of market.tokens) {
          tokenWinnerMap.set(t.token_id, t.winner ?? null);
          tokenPriceMap.set(t.token_id, parseFloat(t.price || '0'));
          tokenOutcomeMap.set(t.token_id, t.outcome);
        }
        apiSuccess++;
      } else {
        apiFail++;
      }
    } catch {
      apiFail++;
    }
  }
  console.log(`  API success: ${apiSuccess}/${conditions.length}`);
  console.log(`  API fail: ${apiFail}/${conditions.length}`);
  console.log(`  Token mappings: ${tokenWinnerMap.size}`);

  // ============================================================
  // STEP 6: Get token positions
  // ============================================================
  console.log('\nStep 6: Getting token positions...');
  const posQ = `
    SELECT
      token_id,
      sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_position
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    GROUP BY token_id
  `;
  const posR = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
  const positions = (await posR.json()) as { token_id: string; net_position: string }[];

  // ============================================================
  // STEP 7: Calculate held value using winner flags
  // ============================================================
  console.log('\nStep 7: Calculating held value...');

  let heldValue = 0;
  let matchedTokens = 0;
  let unmatchedTokens = 0;
  let resolvedWinners = 0;
  let resolvedLosers = 0;
  let unresolved = 0;

  for (const p of positions) {
    const pos = parseFloat(p.net_position);
    if (pos <= 0) continue; // Only count held (positive) positions

    const winner = tokenWinnerMap.get(p.token_id);
    const price = tokenPriceMap.get(p.token_id);

    if (winner !== undefined) {
      matchedTokens++;
      if (winner === true) {
        heldValue += pos * 1;
        resolvedWinners++;
      } else if (winner === false) {
        heldValue += pos * 0;
        resolvedLosers++;
      } else if (price !== undefined) {
        heldValue += pos * price;
        unresolved++;
      }
    } else {
      unmatchedTokens++;
    }
  }

  console.log(`  Matched: ${matchedTokens}, Unmatched: ${unmatchedTokens}`);
  console.log(`  Winners: ${resolvedWinners}, Losers: ${resolvedLosers}, Unresolved: ${unresolved}`);
  console.log(`  Held value: $${heldValue.toFixed(2)}`);

  // ============================================================
  // STEP 8: Calculate final P&L
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('FINAL P&L CALCULATION (FULLY AUTOMATED)');
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
  console.log(`  Split cost:  $${parseFloat(splitCost || 0).toFixed(2)}`);
  console.log(`  Held value:  $${heldValue.toFixed(2)}`);
  console.log(`  ---`);
  console.log(`  Calculated P&L: $${pnl.toFixed(2)}`);
  console.log(`  Ground truth:   $${GROUND_TRUTH.toFixed(2)}`);
  console.log(`  Error:          $${Math.abs(pnl - GROUND_TRUTH).toFixed(2)}`);

  const status = Math.abs(pnl - GROUND_TRUTH) < 1 ? '✅' : '❌';
  console.log(`\n${status} Automation ${Math.abs(pnl - GROUND_TRUTH) < 1 ? 'SUCCESSFUL' : 'NEEDS WORK'}`);

  // ============================================================
  // STEP 9: Generate INSERT statements for token mapping
  // ============================================================
  console.log('\n=== INSERT STATEMENTS FOR pm_token_to_condition_patch ===');

  // Build condition → token mapping
  const tokenToCondition = new Map<string, string>();
  for (const { condition_id } of conditions) {
    const formattedCondId = condition_id.startsWith('0x') ? condition_id : `0x${condition_id}`;
    try {
      const market = await client.getMarket(formattedCondId);
      if (market && market.tokens) {
        for (const t of market.tokens) {
          tokenToCondition.set(t.token_id, condition_id);
        }
      }
    } catch {
      // Skip
    }
  }

  console.log(`\nINSERT INTO pm_token_to_condition_patch`);
  console.log(`(token_id_dec, condition_id, outcome_index, question, category, source, created_at)`);
  console.log(`VALUES`);

  let insertCount = 0;
  for (const [tokenId, conditionId] of tokenToCondition.entries()) {
    const outcome = tokenOutcomeMap.get(tokenId) || 'Unknown';
    const outcomeIndex = outcome.toLowerCase().includes('up') || outcome.toLowerCase() === 'yes' ? 0 : 1;
    if (insertCount < 4) {
      console.log(
        `('${tokenId}', '${conditionId}', ${outcomeIndex}, '${outcome}', 'crypto-15min', 'clob_api', now())${insertCount < 3 ? ',' : ''}`
      );
    }
    insertCount++;
  }
  console.log(`-- ... and ${insertCount - 4} more rows`);
}

main().catch(console.error);
