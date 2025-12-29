/**
 * Check if ImJustKen's PayoutRedemption events correspond to CLOB positions
 *
 * Hypothesis: Some PayoutRedemption events are for positions NOT acquired via CLOB
 * (e.g., acquired via PositionSplit or other means)
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x9d84ce0306f8551e02efef1680475fc0f1dc1344'; // ImJustKen
const UI_PNL = 2436163.50;

async function main() {
  console.log('='.repeat(120));
  console.log('PayoutRedemption Coverage Analysis: ImJustKen');
  console.log('='.repeat(120));
  console.log('');

  // 1. Get all PayoutRedemption events
  console.log('STEP 1: PayoutRedemption events summary');
  console.log('-'.repeat(120));

  const redemptionQuery = `
    SELECT
      canonical_condition_id,
      sum(usdc_delta) as redemption_total,
      count() as redemption_events
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'PayoutRedemption'
    GROUP BY canonical_condition_id
    ORDER BY redemption_total DESC
  `;

  const redemptionResult = await clickhouse.query({ query: redemptionQuery, format: 'JSONEachRow' });
  const redemptionRows = (await redemptionResult.json()) as any[];

  console.log(`Total markets with redemptions: ${redemptionRows.length}`);
  console.log(`Total redemption amount: $${redemptionRows.reduce((sum, r) => sum + Number(r.redemption_total), 0).toLocaleString()}`);
  console.log('');

  // 2. Check which redemptions have corresponding CLOB activity
  console.log('STEP 2: Cross-reference with CLOB positions');
  console.log('-'.repeat(120));

  const crossRefQuery = `
    WITH
      redemptions AS (
        SELECT
          canonical_condition_id,
          sum(usdc_delta) as redemption_usdc
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'PayoutRedemption'
        GROUP BY canonical_condition_id
      ),
      clob_positions AS (
        SELECT
          canonical_condition_id,
          outcome_index,
          sum(usdc_delta) as clob_cash_flow,
          sum(token_delta) as clob_tokens,
          any(payout_norm) as resolution
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'CLOB'
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
        GROUP BY canonical_condition_id, outcome_index
      ),
      clob_summary AS (
        SELECT
          canonical_condition_id,
          sum(clob_cash_flow) as total_cash_flow,
          sum(clob_tokens) as total_tokens,
          any(resolution) as resolution
        FROM clob_positions
        GROUP BY canonical_condition_id
      )
    SELECT
      r.canonical_condition_id,
      r.redemption_usdc,
      c.total_cash_flow as clob_cash_flow,
      c.total_tokens as clob_tokens,
      c.resolution as clob_resolution,
      if(c.canonical_condition_id IS NULL, 'NO_CLOB', 'HAS_CLOB') as status,
      if(c.resolution IS NOT NULL, c.total_cash_flow + c.total_tokens * c.resolution, NULL) as clob_pnl
    FROM redemptions r
    LEFT JOIN clob_summary c ON r.canonical_condition_id = c.canonical_condition_id
    ORDER BY r.redemption_usdc DESC
    LIMIT 30
  `;

  const crossRefResult = await clickhouse.query({ query: crossRefQuery, format: 'JSONEachRow' });
  const crossRefRows = (await crossRefResult.json()) as any[];

  console.log('Top 30 redemption markets:');
  console.log('Condition (first 25)              | Redemption    | CLOB Cash    | CLOB Tokens  | Res   | Status   | CLOB PnL');
  console.log('-'.repeat(120));

  let noClob = 0;
  let hasClob = 0;
  let noClobAmount = 0;
  let hasClobAmount = 0;
  let clobPnlSum = 0;

  for (const r of crossRefRows) {
    const condId = (r.canonical_condition_id || 'NULL').substring(0, 25).padEnd(25);
    const redemption = Number(r.redemption_usdc).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).padStart(12);
    const cashFlow = r.clob_cash_flow !== null
      ? Number(r.clob_cash_flow).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).padStart(12)
      : 'N/A'.padStart(12);
    const tokens = r.clob_tokens !== null
      ? Number(r.clob_tokens).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).padStart(12)
      : 'N/A'.padStart(12);
    const res = r.clob_resolution !== null ? String(r.clob_resolution).padStart(5) : 'N/A'.padStart(5);
    const status = r.status.padEnd(8);
    const clobPnl = r.clob_pnl !== null
      ? Number(r.clob_pnl).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).padStart(12)
      : 'N/A'.padStart(12);

    console.log(`${condId} | $${redemption} | $${cashFlow} | ${tokens} | ${res} | ${status} | $${clobPnl}`);

    if (r.status === 'NO_CLOB') {
      noClob++;
      noClobAmount += Number(r.redemption_usdc);
    } else {
      hasClob++;
      hasClobAmount += Number(r.redemption_usdc);
      if (r.clob_pnl !== null) {
        clobPnlSum += Number(r.clob_pnl);
      }
    }
  }

  // 3. Full summary
  console.log('');
  console.log('STEP 3: Full Summary');
  console.log('-'.repeat(120));

  const fullSummaryQuery = `
    WITH
      redemptions AS (
        SELECT
          canonical_condition_id,
          sum(usdc_delta) as redemption_usdc
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'PayoutRedemption'
        GROUP BY canonical_condition_id
      ),
      clob_positions AS (
        SELECT DISTINCT canonical_condition_id
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'CLOB'
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
      )
    SELECT
      countIf(c.canonical_condition_id IS NULL) as no_clob_markets,
      sumIf(r.redemption_usdc, c.canonical_condition_id IS NULL) as no_clob_redemption,
      countIf(c.canonical_condition_id IS NOT NULL) as has_clob_markets,
      sumIf(r.redemption_usdc, c.canonical_condition_id IS NOT NULL) as has_clob_redemption,
      count() as total_markets,
      sum(r.redemption_usdc) as total_redemption
    FROM redemptions r
    LEFT JOIN clob_positions c ON r.canonical_condition_id = c.canonical_condition_id
  `;

  const fullResult = await clickhouse.query({ query: fullSummaryQuery, format: 'JSONEachRow' });
  const fullRows = (await fullResult.json()) as any[];
  const summary = fullRows[0];

  console.log(`Markets with redemption but NO CLOB: ${summary.no_clob_markets} ($${Number(summary.no_clob_redemption).toLocaleString()})`);
  console.log(`Markets with redemption AND CLOB:    ${summary.has_clob_markets} ($${Number(summary.has_clob_redemption).toLocaleString()})`);
  console.log(`Total redemption markets:            ${summary.total_markets} ($${Number(summary.total_redemption).toLocaleString()})`);
  console.log('');

  // 4. Check PositionSplit as source for non-CLOB redemptions
  console.log('STEP 4: Check if non-CLOB redemptions have PositionSplit source');
  console.log('-'.repeat(120));

  const splitCheckQuery = `
    WITH
      redemptions_no_clob AS (
        SELECT canonical_condition_id
        FROM (
          SELECT canonical_condition_id
          FROM pm_unified_ledger_v9
          WHERE lower(wallet_address) = lower('${WALLET}')
            AND source_type = 'PayoutRedemption'
        ) r
        LEFT JOIN (
          SELECT DISTINCT canonical_condition_id
          FROM pm_unified_ledger_v9
          WHERE lower(wallet_address) = lower('${WALLET}')
            AND source_type = 'CLOB'
        ) c ON r.canonical_condition_id = c.canonical_condition_id
        WHERE c.canonical_condition_id IS NULL
      )
    SELECT
      s.canonical_condition_id,
      s.source_type,
      sum(s.usdc_delta) as usdc_total,
      count() as events
    FROM pm_unified_ledger_v9 s
    WHERE lower(s.wallet_address) = lower('${WALLET}')
      AND s.canonical_condition_id IN (SELECT canonical_condition_id FROM redemptions_no_clob)
    GROUP BY s.canonical_condition_id, s.source_type
    ORDER BY s.canonical_condition_id, s.source_type
  `;

  const splitResult = await clickhouse.query({ query: splitCheckQuery, format: 'JSONEachRow' });
  const splitRows = (await splitResult.json()) as any[];

  if (splitRows.length > 0) {
    console.log('Activity in markets with redemption but no CLOB:');
    console.log('Condition (first 30)                   | Source           | USDC Total      | Events');
    console.log('-'.repeat(120));
    for (const r of splitRows) {
      const condId = (r.canonical_condition_id || 'NULL').substring(0, 30).padEnd(30);
      const source = r.source_type.padEnd(16);
      const usdc = Number(r.usdc_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(14);
      console.log(`${condId} | ${source} | $${usdc} | ${r.events}`);
    }
  } else {
    console.log('No non-CLOB redemption markets found with other activity');
  }

  console.log('');
  console.log('='.repeat(120));
  console.log('ANALYSIS');
  console.log('='.repeat(120));
  console.log('');
  console.log('The V20 position-based formula (CLOB only) gives +$1,586,829 (34.9% error).');
  console.log('');
  console.log('The missing ~$850K could come from:');
  console.log('  1. Redemptions on markets where positions were acquired via PositionSplit (not CLOB)');
  console.log('  2. Timing differences in data');
  console.log('  3. Token mapping gaps (unmapped tokens)');
  console.log('');
  console.log(`UI PnL:         $${UI_PNL.toLocaleString()}`);
  console.log(`V20 (CLOB):     $1,586,829`);
  console.log(`Gap:            $${(UI_PNL - 1586829).toLocaleString()}`);
}

main().catch(console.error);
