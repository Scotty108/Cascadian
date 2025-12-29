/**
 * V19 Benchmark with MAKER-ONLY CLOB trades
 *
 * The key insight: V18 uses role='maker' only for CLOB trades.
 * The unified ledger v5 includes both maker and taker, causing 2x inflation.
 *
 * This script tests a V19 variant that:
 * 1. Uses maker-only CLOB trades (like V18)
 * 2. Adds CTF events (PositionSplit, PositionsMerge, PayoutRedemption)
 *
 * This should give us the best of both worlds:
 * - Same CLOB accuracy as V18
 * - Additional CTF event coverage for wallets that use them
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';

interface BenchmarkResult {
  wallet: string;
  ui: { pnl: number; username: string };
  v18: { total_pnl: number };
  total_pnl_error_pct: number;
}

async function calculateV19MakerOnly(wallet: string) {
  // Build V19 from first principles:
  // 1. CLOB: use maker trades only (like V18)
  // 2. CTF: add PositionSplit, PositionsMerge, PayoutRedemption
  const query = `
    WITH
      -- CLOB trades (maker only, deduped)
      clob_trades AS (
        SELECT
          t.event_id,
          m.condition_id,
          m.outcome_index,
          -- Cash delta: buy = negative (outflow), sell = positive (inflow)
          if(t.side = 'buy', -t.usdc, t.usdc) AS usdc_delta,
          -- Token delta: buy = positive, sell = negative
          if(t.side = 'buy', t.tokens, -t.tokens) AS token_delta
        FROM (
          SELECT
            event_id,
            any(side) AS side,
            any(usdc_amount) / 1e6 AS usdc,
            any(token_amount) / 1e6 AS tokens,
            any(token_id) AS token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}')
            AND is_deleted = 0
            AND role = 'maker'  -- KEY: Only maker trades
          GROUP BY event_id
        ) AS t
        LEFT JOIN pm_token_to_condition_map_v3 AS m ON t.token_id = m.token_id_dec
      ),
      -- CTF events (PositionSplit, PositionsMerge, PayoutRedemption)
      ctf_events AS (
        SELECT
          c.id AS event_id,
          c.condition_id,
          0 AS outcome_index,
          CASE
            WHEN c.event_type = 'PositionSplit' THEN -toFloat64OrZero(c.amount_or_payout) / 1e6
            WHEN c.event_type = 'PositionsMerge' THEN toFloat64OrZero(c.amount_or_payout) / 1e6
            WHEN c.event_type = 'PayoutRedemption' THEN toFloat64OrZero(c.amount_or_payout) / 1e6
            ELSE 0
          END AS usdc_delta,
          CASE
            WHEN c.event_type = 'PositionSplit' THEN toFloat64OrZero(c.amount_or_payout) / 1e6
            WHEN c.event_type = 'PositionsMerge' THEN -toFloat64OrZero(c.amount_or_payout) / 1e6
            WHEN c.event_type = 'PayoutRedemption' THEN -toFloat64OrZero(c.amount_or_payout) / 1e6
            ELSE 0
          END AS token_delta
        FROM pm_ctf_events AS c
        WHERE lower(c.user_address) = lower('${wallet}')
          AND c.is_deleted = 0
          AND c.event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
      ),
      -- Combine all events
      all_events AS (
        SELECT event_id, condition_id, outcome_index, usdc_delta, token_delta FROM clob_trades
        UNION ALL
        SELECT event_id, condition_id, outcome_index, usdc_delta, token_delta FROM ctf_events
      ),
      -- Aggregate to position level
      positions AS (
        SELECT
          e.condition_id,
          e.outcome_index,
          sum(e.usdc_delta) AS cash_flow,
          sum(e.token_delta) AS token_flow,
          any(r.payout_numerators) AS payout_numerators
        FROM all_events AS e
        LEFT JOIN pm_condition_resolutions AS r ON e.condition_id = r.condition_id
        GROUP BY e.condition_id, e.outcome_index
      ),
      -- Calculate PnL per position
      position_pnl AS (
        SELECT
          condition_id,
          outcome_index,
          cash_flow,
          token_flow,
          payout_numerators,
          -- Resolution price for this outcome
          if(payout_numerators IS NOT NULL,
             if(JSONExtractInt(payout_numerators, outcome_index + 1) >= 1000, 1,
                JSONExtractInt(payout_numerators, outcome_index + 1)),
             NULL) AS resolution_price,
          -- PnL calculation
          CASE
            WHEN payout_numerators IS NOT NULL THEN
              cash_flow + token_flow * if(JSONExtractInt(payout_numerators, outcome_index + 1) >= 1000, 1, JSONExtractInt(payout_numerators, outcome_index + 1))
            ELSE
              cash_flow + token_flow * 0.5  -- Unrealized: use 0.5 for now
          END AS pnl
        FROM positions
      )
    SELECT
      -- V19 (maker + CTF): realized only
      sum(if(payout_numerators IS NOT NULL, pnl, 0)) AS v19_realized,
      -- V19 (maker + CTF): total (realized + unrealized at 0.5)
      sum(pnl) AS v19_total,
      -- Count positions
      count() AS position_count,
      countIf(payout_numerators IS NOT NULL) AS resolved_count
    FROM position_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return { realized: 0, total: 0, positions: 0, resolved: 0 };
  }

  return {
    realized: Number(rows[0].v19_realized) || 0,
    total: Number(rows[0].v19_total) || 0,
    positions: Number(rows[0].position_count) || 0,
    resolved: Number(rows[0].resolved_count) || 0,
  };
}

async function calculateClobOnlyV19(wallet: string) {
  // Same as above but WITHOUT CTF events - should match V18 exactly
  const query = `
    WITH
      -- CLOB trades (maker only, deduped)
      clob_trades AS (
        SELECT
          t.event_id,
          m.condition_id,
          m.outcome_index,
          if(t.side = 'buy', -t.usdc, t.usdc) AS usdc_delta,
          if(t.side = 'buy', t.tokens, -t.tokens) AS token_delta
        FROM (
          SELECT
            event_id,
            any(side) AS side,
            any(usdc_amount) / 1e6 AS usdc,
            any(token_amount) / 1e6 AS tokens,
            any(token_id) AS token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}')
            AND is_deleted = 0
            AND role = 'maker'
          GROUP BY event_id
        ) AS t
        LEFT JOIN pm_token_to_condition_map_v3 AS m ON t.token_id = m.token_id_dec
      ),
      positions AS (
        SELECT
          t.condition_id,
          t.outcome_index,
          sum(t.usdc_delta) AS cash_flow,
          sum(t.token_delta) AS token_flow,
          any(r.payout_numerators) AS payout_numerators
        FROM clob_trades AS t
        LEFT JOIN pm_condition_resolutions AS r ON t.condition_id = r.condition_id
        GROUP BY t.condition_id, t.outcome_index
      ),
      position_pnl AS (
        SELECT
          condition_id,
          outcome_index,
          cash_flow,
          token_flow,
          payout_numerators,
          if(payout_numerators IS NOT NULL,
             if(JSONExtractInt(payout_numerators, outcome_index + 1) >= 1000, 1, JSONExtractInt(payout_numerators, outcome_index + 1)),
             NULL) AS resolution_price,
          CASE
            WHEN payout_numerators IS NOT NULL THEN
              cash_flow + token_flow * if(JSONExtractInt(payout_numerators, outcome_index + 1) >= 1000, 1, JSONExtractInt(payout_numerators, outcome_index + 1))
            ELSE
              cash_flow + token_flow * 0.5
          END AS pnl
        FROM positions
      )
    SELECT
      sum(if(payout_numerators IS NOT NULL, pnl, 0)) AS v19_realized,
      sum(pnl) AS v19_total
    FROM position_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return { realized: 0, total: 0 };
  }

  return {
    realized: Number(rows[0].v19_realized) || 0,
    total: Number(rows[0].v19_total) || 0,
  };
}

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

async function main() {
  console.log('='.repeat(140));
  console.log('V19 BENCHMARK WITH MAKER-ONLY CLOB TRADES');
  console.log('='.repeat(140));

  // Load benchmark data
  if (!fs.existsSync(REPORT_FILE)) {
    console.log('No benchmark report found at ' + REPORT_FILE);
    return;
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  const benchmarks: Map<string, BenchmarkResult> = new Map();
  for (const r of report.results) {
    benchmarks.set(r.wallet.toLowerCase(), r);
  }

  console.log(`\nAnalyzing ${benchmarks.size} wallets...\n`);

  // Results table header
  console.log(
    'Username       | UI PnL      | V18         | V18 Err | V19CLOB     | CLOBErr | V19+CTF     | CTFErr  | Pos/Res'
  );
  console.log('-'.repeat(120));

  const results: {
    wallet: string;
    username: string;
    ui: number;
    v18: number;
    v18Err: number;
    v19clob: number;
    v19clobErr: number;
    v19ctf: number;
    v19ctfErr: number;
    positions: number;
    resolved: number;
  }[] = [];

  for (const [wallet, benchmark] of benchmarks) {
    const uiPnl = benchmark.ui?.pnl || 0;
    const v18Pnl = benchmark.v18?.total_pnl || 0;
    const username = benchmark.ui?.username || 'Unknown';

    const clobOnly = await calculateClobOnlyV19(wallet);
    const withCtf = await calculateV19MakerOnly(wallet);

    const result = {
      wallet,
      username,
      ui: uiPnl,
      v18: v18Pnl,
      v18Err: errorPct(v18Pnl, uiPnl),
      v19clob: clobOnly.total,
      v19clobErr: errorPct(clobOnly.total, uiPnl),
      v19ctf: withCtf.total,
      v19ctfErr: errorPct(withCtf.total, uiPnl),
      positions: withCtf.positions,
      resolved: withCtf.resolved,
    };

    results.push(result);

    // Print row
    console.log(
      `${result.username.substring(0, 14).padEnd(14)} | ` +
        `$${result.ui.toFixed(2).padStart(9)} | ` +
        `$${result.v18.toFixed(2).padStart(9)} | ` +
        `${result.v18Err.toFixed(1).padStart(5)}% | ` +
        `$${result.v19clob.toFixed(2).padStart(9)} | ` +
        `${result.v19clobErr.toFixed(1).padStart(5)}% | ` +
        `$${result.v19ctf.toFixed(2).padStart(9)} | ` +
        `${result.v19ctfErr.toFixed(1).padStart(5)}% | ` +
        `${result.positions}/${result.resolved}`
    );
  }

  // Summary statistics
  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const passCount = (arr: number[], threshold: number) =>
    arr.filter((e) => e <= threshold).length;

  const v18Errors = results.map((r) => r.v18Err);
  const v19clobErrors = results.map((r) => r.v19clobErr);
  const v19ctfErrors = results.map((r) => r.v19ctfErr);

  console.log(`\n              | Median Err | Pass ≤1% | Pass ≤5% | Pass ≤10%`);
  console.log('-'.repeat(70));
  console.log(
    `V18 (current) | ${median(v18Errors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v18Errors, 1).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 5).toString().padStart(7)} | ` +
      `${passCount(v18Errors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19 CLOB-only | ${median(v19clobErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v19clobErrors, 1).toString().padStart(7)} | ` +
      `${passCount(v19clobErrors, 5).toString().padStart(7)} | ` +
      `${passCount(v19clobErrors, 10).toString().padStart(8)}`
  );
  console.log(
    `V19 CLOB+CTF  | ${median(v19ctfErrors).toFixed(2).padStart(9)}% | ` +
      `${passCount(v19ctfErrors, 1).toString().padStart(7)} | ` +
      `${passCount(v19ctfErrors, 5).toString().padStart(7)} | ` +
      `${passCount(v19ctfErrors, 10).toString().padStart(8)}`
  );

  console.log(`\nTotal wallets: ${results.length}`);

  // Show improvements from V19
  console.log('\n' + '='.repeat(120));
  console.log('IMPROVEMENTS FROM V19 CLOB+CTF');
  console.log('='.repeat(120));

  for (const r of results) {
    if (r.v19ctfErr < r.v18Err && r.v18Err > 1) {
      const improvement = r.v18Err - r.v19ctfErr;
      console.log(
        `${r.username.substring(0, 14).padEnd(14)}: V18 ${r.v18Err.toFixed(1)}% → V19 ${r.v19ctfErr.toFixed(1)}% (${improvement.toFixed(1)}% improvement)`
      );
    }
  }

  // Show regressions
  console.log('\n' + '='.repeat(120));
  console.log('REGRESSIONS FROM V19 CLOB+CTF');
  console.log('='.repeat(120));

  for (const r of results) {
    if (r.v19ctfErr > r.v18Err + 1 && r.v18Err <= 1) {
      const regression = r.v19ctfErr - r.v18Err;
      console.log(
        `${r.username.substring(0, 14).padEnd(14)}: V18 ${r.v18Err.toFixed(1)}% → V19 ${r.v19ctfErr.toFixed(1)}% (${regression.toFixed(1)}% regression)`
      );
    }
  }

  // Save results
  const outputFile = 'data/v19-maker-only-benchmark-report.json';
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        summary: {
          v18: { median_err: median(v18Errors), pass_1pct: passCount(v18Errors, 1) },
          v19_clob: { median_err: median(v19clobErrors), pass_1pct: passCount(v19clobErrors, 1) },
          v19_ctf: { median_err: median(v19ctfErrors), pass_1pct: passCount(v19ctfErrors, 1) },
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`\nResults saved to: ${outputFile}`);
}

main().catch(console.error);
