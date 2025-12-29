/**
 * ============================================================================
 * MISSING PNL ROOT CAUSE DIAGNOSTIC
 * ============================================================================
 *
 * PURPOSE: Diagnose why V18 engine returns ~0 PnL when UI shows significant PnL
 *
 * SYMPTOMS:
 *   - 0x222adc4302f58fe679f5212cf11344d29c0d103c: V18 0.00 vs UI +520.00
 *   - 0x0e5f632cdfb0f5a22d22331fd81246f452dccf38: V18 -1.00 vs UI -399.79
 *
 * ROOT CAUSES TO CHECK:
 *   1. Raw fills data exists in ClickHouse
 *   2. Role filtering (maker-only) excludes taker trades
 *   3. Token map join failures
 *   4. Resolution data missing
 *   5. Date range coverage
 *
 * ============================================================================
 */

import dotenv from 'dotenv';
import { clickhouse } from '../../lib/clickhouse/client';

// Load environment variables
dotenv.config({ path: '.env.local' });

interface DiagnosticResult {
  wallet: string;
  ui_pnl: number;
  v18_pnl: number;

  // Stage 1: Raw fills
  total_fills: number;
  total_volume_usdc: number;
  date_range_start: string | null;
  date_range_end: string | null;
  distinct_token_ids: number;

  // Stage 2: Role breakdown
  maker_fills: number;
  taker_fills: number;
  maker_volume_usdc: number;
  taker_volume_usdc: number;

  // Stage 3: Token map join
  fills_with_token_map: number;
  fills_without_token_map: number;
  token_map_join_rate: number;

  // Stage 4: Resolution coverage
  fills_with_resolutions: number;
  fills_without_resolutions: number;
  resolution_coverage_rate: number;

  // Detailed breakdowns
  excluded_token_ids: string[];
  unresolved_condition_ids: string[];
}

