/**
 * Validate Synthetic Realized PnL vs UI Implied Realized
 *
 * DEFINITIONS (locked):
 * - pnl_synth_realized: cash_flow + final_tokens * resolution_price (for resolved markets only)
 * - pnl_wac_realized: V11 style sell-based realized using weighted average cost
 * - open_value: sum(currentValue) from Polymarket Data API for unresolved + unredeemed positions
 * - ui_implied_realized: ui_total_pnl - open_value
 *
 * VALIDATION TARGET:
 * pnl_synth_realized should match ui_implied_realized within tolerance
 *
 * SAMPLING:
 * - 200 wallets stratified by: high PnL, medium PnL, low PnL, near-zero
 * - Plus negative controls (flagged external inventory wallets)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

// Tolerance thresholds
const TOLERANCE_PASS = 0.05; // 5% = PASS
const TOLERANCE_WARN = 0.20; // 20% = WARN, else FAIL

interface SampleWallet {
  wallet: string;
  stratum: 'high_pnl' | 'medium_pnl' | 'low_pnl' | 'near_zero' | 'negative_control';
  synth_realized: number;
  resolved_positions: number;
  has_external_inventory: number;
}

interface ValidationResult {
  wallet: string;
  stratum: string;
  synth_realized: number;
  ui_total_pnl: number | null;
  open_value: number | null;
  ui_implied_realized: number | null;
  delta: number | null;
  pct_diff: number | null;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  error?: string;
}

interface RowGrowthAudit {
  wallet: string;
  dedup_rows: number;
  after_token_map_rows: number;
  null_condition_count: number;
  null_outcome_count: number;
  after_resolution_rows: number;
  null_resolution_count: number;
  resolved_positions_count: number;
}

async function getSampleWallets(count: number = 200): Promise<SampleWallet[]> {
  const perStratum = Math.floor(count / 5);

  // High PnL (top performers)
  const highPnl = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl as synth_realized, resolved_positions, 0 as has_external_inventory
      FROM pm_wallet_metrics_trusted_v1
      WHERE realized_pnl > 1000 AND resolved_positions >= 5
      ORDER BY realized_pnl DESC
      LIMIT ${perStratum}
    `,
    format: 'JSONEachRow'
  });

  // Medium PnL
  const mediumPnl = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl as synth_realized, resolved_positions, 0 as has_external_inventory
      FROM pm_wallet_metrics_trusted_v1
      WHERE realized_pnl BETWEEN 100 AND 1000 AND resolved_positions >= 5
      ORDER BY rand()
      LIMIT ${perStratum}
    `,
    format: 'JSONEachRow'
  });

  // Low PnL (small positive or negative)
  const lowPnl = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl as synth_realized, resolved_positions, 0 as has_external_inventory
      FROM pm_wallet_metrics_trusted_v1
      WHERE realized_pnl BETWEEN -100 AND 100 AND resolved_positions >= 5
      ORDER BY rand()
      LIMIT ${perStratum}
    `,
    format: 'JSONEachRow'
  });

  // Near zero (break-even traders)
  const nearZero = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl as synth_realized, resolved_positions, 0 as has_external_inventory
      FROM pm_wallet_metrics_trusted_v1
      WHERE abs(realized_pnl) < 10 AND resolved_positions >= 3
      ORDER BY rand()
      LIMIT ${perStratum}
    `,
    format: 'JSONEachRow'
  });

  // Negative controls (wallets WITH external inventory - should have higher error rates)
  const negativeControls = await clickhouse.query({
    query: `
      SELECT wallet, 0 as synth_realized, 0 as resolved_positions, 1 as has_external_inventory
      FROM pm_wallet_trusted_cohort_v1
      WHERE has_external_inventory = 1
        AND fill_count >= 50
        AND volume_usdc >= 1000
      ORDER BY rand()
      LIMIT ${perStratum}
    `,
    format: 'JSONEachRow'
  });

  const results: SampleWallet[] = [];

  for (const row of await highPnl.json() as any[]) {
    results.push({ ...row, stratum: 'high_pnl', synth_realized: Number(row.synth_realized) });
  }
  for (const row of await mediumPnl.json() as any[]) {
    results.push({ ...row, stratum: 'medium_pnl', synth_realized: Number(row.synth_realized) });
  }
  for (const row of await lowPnl.json() as any[]) {
    results.push({ ...row, stratum: 'low_pnl', synth_realized: Number(row.synth_realized) });
  }
  for (const row of await nearZero.json() as any[]) {
    results.push({ ...row, stratum: 'near_zero', synth_realized: Number(row.synth_realized) });
  }
  for (const row of await negativeControls.json() as any[]) {
    results.push({ ...row, stratum: 'negative_control', synth_realized: Number(row.synth_realized) });
  }

  return results;
}

async function fetchUiPnl(wallet: string): Promise<{ totalPnl: number; openValue: number } | null> {
  // Fetch from Polymarket Data API
  try {
    const url = `https://data-api.polymarket.com/profile/${wallet}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as any;

    // Extract total PnL and open value
    const totalPnl = Number(data.pnl?.total || data.totalPnL || 0);

    // Fetch positions for open value
    const posUrl = `https://data-api.polymarket.com/positions?user=${wallet}`;
    const posResponse = await fetch(posUrl, {
      headers: { 'Accept': 'application/json' }
    });

    let openValue = 0;
    if (posResponse.ok) {
      const positions = await posResponse.json() as any[];
      openValue = positions.reduce((sum, pos) => {
        return sum + Number(pos.currentValue || 0);
      }, 0);
    }

    return { totalPnl, openValue };
  } catch (e) {
    return null;
  }
}

async function runRowGrowthAudit(wallet: string): Promise<RowGrowthAudit> {
  // Step 1: Dedup rows
  const dedupResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_dedup_v2_tbl WHERE trader_wallet = '${wallet}'`,
    format: 'JSONEachRow'
  });
  const dedupRows = Number((await dedupResult.json() as any[])[0]?.cnt || 0);

  // Step 2: After token map join
  const tokenMapResult = await clickhouse.query({
    query: `
      SELECT
        count() as rows_after,
        countIf(m.condition_id IS NULL OR m.condition_id = '') as null_condition,
        countIf(m.outcome_index IS NULL) as null_outcome
      FROM pm_trader_events_dedup_v2_tbl e
      LEFT JOIN pm_token_to_condition_map_v5 m ON m.token_id_dec = e.token_id
      WHERE e.trader_wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  const tm = (await tokenMapResult.json() as any[])[0];

  // Step 3: After resolution join (position level)
  const resResult = await clickhouse.query({
    query: `
      SELECT
        count() as position_rows,
        countIf(r.resolved_price IS NULL) as null_resolution
      FROM (
        SELECT
          m.condition_id,
          m.outcome_index
        FROM pm_trader_events_dedup_v2_tbl e
        INNER JOIN pm_token_to_condition_map_v5 m ON m.token_id_dec = e.token_id
        WHERE e.trader_wallet = '${wallet}'
        GROUP BY m.condition_id, m.outcome_index
      ) pos
      LEFT JOIN vw_pm_resolution_prices r
        ON r.condition_id = pos.condition_id AND r.outcome_index = pos.outcome_index
    `,
    format: 'JSONEachRow'
  });
  const res = (await resResult.json() as any[])[0];

  // Resolved positions used in synth formula
  const resolvedResult = await clickhouse.query({
    query: `
      SELECT count() as resolved_count
      FROM (
        SELECT m.condition_id, m.outcome_index
        FROM pm_trader_events_dedup_v2_tbl e
        INNER JOIN pm_token_to_condition_map_v5 m ON m.token_id_dec = e.token_id
        INNER JOIN vw_pm_resolution_prices r
          ON r.condition_id = m.condition_id AND r.outcome_index = m.outcome_index
        WHERE e.trader_wallet = '${wallet}'
        GROUP BY m.condition_id, m.outcome_index
      )
    `,
    format: 'JSONEachRow'
  });
  const resolved = (await resolvedResult.json() as any[])[0];

  return {
    wallet,
    dedup_rows: dedupRows,
    after_token_map_rows: Number(tm?.rows_after || 0),
    null_condition_count: Number(tm?.null_condition || 0),
    null_outcome_count: Number(tm?.null_outcome || 0),
    after_resolution_rows: Number(res?.position_rows || 0),
    null_resolution_count: Number(res?.null_resolution || 0),
    resolved_positions_count: Number(resolved?.resolved_count || 0)
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('VALIDATE SYNTHETIC REALIZED VS UI IMPLIED REALIZED');
  console.log('='.repeat(80));

  console.log('\nDEFINITIONS:');
  console.log('  pnl_synth_realized: cash_flow + final_tokens * resolution_price (resolved only)');
  console.log('  ui_implied_realized: ui_total_pnl - open_value');
  console.log('  open_value: sum(currentValue) from Polymarket positions API');
  console.log('\nTOLERANCES:');
  console.log(`  PASS: <${TOLERANCE_PASS * 100}% difference`);
  console.log(`  WARN: ${TOLERANCE_PASS * 100}-${TOLERANCE_WARN * 100}% difference`);
  console.log(`  FAIL: >${TOLERANCE_WARN * 100}% difference`);

  // Get stratified sample
  console.log('\n' + '='.repeat(80));
  console.log('SAMPLING WALLETS');
  console.log('='.repeat(80));

  const sampleWallets = await getSampleWallets(200);
  console.log(`\nSampled ${sampleWallets.length} wallets:`);

  const stratumCounts: Record<string, number> = {};
  for (const w of sampleWallets) {
    stratumCounts[w.stratum] = (stratumCounts[w.stratum] || 0) + 1;
  }
  for (const [stratum, count] of Object.entries(stratumCounts)) {
    console.log(`  ${stratum}: ${count}`);
  }

  // Validate each wallet
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION (this may take several minutes for API calls)');
  console.log('='.repeat(80));

  const results: ValidationResult[] = [];
  const failedWallets: string[] = [];

  for (let i = 0; i < sampleWallets.length; i++) {
    const sample = sampleWallets[i];
    const progress = `[${i + 1}/${sampleWallets.length}]`;

    // Fetch UI data
    const uiData = await fetchUiPnl(sample.wallet);

    if (!uiData) {
      results.push({
        wallet: sample.wallet,
        stratum: sample.stratum,
        synth_realized: sample.synth_realized,
        ui_total_pnl: null,
        open_value: null,
        ui_implied_realized: null,
        delta: null,
        pct_diff: null,
        status: 'SKIP',
        error: 'API fetch failed'
      });
      continue;
    }

    const uiImplied = uiData.totalPnl - uiData.openValue;
    const delta = sample.synth_realized - uiImplied;
    const pctDiff = uiImplied !== 0 ? Math.abs(delta) / Math.abs(uiImplied) : (delta === 0 ? 0 : 1);

    let status: 'PASS' | 'WARN' | 'FAIL';
    if (pctDiff <= TOLERANCE_PASS) {
      status = 'PASS';
    } else if (pctDiff <= TOLERANCE_WARN) {
      status = 'WARN';
    } else {
      status = 'FAIL';
      failedWallets.push(sample.wallet);
    }

    results.push({
      wallet: sample.wallet,
      stratum: sample.stratum,
      synth_realized: sample.synth_realized,
      ui_total_pnl: uiData.totalPnl,
      open_value: uiData.openValue,
      ui_implied_realized: uiImplied,
      delta,
      pct_diff: pctDiff,
      status
    });

    // Progress indicator
    if ((i + 1) % 20 === 0) {
      console.log(`${progress} Processed ${i + 1} wallets...`);
    }
  }

  // Summary statistics
  console.log('\n' + '='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));

  const validResults = results.filter(r => r.status !== 'SKIP');
  const passCount = results.filter(r => r.status === 'PASS').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const skipCount = results.filter(r => r.status === 'SKIP').length;

  console.log(`\nOVERALL: ${validResults.length} validated, ${skipCount} skipped`);
  console.log(`  PASS (<5%):   ${passCount} (${(passCount / validResults.length * 100).toFixed(1)}%)`);
  console.log(`  WARN (5-20%): ${warnCount} (${(warnCount / validResults.length * 100).toFixed(1)}%)`);
  console.log(`  FAIL (>20%):  ${failCount} (${(failCount / validResults.length * 100).toFixed(1)}%)`);

  // Per-stratum breakdown
  console.log('\nPER-STRATUM:');
  for (const stratum of ['high_pnl', 'medium_pnl', 'low_pnl', 'near_zero', 'negative_control']) {
    const stratumResults = validResults.filter(r => r.stratum === stratum);
    const stratumPass = stratumResults.filter(r => r.status === 'PASS').length;
    console.log(`  ${stratum}: ${stratumPass}/${stratumResults.length} PASS (${(stratumPass / stratumResults.length * 100).toFixed(1)}%)`);
  }

  // Error statistics
  const errors = validResults.map(r => Math.abs(r.delta || 0)).sort((a, b) => a - b);
  const pctErrors = validResults.map(r => r.pct_diff || 0).sort((a, b) => a - b);

  if (errors.length > 0) {
    const p50Idx = Math.floor(errors.length * 0.5);
    const p95Idx = Math.floor(errors.length * 0.95);
    console.log('\nERROR STATISTICS:');
    console.log(`  P50 absolute error: $${errors[p50Idx].toFixed(2)}`);
    console.log(`  P95 absolute error: $${errors[p95Idx].toFixed(2)}`);
    console.log(`  P50 percent error:  ${(pctErrors[p50Idx] * 100).toFixed(1)}%`);
    console.log(`  P95 percent error:  ${(pctErrors[p95Idx] * 100).toFixed(1)}%`);
  }

  // Worst 10 wallets
  console.log('\n' + '='.repeat(80));
  console.log('WORST 10 WALLETS');
  console.log('='.repeat(80));

  const sortedByError = [...validResults]
    .filter(r => r.pct_diff !== null)
    .sort((a, b) => (b.pct_diff || 0) - (a.pct_diff || 0))
    .slice(0, 10);

  console.log('\nwallet       | stratum     | synth    | ui_impl  | delta    | pct_diff | status');
  console.log('-'.repeat(95));

  for (const r of sortedByError) {
    console.log(
      `${r.wallet.slice(0, 10)}... | ${r.stratum.padEnd(11)} | $${r.synth_realized.toFixed(0).padStart(7)} | $${(r.ui_implied_realized || 0).toFixed(0).padStart(7)} | $${(r.delta || 0).toFixed(0).padStart(7)} | ${((r.pct_diff || 0) * 100).toFixed(1).padStart(6)}% | ${r.status}`
    );
  }

  // Row-growth audits for failed wallets
  if (failedWallets.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('ROW-GROWTH AUDITS FOR FAILED WALLETS (first 10)');
    console.log('='.repeat(80));

    for (const wallet of failedWallets.slice(0, 10)) {
      const audit = await runRowGrowthAudit(wallet);
      console.log(`\n${wallet.slice(0, 14)}...:`);
      console.log(`  Dedup rows:          ${audit.dedup_rows}`);
      console.log(`  After token map:     ${audit.after_token_map_rows} (NULL condition: ${audit.null_condition_count}, NULL outcome: ${audit.null_outcome_count})`);
      console.log(`  Position rows:       ${audit.after_resolution_rows} (NULL resolution: ${audit.null_resolution_count})`);
      console.log(`  Resolved positions:  ${audit.resolved_positions_count}`);

      // Check for row growth
      if (audit.after_token_map_rows > audit.dedup_rows) {
        console.log(`  WARNING: Row growth in token map join (${audit.dedup_rows} -> ${audit.after_token_map_rows})`);
      }
      if (audit.null_condition_count > 0) {
        console.log(`  WARNING: ${audit.null_condition_count} events with NULL condition_id`);
      }
      if (audit.null_resolution_count > audit.after_resolution_rows * 0.5) {
        console.log(`  WARNING: High missing resolution rate (${audit.null_resolution_count}/${audit.after_resolution_rows})`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));

  const passRate = passCount / validResults.length;
  if (passRate >= 0.80) {
    console.log('\nVALIDATION PASSED: >=80% of wallets within 5% tolerance');
    console.log('The synth_realized formula is trustworthy for leaderboard ranking.');
  } else if (passRate >= 0.60) {
    console.log('\nVALIDATION MARGINAL: 60-80% pass rate');
    console.log('Formula may be usable but requires investigation of failure cases.');
  } else {
    console.log('\nVALIDATION FAILED: <60% pass rate');
    console.log('The synth_realized formula does NOT match UI implied realized.');
    console.log('Review the row-growth audits above to identify the cause.');
  }
}

main().catch(console.error);
