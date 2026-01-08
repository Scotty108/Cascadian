#!/usr/bin/env npx tsx
/**
 * Debug CCR-v3: Analyze remaining token values for split-heavy wallet
 *
 * The issue: CCR-v3 shows -$10,808 but target is -$115,409
 * Gap: ~$104K
 *
 * After split inference:
 *   PnL before remaining = -$56,169
 *   Remaining value = +$45,361
 *   Total = -$10,808
 *
 * For target -$115,409:
 *   Remaining should = -$59,240
 *
 * Let's trace WHERE the +$45K remaining value comes from
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SPLIT_HEAVY_WALLET = '0xb2e4567925b79231265adf5d54687ddfb761bc51';

interface ConditionAnalysis {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  buySpend: number;
  sellProceeds: number;
  splitCollateral: number;
  mergeProceeds: number;
  redemptionProceeds: number;
  yesTokensIn: number;
  yesTokensOut: number;
  noTokensIn: number;
  noTokensOut: number;
  remainingYes: number;
  remainingNo: number;
  yesPayout: number;
  noPayout: number;
  isResolved: boolean;
  remainingValue: number;
  positionPnl: number;
}

async function analyzeRemainingTokens() {
  console.log('='.repeat(70));
  console.log('DEBUG: CCR-v3 Remaining Token Analysis');
  console.log('Wallet:', SPLIT_HEAVY_WALLET);
  console.log('='.repeat(70));

  // Step 1: Get all trades
  const tradesQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${SPLIT_HEAVY_WALLET}'
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.event_id,
      d.token_id,
      d.side,
      d.usdc,
      d.tokens,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
  `;

  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const trades = (await tradesResult.json()) as any[];
  console.log(`\nLoaded ${trades.length} trades`);

  // Step 2: Get all CTF events
  const ctfQuery = `
    SELECT DISTINCT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND lower(user_address) = '${SPLIT_HEAVY_WALLET}'
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfEvents = (await ctfResult.json()) as any[];
  console.log(`Loaded ${ctfEvents.length} CTF events`);

  // Step 3: Get unique conditions and their token mappings
  const conditionIds = new Set<string>();
  for (const t of trades) {
    if (t.condition_id) conditionIds.add(t.condition_id.toLowerCase());
  }
  for (const e of ctfEvents) {
    if (e.condition_id) conditionIds.add(e.condition_id.toLowerCase());
  }
  console.log(`\n${conditionIds.size} unique conditions`);

  // Get token mapping
  const conditionList = [...conditionIds].map(c => `'${c}'`).join(',');
  const tokenMapQuery = `
    SELECT
      lower(condition_id) as condition_id,
      token_id_dec,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) IN (${conditionList})
  `;

  const tokenMapResult = await clickhouse.query({ query: tokenMapQuery, format: 'JSONEachRow' });
  const tokenMapRows = (await tokenMapResult.json()) as any[];

  const tokenMap = new Map<string, { yes?: string; no?: string }>();
  for (const row of tokenMapRows) {
    const entry = tokenMap.get(row.condition_id) || {};
    if (row.outcome_index === 0) entry.yes = row.token_id_dec;
    else if (row.outcome_index === 1) entry.no = row.token_id_dec;
    tokenMap.set(row.condition_id, entry);
  }

  // Step 4: Get resolutions
  const resolutionQuery = `
    SELECT
      lower(condition_id) as condition_id,
      payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${conditionList})
  `;

  const resolutionResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
  const resolutions = (await resolutionResult.json()) as any[];

  const resolutionMap = new Map<string, { yesPayout: number; noPayout: number }>();
  for (const r of resolutions) {
    try {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      const denom = payouts.reduce((a: number, b: number) => a + b, 0);
      const yesPayout = denom > 0 ? payouts[0] / denom : 0;
      const noPayout = denom > 0 ? payouts[1] / denom : 0;
      resolutionMap.set(r.condition_id, { yesPayout, noPayout });
    } catch {
      // Parse error
    }
  }

  console.log(`${resolutionMap.size} resolved conditions`);

  // Step 5: Build cash flows per condition
  const cashFlows = new Map<string, ConditionAnalysis>();

  for (const [cid, tokens] of tokenMap) {
    if (!tokens.yes || !tokens.no) continue;
    cashFlows.set(cid, {
      conditionId: cid,
      yesTokenId: tokens.yes,
      noTokenId: tokens.no,
      buySpend: 0,
      sellProceeds: 0,
      splitCollateral: 0,
      mergeProceeds: 0,
      redemptionProceeds: 0,
      yesTokensIn: 0,
      yesTokensOut: 0,
      noTokensIn: 0,
      noTokensOut: 0,
      remainingYes: 0,
      remainingNo: 0,
      yesPayout: resolutionMap.get(cid)?.yesPayout ?? 0.5,
      noPayout: resolutionMap.get(cid)?.noPayout ?? 0.5,
      isResolved: resolutionMap.has(cid),
      remainingValue: 0,
      positionPnl: 0,
    });
  }

  // Process trades
  for (const t of trades) {
    if (!t.condition_id) continue;
    const cid = t.condition_id.toLowerCase();
    const cf = cashFlows.get(cid);
    if (!cf) continue;

    const isYes = t.outcome_index === 0;
    if (t.side === 'buy') {
      cf.buySpend += t.usdc;
      if (isYes) cf.yesTokensIn += t.tokens;
      else cf.noTokensIn += t.tokens;
    } else {
      cf.sellProceeds += t.usdc;
      if (isYes) cf.yesTokensOut += t.tokens;
      else cf.noTokensOut += t.tokens;
    }
  }

  // Process CTF events
  for (const e of ctfEvents) {
    if (!e.condition_id) continue;
    const cid = e.condition_id.toLowerCase();
    const cf = cashFlows.get(cid);
    if (!cf) continue;

    if (e.event_type === 'PositionSplit') {
      cf.splitCollateral += e.amount;
      cf.yesTokensIn += e.amount;
      cf.noTokensIn += e.amount;
    } else if (e.event_type === 'PositionsMerge') {
      cf.mergeProceeds += e.amount;
      cf.yesTokensOut += e.amount;
      cf.noTokensOut += e.amount;
    } else if (e.event_type === 'PayoutRedemption') {
      cf.redemptionProceeds += e.amount;
    }
  }

  // Apply split inference (same logic as CCR-v3)
  let totalInferredSplits = 0;
  for (const [cid, cf] of cashFlows) {
    const yesSellGap = Math.max(0, cf.yesTokensOut - cf.yesTokensIn);
    const noSellGap = Math.max(0, cf.noTokensOut - cf.noTokensIn);
    const inferredSplitCount = Math.max(yesSellGap, noSellGap);

    if (inferredSplitCount > 0) {
      cf.splitCollateral += inferredSplitCount;
      cf.yesTokensIn += inferredSplitCount;
      cf.noTokensIn += inferredSplitCount;
      totalInferredSplits += inferredSplitCount;
    }
  }
  console.log(`\nInferred ${totalInferredSplits.toFixed(0)} splits`);

  // Calculate remaining values
  let totalRemainingValue = 0;
  let totalPositivePnl = 0;
  let totalNegativePnl = 0;
  const conditionsWithRemaining: ConditionAnalysis[] = [];

  for (const [cid, cf] of cashFlows) {
    cf.remainingYes = Math.max(0, cf.yesTokensIn - cf.yesTokensOut);
    cf.remainingNo = Math.max(0, cf.noTokensIn - cf.noTokensOut);

    const yesValue = cf.remainingYes * cf.yesPayout;
    const noValue = cf.remainingNo * cf.noPayout;
    cf.remainingValue = yesValue + noValue;
    totalRemainingValue += cf.remainingValue;

    const usdcOut = cf.buySpend + cf.splitCollateral;
    const usdcIn = cf.sellProceeds + cf.mergeProceeds + cf.redemptionProceeds;
    cf.positionPnl = usdcIn - usdcOut + cf.remainingValue;

    if (cf.positionPnl > 0) totalPositivePnl += cf.positionPnl;
    else totalNegativePnl += cf.positionPnl;

    if (cf.remainingYes > 0 || cf.remainingNo > 0) {
      conditionsWithRemaining.push(cf);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('REMAINING VALUE SUMMARY');
  console.log('='.repeat(70));

  let totalBuys = 0;
  let totalSells = 0;
  let totalSplits = 0;
  let totalMerges = 0;
  let totalRedemptions = 0;
  let totalPnl = 0;

  for (const cf of cashFlows.values()) {
    totalBuys += cf.buySpend;
    totalSells += cf.sellProceeds;
    totalSplits += cf.splitCollateral;
    totalMerges += cf.mergeProceeds;
    totalRedemptions += cf.redemptionProceeds;
    totalPnl += cf.positionPnl;
  }

  console.log(`\nCash Flows:`);
  console.log(`  Buys:        -$${totalBuys.toLocaleString()}`);
  console.log(`  Splits:      -$${totalSplits.toLocaleString()}`);
  console.log(`  Sells:       +$${totalSells.toLocaleString()}`);
  console.log(`  Merges:      +$${totalMerges.toLocaleString()}`);
  console.log(`  Redemptions: +$${totalRedemptions.toLocaleString()}`);
  console.log(`  Remaining:   +$${totalRemainingValue.toLocaleString()}`);
  console.log(`  --------------------------------`);
  console.log(`  Total PnL:   $${totalPnl.toLocaleString()}`);
  console.log(`  Target:      -$115,409`);
  console.log(`  Gap:         $${Math.abs(totalPnl - (-115409)).toLocaleString()}`);

  console.log(`\n\nConditions with remaining tokens: ${conditionsWithRemaining.length}`);

  // Sort by absolute remaining value descending
  conditionsWithRemaining.sort((a, b) => Math.abs(b.remainingValue) - Math.abs(a.remainingValue));

  console.log('\nTop 20 conditions with remaining value:\n');
  console.log('Condition           | YES rem | NO rem  | YES pay | NO pay | Remain Val | Position PnL | Resolved');
  console.log('-'.repeat(110));

  for (let i = 0; i < Math.min(20, conditionsWithRemaining.length); i++) {
    const cf = conditionsWithRemaining[i];
    console.log(
      `${cf.conditionId.slice(0, 18)}... | ` +
      `${cf.remainingYes.toFixed(0).padStart(7)} | ` +
      `${cf.remainingNo.toFixed(0).padStart(7)} | ` +
      `$${cf.yesPayout.toFixed(2).padStart(5)} | ` +
      `$${cf.noPayout.toFixed(2).padStart(4)} | ` +
      `$${cf.remainingValue.toFixed(0).padStart(10)} | ` +
      `$${cf.positionPnl.toFixed(0).padStart(11)} | ` +
      `${cf.isResolved ? 'Yes' : 'NO!!'}`
    );
  }

  // Check for conditions with anomalous remaining values
  console.log('\n\n' + '='.repeat(70));
  console.log('ANOMALY CHECK: Conditions where remaining should be 0');
  console.log('='.repeat(70));

  // After inference, if we sold all tokens, remaining should be 0
  // But if remaining > 0 AND it's resolved with winning side,
  // we're counting "phantom" value

  const anomalies: ConditionAnalysis[] = [];
  for (const cf of conditionsWithRemaining) {
    // Check if tokens "appeared" from inference that shouldn't have value
    // A real remaining token would come from explicit buy or split
    // An inferred remaining token is just balancing sell gaps

    // If inferredSplit was applied, then remainingYes/No includes the inferred amount
    // But these were already SOLD - so remaining should be what we KEPT, not what we inferred

    const originalYesIn = cf.yesTokensIn - cf.splitCollateral; // Remove inferred splits
    const originalNoIn = cf.noTokensIn - cf.splitCollateral;

    // Wait, this isn't right either. Let me think...

    // The issue: split inference adds tokens to In AND to splitCollateral
    // So remaining = (original_in + inferred) - out
    //
    // If original_in = 100 YES (bought), out = 0 (never sold), inferred = 0
    //   → remaining = 100 YES (correct, we hold it)
    //
    // If original_in = 0 YES, out = 100 (sold via split+sell), inferred = 100
    //   → remaining = 0 YES (correct, we sold it all)
    //
    // But what if:
    // - original_in = 50 YES (bought), out = 100 (sold more), inferred = 50
    //   → remaining = 50 + 50 - 100 = 0 (correct)
    //
    // - original_in = 50 YES (bought), out = 50 (sold half), inferred = 0
    //   → remaining = 50 (correct)

    // So the logic seems right... let me check specific conditions

    // Actually, the issue might be WHICH payout we're using
    // If remaining YES > 0 but YES lost (payout=0), value = 0 (correct)
    // If remaining YES > 0 and YES won (payout=1), value = tokens (correct)
    // If remaining YES > 0 and NOT resolved (payout=0.5), value = 0.5 * tokens (unrealized)

    // All conditions are resolved (198 resolved, 0 unresolved per earlier test)
    // So the issue is not unrealized positions

    // Let me check if there are cases where we have remaining tokens on BOTH sides
    // That would be weird for resolved markets
    if (cf.remainingYes > 0 && cf.remainingNo > 0) {
      anomalies.push(cf);
    }
  }

  console.log(`\nConditions with remaining tokens on BOTH sides: ${anomalies.length}`);
  for (const cf of anomalies.slice(0, 10)) {
    console.log(
      `${cf.conditionId.slice(0, 18)}... | ` +
      `YES: ${cf.remainingYes.toFixed(0)} @ $${cf.yesPayout.toFixed(2)} | ` +
      `NO: ${cf.remainingNo.toFixed(0)} @ $${cf.noPayout.toFixed(2)} | ` +
      `Value: $${cf.remainingValue.toFixed(0)}`
    );
  }

  // Key insight: If both YES and NO have remaining tokens after resolution,
  // the split inference added too many tokens!

  // Let me calculate what happens WITHOUT inference
  console.log('\n\n' + '='.repeat(70));
  console.log('COMPARISON: With vs Without Split Inference');
  console.log('='.repeat(70));

  // Re-calculate without inference
  const cashFlowsNoInference = new Map<string, ConditionAnalysis>();
  for (const [cid, tokens] of tokenMap) {
    if (!tokens.yes || !tokens.no) continue;
    cashFlowsNoInference.set(cid, {
      conditionId: cid,
      yesTokenId: tokens.yes,
      noTokenId: tokens.no,
      buySpend: 0,
      sellProceeds: 0,
      splitCollateral: 0,
      mergeProceeds: 0,
      redemptionProceeds: 0,
      yesTokensIn: 0,
      yesTokensOut: 0,
      noTokensIn: 0,
      noTokensOut: 0,
      remainingYes: 0,
      remainingNo: 0,
      yesPayout: resolutionMap.get(cid)?.yesPayout ?? 0.5,
      noPayout: resolutionMap.get(cid)?.noPayout ?? 0.5,
      isResolved: resolutionMap.has(cid),
      remainingValue: 0,
      positionPnl: 0,
    });
  }

  for (const t of trades) {
    if (!t.condition_id) continue;
    const cf = cashFlowsNoInference.get(t.condition_id.toLowerCase());
    if (!cf) continue;
    const isYes = t.outcome_index === 0;
    if (t.side === 'buy') {
      cf.buySpend += t.usdc;
      if (isYes) cf.yesTokensIn += t.tokens;
      else cf.noTokensIn += t.tokens;
    } else {
      cf.sellProceeds += t.usdc;
      if (isYes) cf.yesTokensOut += t.tokens;
      else cf.noTokensOut += t.tokens;
    }
  }

  for (const e of ctfEvents) {
    if (!e.condition_id) continue;
    const cf = cashFlowsNoInference.get(e.condition_id.toLowerCase());
    if (!cf) continue;
    if (e.event_type === 'PositionSplit') {
      cf.splitCollateral += e.amount;
      cf.yesTokensIn += e.amount;
      cf.noTokensIn += e.amount;
    } else if (e.event_type === 'PositionsMerge') {
      cf.mergeProceeds += e.amount;
      cf.yesTokensOut += e.amount;
      cf.noTokensOut += e.amount;
    } else if (e.event_type === 'PayoutRedemption') {
      cf.redemptionProceeds += e.amount;
    }
  }

  // Calculate totals WITHOUT inference
  let totalPnlNoInference = 0;
  let totalRemainingNoInference = 0;
  let negativeRemainingCount = 0;
  let negativeRemainingValue = 0;

  for (const cf of cashFlowsNoInference.values()) {
    // Note: WITHOUT inference, remaining can be NEGATIVE (sold more than bought)
    const rawRemainingYes = cf.yesTokensIn - cf.yesTokensOut;
    const rawRemainingNo = cf.noTokensIn - cf.noTokensOut;

    // If remaining is negative, that's the sell gap (we sold tokens we didn't have)
    // This indicates hidden inventory from splits
    if (rawRemainingYes < -1 || rawRemainingNo < -1) {
      negativeRemainingCount++;
      negativeRemainingValue += rawRemainingYes < 0 ? rawRemainingYes : 0;
      negativeRemainingValue += rawRemainingNo < 0 ? rawRemainingNo : 0;
    }

    // For PnL, we use positive remaining only (can't have negative tokens)
    const remainingYes = Math.max(0, rawRemainingYes);
    const remainingNo = Math.max(0, rawRemainingNo);
    const remainingValue = remainingYes * cf.yesPayout + remainingNo * cf.noPayout;
    totalRemainingNoInference += remainingValue;

    const usdcOut = cf.buySpend + cf.splitCollateral;
    const usdcIn = cf.sellProceeds + cf.mergeProceeds + cf.redemptionProceeds;
    const pnl = usdcIn - usdcOut + remainingValue;
    totalPnlNoInference += pnl;
  }

  console.log(`\nWithout Inference:`);
  console.log(`  Remaining value: $${totalRemainingNoInference.toLocaleString()}`);
  console.log(`  Total PnL:       $${totalPnlNoInference.toLocaleString()}`);
  console.log(`  Negative remaining (sell gaps): ${negativeRemainingCount} conditions, ${negativeRemainingValue.toFixed(0)} tokens`);

  console.log(`\nWith Inference:`);
  console.log(`  Remaining value: $${totalRemainingValue.toLocaleString()}`);
  console.log(`  Total PnL:       $${totalPnl.toLocaleString()}`);
  console.log(`  Inferred splits: ${totalInferredSplits.toFixed(0)} tokens`);

  console.log(`\nDifference from inference: $${(totalPnl - totalPnlNoInference).toLocaleString()}`);
}

analyzeRemainingTokens().catch(console.error);