async function diagnoseWallet(wallet: string, uiPnl: number): Promise<DiagnosticResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`DIAGNOSING WALLET: ${wallet}`);
  console.log(`UI PnL: $${uiPnl.toFixed(2)}`);
  console.log(`${'='.repeat(80)}\n`);

  // -------------------------------------------------------------------------
  // STAGE 1: Raw fills data
  // -------------------------------------------------------------------------
  console.log('STAGE 1: Raw Fills Data (pm_trader_events_v2)...');

  const rawFillsQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1000000.0 as usdc,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      count() as total_fills,
      sum(abs(usdc)) as total_volume_usdc,
      min(trade_time) as date_range_start,
      max(trade_time) as date_range_end,
      uniq(token_id) as distinct_token_ids
    FROM deduped
  `;

  const rawResult = await clickhouse.query({ query: rawFillsQuery, format: 'JSONEachRow' });
  const rawRow = ((await rawResult.json()) as any[])[0];

  const totalFills = Number(rawRow.total_fills);
  const totalVolume = Number(rawRow.total_volume_usdc);
  const dateStart = rawRow.date_range_start;
  const dateEnd = rawRow.date_range_end;
  const distinctTokens = Number(rawRow.distinct_token_ids);

  console.log(`  Total Fills: ${totalFills.toLocaleString()}`);
  console.log(`  Total Volume: $${totalVolume.toFixed(2)}`);
  console.log(`  Date Range: ${dateStart} to ${dateEnd}`);
  console.log(`  Distinct Token IDs: ${distinctTokens}`);

  // -------------------------------------------------------------------------
  // STAGE 2: Role breakdown (maker vs taker)
  // -------------------------------------------------------------------------
  console.log('\nSTAGE 2: Role Breakdown (Maker vs Taker)...');

  const roleBreakdownQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(role) as role,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      role,
      count() as fills,
      sum(abs(usdc)) as volume_usdc
    FROM deduped
    GROUP BY role
    ORDER BY role
  `;

  const roleResult = await clickhouse.query({ query: roleBreakdownQuery, format: 'JSONEachRow' });
  const roleRows = (await roleResult.json()) as any[];

  let makerFills = 0;
  let takerFills = 0;
  let makerVolume = 0;
  let takerVolume = 0;

  for (const row of roleRows) {
    const fills = Number(row.fills);
    const volume = Number(row.volume_usdc);
    if (row.role === 'maker') {
      makerFills = fills;
      makerVolume = volume;
      console.log(`  Maker Fills: ${fills.toLocaleString()} ($${volume.toFixed(2)})`);
    } else if (row.role === 'taker') {
      takerFills = fills;
      takerVolume = volume;
      console.log(`  Taker Fills: ${fills.toLocaleString()} ($${volume.toFixed(2)})`);
    }
  }

  const makerPct = totalFills > 0 ? ((makerFills / totalFills) * 100).toFixed(1) : '0.0';
  const takerPct = totalFills > 0 ? ((takerFills / totalFills) * 100).toFixed(1) : '0.0';
  console.log(`  Maker %: ${makerPct}% | Taker %: ${takerPct}%`);

  // -------------------------------------------------------------------------
  // STAGE 3: Token map join coverage
  // -------------------------------------------------------------------------
  console.log('\nSTAGE 3: Token Map Join Coverage...');

  const tokenMapJoinQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'  -- V18 filters to maker only
      GROUP BY event_id
    )
    SELECT
      countIf(m.token_id_dec IS NOT NULL) as fills_with_token_map,
      countIf(m.token_id_dec IS NULL) as fills_without_token_map
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
  `;

  const tokenMapResult = await clickhouse.query({ query: tokenMapJoinQuery, format: 'JSONEachRow' });
  const tokenMapRow = ((await tokenMapResult.json()) as any[])[0];

  const fillsWithTokenMap = Number(tokenMapRow.fills_with_token_map);
  const fillsWithoutTokenMap = Number(tokenMapRow.fills_without_token_map);
  const tokenMapJoinRate = makerFills > 0 ? (fillsWithTokenMap / makerFills) * 100 : 0;

  console.log(`  Maker Fills with Token Map: ${fillsWithTokenMap.toLocaleString()}`);
  console.log(`  Maker Fills without Token Map: ${fillsWithoutTokenMap.toLocaleString()}`);
  console.log(`  Token Map Join Rate: ${tokenMapJoinRate.toFixed(1)}%`);

  // -------------------------------------------------------------------------
  // STAGE 4: Resolution coverage
  // -------------------------------------------------------------------------
  console.log('\nSTAGE 4: Resolution Coverage...');

  const resolutionCoverageQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT
      countIf(r.condition_id IS NOT NULL) as fills_with_resolutions,
      countIf(r.condition_id IS NULL) as fills_without_resolutions
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
  `;

  const resolutionResult = await clickhouse.query({
    query: resolutionCoverageQuery,
    format: 'JSONEachRow',
  });
  const resolutionRow = ((await resolutionResult.json()) as any[])[0];

  const fillsWithResolutions = Number(resolutionRow.fills_with_resolutions);
  const fillsWithoutResolutions = Number(resolutionRow.fills_without_resolutions);
  const resolutionCoverageRate = fillsWithTokenMap > 0 ? (fillsWithResolutions / fillsWithTokenMap) * 100 : 0;

  console.log(`  Fills with Resolutions: ${fillsWithResolutions.toLocaleString()}`);
  console.log(`  Fills without Resolutions: ${fillsWithoutResolutions.toLocaleString()}`);
  console.log(`  Resolution Coverage Rate: ${resolutionCoverageRate.toFixed(1)}%`);

  // -------------------------------------------------------------------------
  // STAGE 5: Identify excluded token IDs
  // -------------------------------------------------------------------------
  console.log('\nSTAGE 5: Excluded Token IDs (not in token map)...');

  const excludedTokensQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT DISTINCT d.token_id
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    WHERE m.token_id_dec IS NULL
    ORDER BY d.token_id
    LIMIT 20
  `;

  const excludedTokensResult = await clickhouse.query({
    query: excludedTokensQuery,
    format: 'JSONEachRow',
  });
  const excludedTokensRows = (await excludedTokensResult.json()) as any[];
  const excludedTokenIds = excludedTokensRows.map((r) => String(r.token_id));

  if (excludedTokenIds.length > 0) {
    console.log(`  Found ${excludedTokenIds.length} excluded token IDs (showing up to 20):`);
    excludedTokenIds.forEach((tid) => console.log(`    - ${tid}`));
  } else {
    console.log(`  No excluded token IDs found.`);
  }

  // -------------------------------------------------------------------------
  // STAGE 6: Identify unresolved condition IDs
  // -------------------------------------------------------------------------
  console.log('\nSTAGE 6: Unresolved Condition IDs (in token map but not resolved)...');

  const unresolvedConditionsQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT DISTINCT m.condition_id
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    WHERE r.condition_id IS NULL
    ORDER BY m.condition_id
    LIMIT 20
  `;

  const unresolvedResult = await clickhouse.query({
    query: unresolvedConditionsQuery,
    format: 'JSONEachRow',
  });
  const unresolvedRows = (await unresolvedResult.json()) as any[];
  const unresolvedConditionIds = unresolvedRows.map((r) => String(r.condition_id));

  if (unresolvedConditionIds.length > 0) {
    console.log(`  Found ${unresolvedConditionIds.length} unresolved condition IDs (showing up to 20):`);
    unresolvedConditionIds.forEach((cid) => console.log(`    - ${cid}`));
  } else {
    console.log(`  All conditions have resolution data.`);
  }

  // -------------------------------------------------------------------------
  // Return diagnostic result
  // -------------------------------------------------------------------------
  return {
    wallet,
    ui_pnl: uiPnl,
    v18_pnl: 0, // Will be filled in by caller

    total_fills: totalFills,
    total_volume_usdc: totalVolume,
    date_range_start: dateStart,
    date_range_end: dateEnd,
    distinct_token_ids: distinctTokens,

    maker_fills: makerFills,
    taker_fills: takerFills,
    maker_volume_usdc: makerVolume,
    taker_volume_usdc: takerVolume,

    fills_with_token_map: fillsWithTokenMap,
    fills_without_token_map: fillsWithoutTokenMap,
    token_map_join_rate: tokenMapJoinRate,

    fills_with_resolutions: fillsWithResolutions,
    fills_without_resolutions: fillsWithoutResolutions,
    resolution_coverage_rate: resolutionCoverageRate,

    excluded_token_ids: excludedTokenIds,
    unresolved_condition_ids: unresolvedConditionIds,
  };
}

