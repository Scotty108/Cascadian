/**
 * Build CLOB-Only Candidate Pool (Two-Stage Funnel)
 *
 * Stage A: Fast ClickHouse prefilter with openPositionsApprox
 *          - CLOB-only (no split/merge events)
 *          - openPositionsApprox <= 50
 *          - clobEvents 20-1000
 *          - Large random sample (1200 wallets)
 *
 * Stage B: V29 confirmation with concurrency + timeout
 *          - Per-wallet timeout to skip pathological wallets
 *          - Confirms CLOB_ONLY classification
 *          - High-signal filters: |PnL| >= $500, openPositions <= 50, events >= 20
 *          - Stops at 150 candidates
 *
 * Output: tmp/clob_only_candidates_v2.json
 *
 * Usage: npx tsx scripts/pnl/build-clob-only-candidates.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import * as fs from 'fs';
import * as path from 'path';

interface PrefilterRow {
  wallet: string;
  clob_events: string;
  ctf_events: string;
  redemption_events: string;
  open_positions_approx: string;
}

interface ClobOnlyCandidate {
  wallet: string;
  // From ClickHouse prefilter
  chClobEvents: number;
  chCtfEvents: number;
  chRedemptionEvents: number;
  chOpenPositionsApprox: number;
  // From V29 engine
  v29OpenPositions: number;
  v29EventsProcessed: number;
  v29UiParityPnl: number;
  v29RealizedPnl: number;
  v29WalletType: string;
  v29ClobEvents: number;
  v29SplitEvents: number;
  v29MergeEvents: number;
  v29RedemptionEvents: number;
}

interface CandidatesOutput {
  metadata: {
    generated_at: string;
    source: string;
    stage_a_prefilter: {
      min_clob_events: number;
      max_clob_events: number;
      max_open_positions_approx: number;
      require_no_ctf: boolean;
      sample_size: number;
    };
    stage_b_v29: {
      concurrency: number;
      target_candidates: number;
      timeout_ms: number;
      min_abs_pnl: number;
      max_open_positions: number;
      min_events_processed: number;
    };
    prefilter_wallet_count: number;
    v29_processed_count: number;
    v29_confirmed_count: number;
    v29_timeout_count: number;
    v29_error_count: number;
  };
  candidates: ClobOnlyCandidate[];
}

// Timeout wrapper for V29 calls
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    ),
  ]);
}

async function main() {
  console.log('=== Build CLOB-Only Candidate Pool (Two-Stage Funnel) ===\n');

  // Configuration - increased sample and added filters
  const TARGET_CANDIDATES = 150;
  const PREFILTER_SAMPLE = 1200;
  const CONCURRENCY = 3;  // Lower concurrency to avoid overwhelming ClickHouse
  const MIN_CLOB_EVENTS = 20;
  const MAX_CLOB_EVENTS = 500;  // Lower max to avoid slow wallets
  const MAX_OPEN_POSITIONS_APPROX = 50;
  const V29_TIMEOUT_MS = 30000;  // 30s timeout

  // Stage B high-signal filters
  const MAX_OPEN_POSITIONS = 50;
  const MIN_ABS_PNL = 500;
  const MIN_EVENTS_PROCESSED = 20;

  // =========================================================================
  // Stage A: Fast ClickHouse Prefilter
  // =========================================================================
  console.log('Stage A: ClickHouse Prefilter');
  console.log(`  - CLOB events: ${MIN_CLOB_EVENTS}-${MAX_CLOB_EVENTS}`);
  console.log(`  - Open positions approx: <= ${MAX_OPEN_POSITIONS_APPROX}`);
  console.log(`  - No CTF events (split/merge)`);
  console.log(`  - Sample size: ${PREFILTER_SAMPLE} random wallets\n`);

  // Simpler prefilter - just query for CLOB-only wallets without position estimate
  // This is much faster as it doesn't require double aggregation
  const prefilterQuery = `
    SELECT
      wallet_address as wallet,
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type IN ('PositionSplit', 'PositionsMerge')) as ctf_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events,
      0 as open_positions_approx
    FROM pm_unified_ledger_v8_tbl
    GROUP BY wallet_address
    HAVING
      ctf_events = 0
      AND clob_events >= ${MIN_CLOB_EVENTS}
      AND clob_events <= ${MAX_CLOB_EVENTS}
    ORDER BY rand()
    LIMIT ${PREFILTER_SAMPLE}
  `;

  console.log('  Running prefilter query...');
  const prefilterStart = Date.now();

  const prefilterResult = await clickhouse.query({
    query: prefilterQuery,
    format: 'JSONEachRow',
  });

  const prefilterRows: PrefilterRow[] = await prefilterResult.json();
  const prefilterElapsed = Date.now() - prefilterStart;

  console.log(`  Found ${prefilterRows.length} wallets in ${(prefilterElapsed / 1000).toFixed(1)}s\n`);

  // =========================================================================
  // Stage B: V29 Confirmation with Concurrency + Timeout
  // =========================================================================
  console.log('Stage B: V29 Confirmation');
  console.log(`  - Concurrency: ${CONCURRENCY}`);
  console.log(`  - Target: ${TARGET_CANDIDATES} candidates`);
  console.log(`  - Timeout: ${V29_TIMEOUT_MS}ms per wallet`);
  console.log(`  - Filters: |PnL| >= $${MIN_ABS_PNL}, openPositions <= ${MAX_OPEN_POSITIONS}, events >= ${MIN_EVENTS_PROCESSED}\n`);

  const candidates: ClobOnlyCandidate[] = [];
  let processed = 0;
  let errors = 0;
  let timeouts = 0;
  let skippedFilter = 0;

  const v29Start = Date.now();

  // Process with concurrency but stop when we have enough candidates
  for (let i = 0; i < prefilterRows.length && candidates.length < TARGET_CANDIDATES; i += CONCURRENCY) {
    const batch = prefilterRows.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async (row) => {
        if (candidates.length >= TARGET_CANDIDATES) return null;

        try {
          const v29Result = await withTimeout(
            calculateV29PnL(row.wallet, {
              inventoryGuard: true,
              valuationMode: 'ui',
            }),
            V29_TIMEOUT_MS
          );

          processed++;

          // Confirm CLOB-only classification from V29
          const isClobOnly =
            v29Result.walletEventCounts.splitEvents === 0 &&
            v29Result.walletEventCounts.mergeEvents === 0 &&
            v29Result.walletEventCounts.clobEvents > 0;

          // High-signal filters
          const meetsPositionCriteria = v29Result.openPositions <= MAX_OPEN_POSITIONS;
          const meetsPnlCriteria = Math.abs(v29Result.uiParityPnl) >= MIN_ABS_PNL;
          const meetsEventCriteria = v29Result.eventsProcessed >= MIN_EVENTS_PROCESSED;

          if (isClobOnly && meetsPositionCriteria && meetsPnlCriteria && meetsEventCriteria) {
            return {
              wallet: row.wallet,
              chClobEvents: parseInt(row.clob_events),
              chCtfEvents: parseInt(row.ctf_events),
              chRedemptionEvents: parseInt(row.redemption_events),
              chOpenPositionsApprox: parseInt(row.open_positions_approx),
              v29OpenPositions: v29Result.openPositions,
              v29EventsProcessed: v29Result.eventsProcessed,
              v29UiParityPnl: v29Result.uiParityPnl,
              v29RealizedPnl: v29Result.realizedPnl,
              v29WalletType: 'CLOB_ONLY',
              v29ClobEvents: v29Result.walletEventCounts.clobEvents,
              v29SplitEvents: v29Result.walletEventCounts.splitEvents,
              v29MergeEvents: v29Result.walletEventCounts.mergeEvents,
              v29RedemptionEvents: v29Result.walletEventCounts.redemptionEvents,
            };
          }

          skippedFilter++;
          return null;
        } catch (e) {
          const errMsg = (e as Error).message;
          if (errMsg.includes('timeout')) {
            timeouts++;
          } else {
            errors++;
          }
          processed++;
          return null;
        }
      })
    );

    // Collect valid candidates
    for (const result of batchResults) {
      if (result && candidates.length < TARGET_CANDIDATES) {
        candidates.push(result);
        console.log(
          `  [${candidates.length}/${TARGET_CANDIDATES}] ${result.wallet.slice(0, 12)}... | ` +
            `PnL: $${result.v29UiParityPnl.toFixed(2)} | ` +
            `Pos: ${result.v29OpenPositions} | ` +
            `CLOB: ${result.v29ClobEvents}`
        );
      }
    }

    // Progress update every batch
    const elapsed = (Date.now() - v29Start) / 1000;
    const rate = processed / Math.max(elapsed, 0.1);
    if (processed % 24 === 0 || candidates.length >= TARGET_CANDIDATES) {
      console.log(
        `  [Progress] ${processed} processed | ${candidates.length} found | ` +
          `${skippedFilter} filtered | ${timeouts} timeout | ${errors} error | ` +
          `${rate.toFixed(1)} w/s`
      );
    }
  }

  const v29Elapsed = Date.now() - v29Start;
  console.log(`\n  V29 stage completed in ${(v29Elapsed / 1000).toFixed(1)}s`);
  console.log(`  Processed: ${processed}, Found: ${candidates.length}, Filtered: ${skippedFilter}`);
  console.log(`  Timeouts: ${timeouts}, Errors: ${errors}\n`);

  // =========================================================================
  // Write Output
  // =========================================================================
  console.log('Writing output...\n');

  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const output: CandidatesOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'pm_unified_ledger_v8_tbl + V29 engine (two-stage funnel)',
      stage_a_prefilter: {
        min_clob_events: MIN_CLOB_EVENTS,
        max_clob_events: MAX_CLOB_EVENTS,
        max_open_positions_approx: MAX_OPEN_POSITIONS_APPROX,
        require_no_ctf: true,
        sample_size: PREFILTER_SAMPLE,
      },
      stage_b_v29: {
        concurrency: CONCURRENCY,
        target_candidates: TARGET_CANDIDATES,
        timeout_ms: V29_TIMEOUT_MS,
        min_abs_pnl: MIN_ABS_PNL,
        max_open_positions: MAX_OPEN_POSITIONS,
        min_events_processed: MIN_EVENTS_PROCESSED,
      },
      prefilter_wallet_count: prefilterRows.length,
      v29_processed_count: processed,
      v29_confirmed_count: candidates.length,
      v29_timeout_count: timeouts,
      v29_error_count: errors,
    },
    candidates,
  };

  const outputPath = path.join(tmpDir, 'clob_only_candidates_v2.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('=== SUMMARY ===\n');
  console.log(`Stage A (prefilter):    ${prefilterRows.length} wallets in ${(prefilterElapsed / 1000).toFixed(1)}s`);
  console.log(`Stage B (V29):          ${candidates.length} candidates in ${(v29Elapsed / 1000).toFixed(1)}s`);
  console.log(`Output:                 ${outputPath}`);

  // PnL distribution
  const pnlBins = {
    loss_large: candidates.filter((c) => c.v29UiParityPnl < -5000).length,
    loss_medium: candidates.filter((c) => c.v29UiParityPnl >= -5000 && c.v29UiParityPnl < -1000).length,
    loss_small: candidates.filter((c) => c.v29UiParityPnl >= -1000 && c.v29UiParityPnl < -500).length,
    gain_small: candidates.filter((c) => c.v29UiParityPnl >= 500 && c.v29UiParityPnl < 1000).length,
    gain_medium: candidates.filter((c) => c.v29UiParityPnl >= 1000 && c.v29UiParityPnl < 5000).length,
    gain_large: candidates.filter((c) => c.v29UiParityPnl >= 5000).length,
  };

  console.log('\nPnL distribution:');
  console.log(`  Large loss (<-$5K):      ${pnlBins.loss_large}`);
  console.log(`  Medium loss (-$5K~-$1K): ${pnlBins.loss_medium}`);
  console.log(`  Small loss (-$1K~-$500): ${pnlBins.loss_small}`);
  console.log(`  Small gain ($500~$1K):   ${pnlBins.gain_small}`);
  console.log(`  Medium gain ($1K~$5K):   ${pnlBins.gain_medium}`);
  console.log(`  Large gain (>$5K):       ${pnlBins.gain_large}`);

  // Position count distribution
  const posBins = {
    '0': candidates.filter((c) => c.v29OpenPositions === 0).length,
    '1-10': candidates.filter((c) => c.v29OpenPositions >= 1 && c.v29OpenPositions <= 10).length,
    '11-25': candidates.filter((c) => c.v29OpenPositions > 10 && c.v29OpenPositions <= 25).length,
    '26-50': candidates.filter((c) => c.v29OpenPositions > 25 && c.v29OpenPositions <= 50).length,
  };

  console.log('\nPosition count distribution:');
  console.log(`  0:      ${posBins['0']}`);
  console.log(`  1-10:   ${posBins['1-10']}`);
  console.log(`  11-25:  ${posBins['11-25']}`);
  console.log(`  26-50:  ${posBins['26-50']}`);

  if (candidates.length < TARGET_CANDIDATES) {
    console.log(`\nWARNING: Only found ${candidates.length}/${TARGET_CANDIDATES} candidates.`);
    console.log('Consider: increasing PREFILTER_SAMPLE, relaxing filters, or checking data quality.');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
