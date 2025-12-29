/**
 * Position-Level Analysis for darkrider11
 *
 * Investigates why V21 calculates +$10.3M vs UI +$2.3M
 * Hypothesis: PayoutRedemption records PAYOUT (principal + profit), not just profit
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a'; // darkrider11
const UI_PNL = 2287942;

async function main() {
  console.log('='.repeat(100));
  console.log('POSITION-LEVEL ANALYSIS: darkrider11');
  console.log('='.repeat(100));
  console.log(`Wallet: ${WALLET}`);
  console.log(`UI PnL: $${UI_PNL.toLocaleString()}`);
  console.log('');

  // 1. Summary by source type
  console.log('STEP 1: Summary by Source Type');
  console.log('-'.repeat(100));

  const summaryQuery = `
    SELECT
      source_type,
      sum(usdc_delta) / 1e6 as total_usdc,
      sum(token_delta) / 1e6 as total_tokens,
      count() as events
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
    GROUP BY source_type
    ORDER BY total_usdc DESC
  `;

  const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const summaryRows = (await summaryResult.json()) as any[];

  let totalUsdcAllSources = 0;
  for (const r of summaryRows) {
    const usdc = Number(r.total_usdc);
    totalUsdcAllSources += usdc;
    console.log(
      `  ${r.source_type.padEnd(18)} | USDC: $${usdc.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).padStart(15)} | Tokens: ${Number(r.total_tokens).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).padStart(15)} | Events: ${r.events}`
    );
  }
  console.log('-'.repeat(100));
  console.log(`  TOTAL USDC: $${totalUsdcAllSources.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');

  // 2. Top 10 positions by USDC flow
  console.log('STEP 2: Top 10 Positions by Absolute USDC Flow');
  console.log('-'.repeat(100));

  const posQuery = `
    SELECT
      source_type,
      canonical_condition_id,
      outcome_index,
      sum(usdc_delta) / 1e6 as usdc_flow,
      sum(token_delta) / 1e6 as token_flow,
      any(payout_norm) as resolution_price,
      count() as event_count
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND canonical_condition_id IS NOT NULL
      AND canonical_condition_id != ''
    GROUP BY source_type, canonical_condition_id, outcome_index
    ORDER BY abs(usdc_flow) DESC
    LIMIT 10
  `;

  const posResult = await clickhouse.query({ query: posQuery, format: 'JSONEachRow' });
  const posRows = (await posResult.json()) as any[];

  console.log('Source     | ConditionID (first 20)  | Outcome | USDC Flow       | Token Flow      | Res Price | Events');
  console.log('-'.repeat(100));

  for (const r of posRows) {
    const condId = r.canonical_condition_id.substring(0, 20);
    const usdc = Number(r.usdc_flow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(14);
    const tokens = Number(r.token_flow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(14);
    const resPrice = r.resolution_price !== null ? Number(r.resolution_price).toFixed(4) : 'N/A   ';
    console.log(`${r.source_type.padEnd(10)} | ${condId.padEnd(23)} | ${String(r.outcome_index).padStart(7)} | $${usdc} | ${tokens} | ${resPrice} | ${r.event_count}`);
  }
  console.log('');

  // 3. Find the biggest PayoutRedemption positions
  console.log('STEP 3: Top PayoutRedemption Events (Biggest USDC inflows)');
  console.log('-'.repeat(100));

  const redemptionQuery = `
    SELECT
      canonical_condition_id,
      usdc_delta / 1e6 as usdc_inflow,
      token_delta / 1e6 as token_change,
      event_time
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'PayoutRedemption'
    ORDER BY usdc_delta DESC
    LIMIT 10
  `;

  const redemptionResult = await clickhouse.query({ query: redemptionQuery, format: 'JSONEachRow' });
  const redemptionRows = (await redemptionResult.json()) as any[];

  console.log('ConditionID (first 30)                | USDC Inflow     | Token Change    | Date');
  console.log('-'.repeat(100));

  for (const r of redemptionRows) {
    const condId = r.canonical_condition_id.substring(0, 30).padEnd(30);
    const usdc = ('$' + Number(r.usdc_inflow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).padStart(15);
    const tokens = Number(r.token_change).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    const date = String(r.event_time).substring(0, 10);
    console.log(`${condId} | ${usdc} | ${tokens} | ${date}`);
  }
  console.log('');

  // 4. For top 3 PayoutRedemption, show the full position lifecycle
  console.log('STEP 4: Full Lifecycle for Top 3 Positions');
  console.log('-'.repeat(100));

  // Get top 3 condition_ids with biggest redemptions
  const top3Query = `
    SELECT DISTINCT canonical_condition_id
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'PayoutRedemption'
    ORDER BY usdc_delta DESC
    LIMIT 3
  `;

  const top3Result = await clickhouse.query({ query: top3Query, format: 'JSONEachRow' });
  const top3Rows = (await top3Result.json()) as any[];

  for (const t of top3Rows) {
    const condId = t.canonical_condition_id;
    console.log(`\nCondition: ${condId.substring(0, 40)}...`);
    console.log('-'.repeat(80));

    // Get all events for this condition
    const lifecycleQuery = `
      SELECT
        source_type,
        outcome_index,
        sum(usdc_delta) / 1e6 as usdc_flow,
        sum(token_delta) / 1e6 as token_flow,
        any(payout_norm) as resolution_price,
        count() as events
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND canonical_condition_id = '${condId}'
      GROUP BY source_type, outcome_index
      ORDER BY source_type, outcome_index
    `;

    const lifecycleResult = await clickhouse.query({ query: lifecycleQuery, format: 'JSONEachRow' });
    const lifecycleRows = (await lifecycleResult.json()) as any[];

    let totalCash = 0;
    let totalTokens = 0;

    console.log('Source           | Outcome | USDC Flow       | Token Flow      | Events');
    for (const l of lifecycleRows) {
      const usdc = Number(l.usdc_flow);
      const tokens = Number(l.token_flow);
      totalCash += usdc;
      totalTokens += tokens;

      const usdcStr = ('$' + usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).padStart(15);
      const tokensStr = tokens.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);

      console.log(`${l.source_type.padEnd(16)} | ${String(l.outcome_index).padStart(7)} | ${usdcStr} | ${tokensStr} | ${l.events}`);
    }

    console.log('-'.repeat(80));
    console.log(`Position TOTALS: Cash = $${totalCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}, Tokens = ${totalTokens.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

    // The issue: If we sum usdc_delta naively, we get:
    // - CLOB buy: -$X (paid X to buy)
    // - PayoutRedemption: +$Y (where Y = X + profit if won)
    // This gives us: -X + Y = profit (correct if Y = X + profit)
    // BUT if resolution_price is also applied to token_delta, we're double counting
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('HYPOTHESIS CHECK:');
  console.log('='.repeat(100));
  console.log('');
  console.log('If PayoutRedemption already includes the full payout (principal + profit),');
  console.log('then the current formula double-counts because:');
  console.log('  - CLOB: usdc_delta = -cost (correct)');
  console.log('  - PayoutRedemption: usdc_delta = +payout (includes cost + profit)');
  console.log('');
  console.log('Current formula: sum(usdc_delta) + sum(token_delta * resolution_price)');
  console.log('If PayoutRedemption already has payout in usdc_delta, we should NOT');
  console.log('also multiply remaining tokens by resolution_price.');
  console.log('');

  // 5. Check: Does sum(usdc_delta) alone give us something close to UI PnL?
  const simpleUsdcQuery = `
    SELECT
      sum(usdc_delta) / 1e6 as simple_pnl
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
  `;

  const simpleResult = await clickhouse.query({ query: simpleUsdcQuery, format: 'JSONEachRow' });
  const simpleRows = (await simpleResult.json()) as any[];
  const simplePnl = Number(simpleRows[0]?.simple_pnl || 0);

  console.log('ALTERNATIVE FORMULA TEST:');
  console.log(`  Simple sum(usdc_delta): $${simplePnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  UI PnL:                 $${UI_PNL.toLocaleString()}`);
  console.log(`  Error:                  ${(((simplePnl - UI_PNL) / UI_PNL) * 100).toFixed(2)}%`);
  console.log('');
  console.log('If simple_pnl is closer to UI than the complex formula, the issue is');
  console.log('definitely double-counting from the token_delta * resolution_price term.');
}

main().catch(console.error);
