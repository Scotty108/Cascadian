/**
 * Build CLOB-Only Candidate Pool - Fast Version
 *
 * Pure ClickHouse approach: Single-pass aggregation to find CLOB-only wallets
 * with high-signal metrics. No per-wallet V29 calls during candidate selection.
 *
 * Output: tmp/clob_only_candidates_fast.json
 *
 * Usage: npx tsx scripts/pnl/build-clob-only-candidates-fast.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

interface ClobOnlyCandidate {
  wallet: string;
  clobEvents: number;
  redemptionEvents: number;
  cashFlow: number;
  conditionCount: number;
  openPositionsApprox: number;
}

interface CandidatesOutput {
  metadata: {
    generated_at: string;
    source: string;
    query_params: {
      min_clob_events: number;
      max_clob_events: number;
      min_abs_cash_flow: number;
      max_open_positions_approx: number;
      target_count: number;
    };
    query_time_ms: number;
    total_candidates: number;
  };
  candidates: ClobOnlyCandidate[];
}

async function main() {
  console.log('=== Build CLOB-Only Candidate Pool (Fast) ===\n');

  // Configuration
  const MIN_CLOB_EVENTS = 20;
  const MAX_CLOB_EVENTS = 500;
  const MIN_ABS_CASH_FLOW = 500; // $500 minimum PnL signal
  const MAX_OPEN_POSITIONS_APPROX = 50;
  const TARGET_COUNT = 80; // Get 80 to allow for some filtering

  console.log('Configuration:');
  console.log(`  CLOB events: ${MIN_CLOB_EVENTS}-${MAX_CLOB_EVENTS}`);
  console.log(`  Min |cash_flow|: $${MIN_ABS_CASH_FLOW}`);
  console.log(`  Max open positions (approx): ${MAX_OPEN_POSITIONS_APPROX}`);
  console.log(`  Target count: ${TARGET_COUNT}\n`);

  // Single-pass aggregation with position approximation
  const query = `
    WITH
      -- Per-condition aggregation for position tracking
      per_condition AS (
        SELECT
          wallet_address,
          condition_id,
          sum(token_delta) AS net_tokens,
          sum(usdc_delta) AS condition_cash_flow,
          countIf(source_type = 'CLOB') AS condition_clob_events,
          countIf(source_type IN ('PositionSplit', 'PositionsMerge')) AS condition_ctf_events,
          countIf(source_type = 'PayoutRedemption') AS condition_redemption_events
        FROM pm_unified_ledger_v8_tbl
        GROUP BY wallet_address, condition_id
      ),
      -- Wallet-level aggregation
      wallet_stats AS (
        SELECT
          wallet_address,
          sum(condition_clob_events) AS clob_events,
          sum(condition_ctf_events) AS ctf_events,
          sum(condition_redemption_events) AS redemption_events,
          sum(condition_cash_flow) AS cash_flow,
          count() AS condition_count,
          -- Open positions = conditions with non-zero net tokens
          countIf(abs(net_tokens) > 0.001) AS open_positions_approx
        FROM per_condition
        GROUP BY wallet_address
      )
    SELECT
      wallet_address AS wallet,
      clob_events,
      redemption_events,
      cash_flow,
      condition_count,
      open_positions_approx
    FROM wallet_stats
    WHERE
      ctf_events = 0                           -- CLOB-only
      AND clob_events >= ${MIN_CLOB_EVENTS}   -- Minimum activity
      AND clob_events <= ${MAX_CLOB_EVENTS}   -- Not pathological
      AND abs(cash_flow) >= ${MIN_ABS_CASH_FLOW}  -- Material PnL
      AND open_positions_approx <= ${MAX_OPEN_POSITIONS_APPROX}  -- Not too complex
    ORDER BY rand()
    LIMIT ${TARGET_COUNT}
  `;

  console.log('Running ClickHouse query...');
  const start = Date.now();

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  });

  interface QueryRow {
    wallet: string;
    clob_events: string;
    redemption_events: string;
    cash_flow: string;
    condition_count: string;
    open_positions_approx: string;
  }

  const rows: QueryRow[] = await result.json();
  const elapsed = Date.now() - start;

  console.log(`Query returned ${rows.length} candidates in ${(elapsed / 1000).toFixed(1)}s\n`);

  // Transform to output format
  const candidates: ClobOnlyCandidate[] = rows.map((r) => ({
    wallet: r.wallet,
    clobEvents: parseInt(r.clob_events),
    redemptionEvents: parseInt(r.redemption_events),
    cashFlow: parseFloat(r.cash_flow),
    conditionCount: parseInt(r.condition_count),
    openPositionsApprox: parseInt(r.open_positions_approx),
  }));

  // Show sample
  console.log('=== Sample Candidates ===');
  for (let i = 0; i < Math.min(10, candidates.length); i++) {
    const c = candidates[i];
    console.log(
      `  ${c.wallet.slice(0, 12)}... | Cash: $${c.cashFlow.toFixed(2).padStart(10)} | ` +
        `CLOB: ${c.clobEvents.toString().padStart(3)} | Pos: ${c.openPositionsApprox.toString().padStart(2)}`
    );
  }

  // Distribution stats
  const gains = candidates.filter((c) => c.cashFlow > 0);
  const losses = candidates.filter((c) => c.cashFlow < 0);
  console.log(`\nDistribution: ${gains.length} positive, ${losses.length} negative`);

  // PnL ranges
  const pnlBins = {
    loss_large: candidates.filter((c) => c.cashFlow < -5000).length,
    loss_medium: candidates.filter((c) => c.cashFlow >= -5000 && c.cashFlow < -1000).length,
    loss_small: candidates.filter((c) => c.cashFlow >= -1000 && c.cashFlow < -500).length,
    gain_small: candidates.filter((c) => c.cashFlow >= 500 && c.cashFlow < 1000).length,
    gain_medium: candidates.filter((c) => c.cashFlow >= 1000 && c.cashFlow < 5000).length,
    gain_large: candidates.filter((c) => c.cashFlow >= 5000).length,
  };

  console.log('\nPnL distribution:');
  console.log(`  Large loss (<-$5K):      ${pnlBins.loss_large}`);
  console.log(`  Medium loss (-$5K~-$1K): ${pnlBins.loss_medium}`);
  console.log(`  Small loss (-$1K~-$500): ${pnlBins.loss_small}`);
  console.log(`  Small gain ($500~$1K):   ${pnlBins.gain_small}`);
  console.log(`  Medium gain ($1K~$5K):   ${pnlBins.gain_medium}`);
  console.log(`  Large gain (>$5K):       ${pnlBins.gain_large}`);

  // Position distribution
  const posBins = {
    '0': candidates.filter((c) => c.openPositionsApprox === 0).length,
    '1-10': candidates.filter((c) => c.openPositionsApprox >= 1 && c.openPositionsApprox <= 10).length,
    '11-25': candidates.filter((c) => c.openPositionsApprox > 10 && c.openPositionsApprox <= 25).length,
    '26-50': candidates.filter((c) => c.openPositionsApprox > 25 && c.openPositionsApprox <= 50).length,
  };

  console.log('\nPosition count distribution:');
  console.log(`  0:      ${posBins['0']}`);
  console.log(`  1-10:   ${posBins['1-10']}`);
  console.log(`  11-25:  ${posBins['11-25']}`);
  console.log(`  26-50:  ${posBins['26-50']}`);

  // Write output
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const output: CandidatesOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'pm_unified_ledger_v8_tbl (single-pass aggregation)',
      query_params: {
        min_clob_events: MIN_CLOB_EVENTS,
        max_clob_events: MAX_CLOB_EVENTS,
        min_abs_cash_flow: MIN_ABS_CASH_FLOW,
        max_open_positions_approx: MAX_OPEN_POSITIONS_APPROX,
        target_count: TARGET_COUNT,
      },
      query_time_ms: elapsed,
      total_candidates: candidates.length,
    },
    candidates,
  };

  const outputPath = path.join(tmpDir, 'clob_only_candidates_fast.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n=== SUMMARY ===`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Query time: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`Output: ${outputPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
