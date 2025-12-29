/**
 * Validate Synthetic Realized vs UI Implied Realized - V2
 *
 * This validator compares our synthetic realized PnL against what Polymarket UI shows.
 *
 * Definitions (locked):
 * - pnl_synth_realized: cash_flow + final_tokens * resolution_price (for resolved markets only)
 * - open_value: sum(currentValue) from Polymarket positions API
 * - ui_implied_realized: ui_total_pnl - open_value
 *
 * Data sources:
 * - ui_total_pnl: pm_ui_pnl_benchmarks_v2 (scraped via Playwright)
 * - open_value: Live fetch from data-api.polymarket.com/positions
 * - pnl_synth_realized: SQL from CLOB ledger + resolutions
 *
 * Validation thresholds:
 * - PASS: within 5%
 * - WARN: within 20%
 * - FAIL: >20% difference
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

// ============================================================================
// Configuration
// ============================================================================

const MAX_WALLETS = 200;
const CONCURRENCY = 5; // Parallel API requests
const API_DELAY_MS = 200; // Delay between batches

// ============================================================================
// Types
// ============================================================================

interface PositionFromApi {
  currentValue: number;
  realizedPnl: number;
  cashPnl: number;
  size: number;
  conditionId: string;
  outcomeIndex: number;
}

interface WalletData {
  wallet: string;
  uiTotalPnl: number;
  openValue: number;
  uiImpliedRealized: number;
  synthRealized: number;
  delta: number;
  pctDiff: number;
  status: 'PASS' | 'WARN' | 'FAIL' | 'ERROR';
  error?: string;
  positionCount?: number;
  openPositionCount?: number;
}

interface RowGrowthAudit {
  wallet: string;
  clobRows: number;
  ctfRows: number;
  resolvedConditions: number;
  unresolvedConditions: number;
  totalConditions: number;
  hasDuplicates: boolean;
  duplicateCount: number;
}

// ============================================================================
// Fetch Positions from Polymarket API
// ============================================================================

async function fetchPositions(wallet: string): Promise<{ openValue: number; positionCount: number; openPositionCount: number } | null> {
  try {
    const url = `https://data-api.polymarket.com/positions?user=${wallet}`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return null;
    }

    const positions = await response.json() as any[];
    if (!Array.isArray(positions)) {
      return null;
    }

    // Sum currentValue for open positions
    let openValue = 0;
    let openPositionCount = 0;

    for (const pos of positions) {
      const cv = Number(pos.currentValue) || 0;
      if (cv > 0) {
        openValue += cv;
        openPositionCount++;
      }
    }

    return {
      openValue,
      positionCount: positions.length,
      openPositionCount,
    };
  } catch (e: any) {
    return null;
  }
}

// ============================================================================
// Get Synthetic Realized PnL from ClickHouse
// ============================================================================

async function getSynthRealizedPnl(wallet: string): Promise<number | null> {
  try {
    // Formula: For each resolved position:
    // pnl = (sell_usdc - buy_usdc) + final_tokens * resolved_price
    // Where final_tokens = buy_tokens - sell_tokens
    const query = `
      WITH
        -- Deduplicated CLOB events
        clob AS (
          SELECT
            event_id,
            any(side) as side,
            any(token_id) as token_id,
            any(token_amount) as token_amount,
            any(usdc_amount) as usdc_amount
          FROM pm_trader_events_dedup_v2_tbl
          WHERE trader_wallet = {wallet:String}
          GROUP BY event_id
        ),
        -- Aggregate by position
        positions AS (
          SELECT
            m.condition_id,
            m.outcome_index,
            sumIf(c.token_amount, c.side = 'buy') / 1e6 AS buy_tokens,
            sumIf(c.token_amount, c.side = 'sell') / 1e6 AS sell_tokens,
            sumIf(c.usdc_amount, c.side = 'buy') / 1e6 AS buy_usdc,
            sumIf(c.usdc_amount, c.side = 'sell') / 1e6 AS sell_usdc
          FROM clob c
          INNER JOIN pm_token_to_condition_map_v5 m ON m.token_id_dec = c.token_id
          GROUP BY m.condition_id, m.outcome_index
        ),
        -- Join with resolutions
        resolved AS (
          SELECT
            p.condition_id,
            p.outcome_index,
            p.buy_tokens,
            p.sell_tokens,
            p.buy_usdc,
            p.sell_usdc,
            p.buy_tokens - p.sell_tokens AS final_tokens,
            p.sell_usdc - p.buy_usdc AS net_cash,
            r.resolved_price
          FROM positions p
          INNER JOIN vw_pm_resolution_prices r
            ON p.condition_id = r.condition_id
            AND p.outcome_index = r.outcome_index
          WHERE r.resolved_price IS NOT NULL
        )
      SELECT
        sum(net_cash + final_tokens * resolved_price) AS synth_realized
      FROM resolved
    `;

    const result = await clickhouse.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    if (rows.length === 0) return 0;

    return Number(rows[0].synth_realized) || 0;
  } catch (e: any) {
    console.error(`Error getting synth realized for ${wallet}: ${e.message}`);
    return null;
  }
}

// ============================================================================
// Row Growth Audit for Failed Wallets
// ============================================================================

async function auditRowGrowth(wallet: string): Promise<RowGrowthAudit | null> {
  try {
    const query = `
      WITH
        clob_stats AS (
          SELECT
            count() as total_rows,
            uniqExact(event_id) as unique_events,
            count() - uniqExact(event_id) as duplicates
          FROM pm_trader_events_dedup_v2_tbl
          WHERE trader_wallet = {wallet:String}
        ),
        ctf_stats AS (
          SELECT count() as ctf_rows
          FROM pm_ctf_events
          WHERE lower(user_address) = {wallet:String}
        ),
        condition_stats AS (
          SELECT
            uniqExact(m.condition_id) as total_conditions,
            uniqExactIf(m.condition_id, r.resolved_price IS NOT NULL) as resolved_conditions
          FROM pm_trader_events_dedup_v2_tbl e
          INNER JOIN pm_token_to_condition_map_v5 m ON m.token_id_dec = e.token_id
          LEFT JOIN vw_pm_resolution_prices r
            ON m.condition_id = r.condition_id AND m.outcome_index = r.outcome_index
          WHERE e.trader_wallet = {wallet:String}
          GROUP BY ()
        )
      SELECT
        clob_stats.total_rows as clob_rows,
        clob_stats.unique_events,
        clob_stats.duplicates as duplicate_count,
        ctf_stats.ctf_rows,
        condition_stats.total_conditions,
        condition_stats.resolved_conditions
      FROM clob_stats, ctf_stats, condition_stats
    `;

    const result = await clickhouse.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    if (rows.length === 0) return null;

    const r = rows[0];
    return {
      wallet,
      clobRows: Number(r.clob_rows) || 0,
      ctfRows: Number(r.ctf_rows) || 0,
      resolvedConditions: Number(r.resolved_conditions) || 0,
      unresolvedConditions: Number(r.total_conditions) - Number(r.resolved_conditions) || 0,
      totalConditions: Number(r.total_conditions) || 0,
      hasDuplicates: Number(r.duplicate_count) > 0,
      duplicateCount: Number(r.duplicate_count) || 0,
    };
  } catch (e: any) {
    return null;
  }
}

// ============================================================================
// Get Benchmark Wallets
// ============================================================================

async function getBenchmarkWallets(limit: number): Promise<{ wallet: string; uiTotalPnl: number }[]> {
  // Get wallets from v2 benchmarks that have successful captures
  const query = `
    SELECT
      wallet_address as wallet,
      ui_pnl_value as ui_total_pnl
    FROM pm_ui_pnl_benchmarks_v2
    WHERE status = 'success'
      AND ui_pnl_value IS NOT NULL
    ORDER BY abs(ui_pnl_value) DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    wallet: r.wallet.toLowerCase(),
    uiTotalPnl: Number(r.ui_total_pnl),
  }));
}

// ============================================================================
// Main Validation
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('VALIDATE SYNTHETIC REALIZED vs UI IMPLIED REALIZED');
  console.log('='.repeat(80));
  console.log('\nDefinitions (locked):');
  console.log('  pnl_synth_realized = cash_flow + final_tokens * resolved_price');
  console.log('  open_value = sum(currentValue) from Polymarket positions API');
  console.log('  ui_implied_realized = ui_total_pnl - open_value');
  console.log('\nThresholds: PASS (<5%), WARN (5-20%), FAIL (>20%)\n');

  // Step 1: Get benchmark wallets
  console.log('Loading benchmark wallets...');
  const benchmarks = await getBenchmarkWallets(MAX_WALLETS);
  console.log(`Found ${benchmarks.length} wallets with UI PnL benchmarks\n`);

  if (benchmarks.length === 0) {
    console.log('ERROR: No benchmark wallets found. Run Playwright scraper first.');
    return;
  }

  // Step 2: Validate each wallet
  const results: WalletData[] = [];
  const failedWallets: string[] = [];

  console.log(' # | wallet       | UI Total  | Open Val | UI Impl   | Synth     | Delta    | Status');
  console.log('-'.repeat(95));

  for (let i = 0; i < benchmarks.length; i++) {
    const { wallet, uiTotalPnl } = benchmarks[i];

    // Fetch positions (open_value)
    const posData = await fetchPositions(wallet);

    if (!posData) {
      results.push({
        wallet,
        uiTotalPnl,
        openValue: 0,
        uiImpliedRealized: uiTotalPnl,
        synthRealized: 0,
        delta: 0,
        pctDiff: 100,
        status: 'ERROR',
        error: 'API fetch failed',
      });
      failedWallets.push(wallet);
      console.log(`${(i + 1).toString().padStart(2)} | ${wallet.slice(0, 10)}... | ${formatCurrency(uiTotalPnl).padStart(9)} | ERROR    |           |           |          | ERROR`);
      continue;
    }

    const openValue = posData.openValue;
    const uiImpliedRealized = uiTotalPnl - openValue;

    // Get synthetic realized
    const synthRealized = await getSynthRealizedPnl(wallet);

    if (synthRealized === null) {
      results.push({
        wallet,
        uiTotalPnl,
        openValue,
        uiImpliedRealized,
        synthRealized: 0,
        delta: 0,
        pctDiff: 100,
        status: 'ERROR',
        error: 'SQL failed',
        positionCount: posData.positionCount,
        openPositionCount: posData.openPositionCount,
      });
      failedWallets.push(wallet);
      console.log(`${(i + 1).toString().padStart(2)} | ${wallet.slice(0, 10)}... | ${formatCurrency(uiTotalPnl).padStart(9)} | ${formatCurrency(openValue).padStart(8)} | ${formatCurrency(uiImpliedRealized).padStart(9)} | SQL ERR   |          | ERROR`);
      continue;
    }

    // Calculate difference
    const delta = synthRealized - uiImpliedRealized;
    const pctDiff = uiImpliedRealized !== 0
      ? Math.abs(delta) / Math.abs(uiImpliedRealized) * 100
      : (delta === 0 ? 0 : 100);

    // Determine status
    let status: 'PASS' | 'WARN' | 'FAIL';
    if (pctDiff <= 5) {
      status = 'PASS';
    } else if (pctDiff <= 20) {
      status = 'WARN';
    } else {
      status = 'FAIL';
      failedWallets.push(wallet);
    }

    results.push({
      wallet,
      uiTotalPnl,
      openValue,
      uiImpliedRealized,
      synthRealized,
      delta,
      pctDiff,
      status,
      positionCount: posData.positionCount,
      openPositionCount: posData.openPositionCount,
    });

    console.log(
      `${(i + 1).toString().padStart(2)} | ${wallet.slice(0, 10)}... | ${formatCurrency(uiTotalPnl).padStart(9)} | ${formatCurrency(openValue).padStart(8)} | ${formatCurrency(uiImpliedRealized).padStart(9)} | ${formatCurrency(synthRealized).padStart(9)} | ${formatDelta(delta).padStart(8)} | ${status}`
    );

    // Rate limiting
    if ((i + 1) % CONCURRENCY === 0) {
      await new Promise(r => setTimeout(r, API_DELAY_MS));
    }
  }

  // Step 3: Summary Statistics
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  const valid = results.filter(r => r.status !== 'ERROR');

  console.log(`\n  PASS (<5%):   ${passed}/${results.length} (${(passed / results.length * 100).toFixed(1)}%)`);
  console.log(`  WARN (5-20%): ${warned}/${results.length}`);
  console.log(`  FAIL (>20%):  ${failed}/${results.length}`);
  console.log(`  ERROR:        ${errors}/${results.length}`);

  // Percentile statistics
  if (valid.length > 0) {
    const pctDiffs = valid.map(r => r.pctDiff).sort((a, b) => a - b);
    const p50 = pctDiffs[Math.floor(pctDiffs.length * 0.5)];
    const p95 = pctDiffs[Math.floor(pctDiffs.length * 0.95)];
    const avg = pctDiffs.reduce((a, b) => a + b, 0) / pctDiffs.length;

    console.log(`\n  Average diff: ${avg.toFixed(1)}%`);
    console.log(`  P50 diff: ${p50.toFixed(1)}%`);
    console.log(`  P95 diff: ${p95.toFixed(1)}%`);
  }

  // Step 4: Worst 10 wallets drilldown
  console.log('\n' + '='.repeat(80));
  console.log('WORST 10 WALLETS (by absolute delta)');
  console.log('='.repeat(80));

  const worst = [...results]
    .filter(r => r.status !== 'ERROR')
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);

  for (const w of worst) {
    console.log(`\n  ${w.wallet}`);
    console.log(`    UI Total: ${formatCurrency(w.uiTotalPnl)}, Open Value: ${formatCurrency(w.openValue)}`);
    console.log(`    UI Implied Realized: ${formatCurrency(w.uiImpliedRealized)}`);
    console.log(`    Synth Realized: ${formatCurrency(w.synthRealized)}`);
    console.log(`    Delta: ${formatDelta(w.delta)} (${w.pctDiff.toFixed(1)}%) - ${w.status}`);
    console.log(`    Positions: ${w.positionCount} total, ${w.openPositionCount} open`);
  }

  // Step 5: Row Growth Audit for Failed Wallets
  if (failedWallets.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('ROW GROWTH AUDIT (Failed + Error Wallets)');
    console.log('='.repeat(80));

    const auditSample = failedWallets.slice(0, 20);
    console.log(`\nAuditing ${auditSample.length} failed wallets...\n`);

    console.log('wallet       | CLOB rows | CTF rows | Resolved | Unresolved | Dupes');
    console.log('-'.repeat(70));

    for (const wallet of auditSample) {
      const audit = await auditRowGrowth(wallet);
      if (audit) {
        console.log(
          `${wallet.slice(0, 10)}... | ${audit.clobRows.toString().padStart(9)} | ${audit.ctfRows.toString().padStart(8)} | ${audit.resolvedConditions.toString().padStart(8)} | ${audit.unresolvedConditions.toString().padStart(10)} | ${audit.hasDuplicates ? audit.duplicateCount : 'None'}`
        );
      }
    }
  }

  // Overall verdict
  console.log('\n' + '='.repeat(80));
  if (passed / results.length >= 0.8) {
    console.log('VALIDATION: PASSED (80%+ within 5% tolerance)');
  } else if ((passed + warned) / results.length >= 0.8) {
    console.log('VALIDATION: ACCEPTABLE (80%+ within 20% tolerance)');
  } else {
    console.log('VALIDATION: FAILED - Formula or data issue detected');
  }
  console.log('='.repeat(80));
}

function formatCurrency(val: number): string {
  if (val >= 0) return `$${val.toFixed(0)}`;
  return `-$${Math.abs(val).toFixed(0)}`;
}

function formatDelta(val: number): string {
  if (val >= 0) return `+$${val.toFixed(0)}`;
  return `-$${Math.abs(val).toFixed(0)}`;
}

main().catch(console.error);