async function main() {
  const wallets: Array<{ address: string; uiPnl: number }> = [
    { address: '0x222adc4302f58fe679f5212cf11344d29c0d103c', uiPnl: 520.0 },
    { address: '0x0e5f632cdfb0f5a22d22331fd81246f452dccf38', uiPnl: -399.79 },
  ];

  const results: DiagnosticResult[] = [];

  for (const { address, uiPnl } of wallets) {
    const result = await diagnoseWallet(address, uiPnl);
    results.push(result);
  }

  // -------------------------------------------------------------------------
  // Summary table
  // -------------------------------------------------------------------------
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY TABLE');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Wallet                                      | UI PnL   | Total Fills | Maker % | Token Map % | Resolution %');
  console.log('-'.repeat(120));

  for (const r of results) {
    const shortWallet = r.wallet.slice(0, 10) + '...' + r.wallet.slice(-4);
    const makerPct = r.total_fills > 0 ? ((r.maker_fills / r.total_fills) * 100).toFixed(0) : '0';
    const tokenMapPct = r.token_map_join_rate.toFixed(0);
    const resolutionPct = r.resolution_coverage_rate.toFixed(0);

    console.log(
      `${shortWallet.padEnd(43)} | ${r.ui_pnl.toFixed(2).padStart(8)} | ${r.total_fills.toString().padStart(11)} | ${makerPct.padStart(7)}% | ${tokenMapPct.padStart(11)}% | ${resolutionPct.padStart(12)}%`
    );
  }

  console.log('\n');

  // -------------------------------------------------------------------------
  // Key findings
  // -------------------------------------------------------------------------
  console.log(`${'='.repeat(80)}`);
  console.log('KEY FINDINGS');
  console.log(`${'='.repeat(80)}\n`);

  for (const r of results) {
    console.log(`Wallet: ${r.wallet}`);

    // Check if maker-only filter is the issue
    const takerPct = r.total_fills > 0 ? ((r.taker_fills / r.total_fills) * 100).toFixed(1) : '0.0';
    if (r.taker_fills > r.maker_fills) {
      console.log(`  ⚠️  TAKER-HEAVY: ${takerPct}% of fills are taker trades (V18 ignores these)`);
      console.log(`      Taker Volume: $${r.taker_volume_usdc.toFixed(2)}`);
      console.log(`      Maker Volume: $${r.maker_volume_usdc.toFixed(2)}`);
    }

    // Check token map join failures
    if (r.token_map_join_rate < 95) {
      console.log(`  ⚠️  TOKEN MAP GAPS: ${r.fills_without_token_map} fills missing token map data`);
      console.log(`      Join Rate: ${r.token_map_join_rate.toFixed(1)}%`);
    }

    // Check resolution coverage
    if (r.resolution_coverage_rate < 50) {
      console.log(`  ⚠️  LOW RESOLUTION COVERAGE: ${r.resolution_coverage_rate.toFixed(1)}% of markets resolved`);
      console.log(`      Unresolved Fills: ${r.fills_without_resolutions}`);
    }

    console.log('');
  }

  console.log(`${'='.repeat(80)}`);
  console.log('RECOMMENDED FIXES');
  console.log(`${'='.repeat(80)}\n`);

  console.log('1. V18 filters to role = "maker" only for UI parity.');
  console.log('   - If wallets are taker-heavy, V18 will undercount PnL.');
  console.log('   - Consider creating V19 with configurable role filter.\n');

  console.log('2. Token map join failures indicate missing token_ids in pm_token_to_condition_map_v3.');
  console.log('   - Run token map backfill for missing token_ids.');
  console.log('   - Check if token_ids are in decimal format (not hex).\n');

  console.log('3. Low resolution coverage is expected for active traders.');
  console.log('   - Unrealized PnL should capture unresolved markets.');
  console.log('   - Verify mark_price calculation (currently hardcoded to 0.5).\n');
}

main()
  .then(() => {
    console.log('Diagnostic complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
