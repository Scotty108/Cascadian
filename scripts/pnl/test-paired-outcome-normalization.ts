#!/usr/bin/env npx tsx
/**
 * Test paired-outcome normalization logic
 * ============================================================================
 *
 * Fixes Bug B: paired-outcome trades (complete set mint/redeem)
 *
 * Detection pattern:
 *   - Group by: trader_wallet, transaction_hash, condition_id
 *   - Flag as paired when:
 *     - Both outcomes 0 and 1 present
 *     - One is buy, one is sell (opposite directions)
 *     - Token amounts match within epsilon
 *
 * Normalization (Option A):
 *   - For paired groups: keep the buy leg, drop the sell leg
 *   - This matches how UI appears to net these trades
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const testWallet = process.argv[2] || '0x8677df7105d1146eecf515fa00a88a83a661cd6a';
const EPSILON = 1.0; // Allow 1 token difference for "matching" amounts

async function main() {
  console.log('=== Paired-Outcome Normalization Test ===');
  console.log('Wallet: ' + testWallet.slice(0, 10) + '...');
  console.log('Epsilon: ' + EPSILON + ' tokens\n');

  // Step 1: Get canonical fills with outcome mapping
  const fillsQuery = `
    SELECT
      f.trader_wallet,
      f.transaction_hash,
      f.token_id,
      f.side,
      f.token_amount / 1000000.0 as tokens,
      f.usdc_amount / 1000000.0 as usdc,
      f.trade_time,
      m.condition_id,
      m.outcome_index
    FROM pm_trader_fills_canonical_v1 f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE f.trader_wallet = '${testWallet}'
    ORDER BY f.trade_time, m.condition_id, m.outcome_index
  `;

  const fillsResult = await clickhouse.query({ query: fillsQuery, format: 'JSONEachRow' });
  const fills = (await fillsResult.json()) as any[];

  console.log('Total canonical fills: ' + fills.length);

  // Step 2: Group by (tx_hash, condition_id) to detect paired trades
  const groups = new Map<string, any[]>();
  for (const fill of fills) {
    const key = `${fill.transaction_hash}_${fill.condition_id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(fill);
  }

  console.log('Unique (tx, condition) groups: ' + groups.size);

  // Step 3: Detect and normalize paired trades
  const normalizedFills: any[] = [];
  let pairedGroupCount = 0;
  let droppedFills = 0;

  for (const [key, groupFills] of groups) {
    // Check if this is a paired-outcome group
    const outcomes = new Set(groupFills.map(f => f.outcome_index));
    const hasBothOutcomes = outcomes.has(0) && outcomes.has(1);

    if (!hasBothOutcomes || groupFills.length < 2) {
      // Not paired - keep all fills
      normalizedFills.push(...groupFills);
      continue;
    }

    // Check for opposite directions and matching amounts
    const o0Fills = groupFills.filter(f => f.outcome_index === 0);
    const o1Fills = groupFills.filter(f => f.outcome_index === 1);

    let isPaired = false;
    const pairedO1Indices: number[] = [];

    for (let i = 0; i < o0Fills.length && !isPaired; i++) {
      for (let j = 0; j < o1Fills.length; j++) {
        const o0 = o0Fills[i];
        const o1 = o1Fills[j];

        // Check opposite directions (one buy, one sell)
        const oppositeDirection = o0.side !== o1.side;

        // Check matching token amounts within epsilon
        const amountMatch = Math.abs(o0.tokens - o1.tokens) <= EPSILON;

        if (oppositeDirection && amountMatch) {
          isPaired = true;
          pairedO1Indices.push(j);
          break;
        }
      }
    }

    if (isPaired) {
      pairedGroupCount++;
      // Keep O0 fills (the buy leg), drop O1 fills that were paired
      normalizedFills.push(...o0Fills);

      // Only keep unpaired O1 fills
      for (let j = 0; j < o1Fills.length; j++) {
        if (!pairedO1Indices.includes(j)) {
          normalizedFills.push(o1Fills[j]);
        } else {
          droppedFills++;
        }
      }

      console.log('\nPaired group detected:');
      console.log('  TX: ' + groupFills[0].transaction_hash.slice(0, 16) + '...');
      console.log('  Condition: ' + groupFills[0].condition_id.slice(0, 16) + '...');
      for (const f of groupFills) {
        const status = f.outcome_index === 1 && pairedO1Indices.length > 0 ? ' [DROPPED]' : '';
        console.log(`    O${f.outcome_index} ${f.side.padEnd(4)} ${f.tokens.toFixed(2)} tokens @ $${f.usdc.toFixed(2)}${status}`);
      }
    } else {
      // Not paired - keep all fills
      normalizedFills.push(...groupFills);
    }
  }

  console.log('\n=== Normalization Summary ===');
  console.log('Paired groups found: ' + pairedGroupCount);
  console.log('Fills dropped: ' + droppedFills);
  console.log('Fills before: ' + fills.length);
  console.log('Fills after: ' + normalizedFills.length);

  // Step 4: Compute PnL with normalized fills
  console.log('\n=== PnL with Normalized Fills ===');

  // Aggregate by outcome
  const byOutcome = new Map<string, { buy_tokens: number; sell_tokens: number; buy_usdc: number; sell_usdc: number }>();

  for (const fill of normalizedFills) {
    const key = `${fill.condition_id}_${fill.outcome_index}`;
    if (!byOutcome.has(key)) {
      byOutcome.set(key, { buy_tokens: 0, sell_tokens: 0, buy_usdc: 0, sell_usdc: 0 });
    }
    const agg = byOutcome.get(key)!;
    if (fill.side === 'buy') {
      agg.buy_tokens += fill.tokens;
      agg.buy_usdc += fill.usdc;
    } else {
      agg.sell_tokens += fill.tokens;
      agg.sell_usdc += fill.usdc;
    }
  }

  // Get resolutions
  const conditionIds = [...new Set(normalizedFills.map(f => f.condition_id))];
  const resQuery = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE condition_id IN ('${conditionIds.join("','")}')
  `;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];
  const resolutionMap = new Map(resRows.map(r => [r.condition_id, JSON.parse(r.payout_numerators || '[]')]));

  let totalPnl = 0;
  for (const [key, agg] of byOutcome) {
    const [conditionId, outcomeIndexStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr);
    const payouts = resolutionMap.get(conditionId) || [];
    const resPrice = payouts[outcomeIndex] ?? 0;

    const cashFlow = agg.sell_usdc - agg.buy_usdc;
    const finalShares = agg.buy_tokens - agg.sell_tokens;
    const redemption = finalShares * resPrice;
    const marketPnl = cashFlow + redemption;

    totalPnl += marketPnl;

    console.log(`O${outcomeIndex}: buy=${agg.buy_tokens.toFixed(2)}, sell=${agg.sell_tokens.toFixed(2)}, cash=$${cashFlow.toFixed(2)}, res=${resPrice}, pnl=$${marketPnl.toFixed(2)}`);
  }

  console.log('\n=== FINAL RESULTS ===');
  console.log('Total PnL (normalized):      $' + totalPnl.toFixed(2));
  console.log('UI shows:                    $265.59');
  console.log('Previous (canonical only):   $637.67');
  console.log('Original (event_id dedup):   $1947.36');
  console.log('Delta from UI:               $' + (totalPnl - 265.59).toFixed(2));

  await clickhouse.close();
}

main().catch(console.error);
