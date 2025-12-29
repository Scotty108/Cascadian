#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * UI PARITY HARNESS - V20b vs Polymarket UI Validation
 * ============================================================================
 *
 * This script validates V20b PnL calculations against Polymarket's UI data
 * using Playwright MCP tools for automated scraping.
 *
 * WORKFLOW:
 * 1. Load candidate wallets from data/wallet-classification-report.json or custom input
 * 2. For each wallet (limit 30-50 for validation):
 *    a. Compute V20b PnL using calculateV20bPnL
 *    b. Use Playwright MCP to fetch UI data from Polymarket profile
 *    c. Calculate deltas and assign pass/fail status
 * 3. Output comprehensive results to data/ui-parity-results.json
 *
 * USAGE:
 *   # Use default wallet list (from wallet-classification-report.json)
 *   npx tsx scripts/pnl/ui-parity-harness.ts
 *
 *   # Use custom wallet list
 *   npx tsx scripts/pnl/ui-parity-harness.ts --wallets "0x123,0x456,0x789"
 *
 *   # Limit number of wallets
 *   npx tsx scripts/pnl/ui-parity-harness.ts --limit 20
 *
 *   # Skip Playwright scraping (use cached results)
 *   npx tsx scripts/pnl/ui-parity-harness.ts --skip-scrape
 *
 * REQUIRES:
 *   - Playwright MCP server running (for UI scraping)
 *   - ClickHouse access (for V20b calculations)
 *
 * Terminal: Claude 1
 * Date: 2025-12-15
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { calculateV20bPnL } from '../../lib/pnl/uiActivityEngineV20b';
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface WalletInput {
  wallet: string;
  username?: string;
  clob_trade_count?: number;
  clob_volume_usdc?: number;
  ctf_event_count?: number;
}

interface UIData {
  net: number;
  gain: number;
  loss: number;
  volume: number;
}

interface ValidationResult {
  wallet_address: string;
  username?: string;

  // UI data
  ui_net: number | null;
  ui_gain: number | null;
  ui_loss: number | null;
  ui_volume: number | null;

  // V20b data
  v20b_net: number;
  v20b_realized: number;
  v20b_unrealized: number;
  v20b_positions: number;
  v20b_resolved: number;
  v20b_redemption_only: number;

  // Metadata
  clob_trade_count: number;
  mapped_clob_rows?: number;
  markets?: number;
  clamp_pct?: number;

  // Deltas
  abs_delta: number | null;
  pct_delta: number | null;

  // Status
  status: 'PASS' | 'FAIL' | 'ERROR';
  reason_code: string | null;
  notes?: string;

  // Timestamps
  scraped_at?: string;
  calculated_at: string;
}

interface HarnessConfig {
  walletList?: string[];
  limit: number;
  skipScrape: boolean;
  cacheFile: string;
  outputFile: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseDollarAmount(str: string | undefined | null): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[,$]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function determineStatus(
  ui_net: number | null,
  v20b_net: number,
  clamp_pct: number | undefined
): { status: 'PASS' | 'FAIL' | 'ERROR'; reason_code: string | null } {
  if (ui_net === null) {
    return { status: 'ERROR', reason_code: 'UI_SCRAPE_FAILED' };
  }

  const abs_delta = Math.abs(v20b_net - ui_net);
  const pct_delta = Math.abs(ui_net) > 0 ? (abs_delta / Math.abs(ui_net)) * 100 : 0;

  // Large wallet threshold
  const isLargeWallet = Math.abs(ui_net) > 100000;
  const pctThreshold = isLargeWallet ? 1.0 : 2.0;

  // PASS criteria: abs_delta <= $250 OR pct_delta <= threshold
  if (abs_delta <= 250 || pct_delta <= pctThreshold) {
    return { status: 'PASS', reason_code: null };
  }

  // FAIL - determine reason
  if (clamp_pct !== undefined && clamp_pct > 10) {
    return { status: 'FAIL', reason_code: 'HIGH_CLAMP_PCT' };
  }

  if (pct_delta > 20) {
    return { status: 'FAIL', reason_code: 'UI_MISMATCH_OTHER' };
  }

  return { status: 'FAIL', reason_code: 'LOW_MAPPING_COVERAGE' };
}

// -----------------------------------------------------------------------------
// Data Loading
// -----------------------------------------------------------------------------

async function loadWalletList(config: HarnessConfig): Promise<WalletInput[]> {
  // Use custom wallet list if provided
  if (config.walletList && config.walletList.length > 0) {
    console.log(`Using custom wallet list: ${config.walletList.length} wallets`);
    return config.walletList.map(w => ({ wallet: w.toLowerCase() }));
  }

  // Load from wallet-classification-report.json
  const reportPath = path.join(process.cwd(), 'data', 'wallet-classification-report.json');
  if (fs.existsSync(reportPath)) {
    console.log(`Loading wallets from: ${reportPath}`);
    const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    const wallets: WalletInput[] = data.classifications.map((c: any) => ({
      wallet: c.wallet.toLowerCase(),
      username: c.username,
      clob_trade_count: c.clob_trade_count,
      clob_volume_usdc: c.clob_volume_usdc,
      ctf_event_count: c.ctf_event_count,
    }));
    console.log(`Loaded ${wallets.length} wallets from classification report`);
    return wallets.slice(0, config.limit);
  }

  // Fallback to playwright_50_wallets.json
  const fallbackPath = path.join(process.cwd(), 'tmp', 'playwright_50_wallets.json');
  if (fs.existsSync(fallbackPath)) {
    console.log(`Loading wallets from: ${fallbackPath}`);
    const data = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
    const wallets: WalletInput[] = data.wallets.map((w: any) => ({
      wallet: w.wallet.toLowerCase(),
    }));
    console.log(`Loaded ${wallets.length} wallets from fallback file`);
    return wallets.slice(0, config.limit);
  }

  throw new Error('No wallet list found. Provide --wallets or ensure data files exist.');
}

// -----------------------------------------------------------------------------
// Clamp Percentage Calculation
// -----------------------------------------------------------------------------

async function getClampPct(wallet: string): Promise<number | undefined> {
  try {
    const query = `
      WITH wallet_stats AS (
        SELECT
          count() as total_rows,
          sumIf(1, token_id IS NULL OR token_id = '') as clamped_rows
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
      )
      SELECT
        total_rows,
        clamped_rows,
        if(total_rows > 0, (clamped_rows / total_rows) * 100, 0) as clamp_pct
      FROM wallet_stats
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    if (rows.length === 0 || rows[0].total_rows === 0) {
      return undefined;
    }

    return Number(rows[0].clamp_pct);
  } catch (e) {
    console.log(`  Warning: Could not get clamp_pct for ${wallet}`);
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// CLOB Trade Count
// -----------------------------------------------------------------------------

async function getClobTradeCount(wallet: string): Promise<number> {
  try {
    const query = `
      SELECT count() as trade_count
      FROM (
        SELECT event_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY event_id
      )
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    return rows.length > 0 ? Number(rows[0].trade_count) : 0;
  } catch (e) {
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Playwright UI Scraping (Manual Instructions)
// -----------------------------------------------------------------------------

function printScrapingInstructions(wallets: WalletInput[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('PLAYWRIGHT MCP SCRAPING INSTRUCTIONS');
  console.log('='.repeat(80));
  console.log('\nFor each wallet below, use Playwright MCP tools:');
  console.log('\n1. Navigate: mcp__playwright__browser_navigate');
  console.log('   URL: https://polymarket.com/profile/{wallet_address}');
  console.log('\n2. Hover: mcp__playwright__browser_hover');
  console.log('   Selector: .text-text-secondary\\/60 (info icon next to PnL)');
  console.log('\n3. Snapshot: mcp__playwright__browser_snapshot');
  console.log('   Extract: Net total, Gain, Loss, Volume from tooltip');
  console.log('\n4. Save to cache file (see format below)');
  console.log('\n' + '-'.repeat(80));
  console.log('WALLETS TO SCRAPE:');
  console.log('-'.repeat(80) + '\n');

  for (let i = 0; i < Math.min(10, wallets.length); i++) {
    const w = wallets[i];
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   URL: https://polymarket.com/profile/${w.wallet}`);
    console.log(`   Username: ${w.username || 'N/A'}`);
    console.log('');
  }

  console.log('-'.repeat(80));
  console.log('CACHE FILE FORMAT (save to tmp/ui-scrape-cache.json):');
  console.log('-'.repeat(80));
  console.log(`
{
  "scraped_at": "2025-12-15T...",
  "wallets": [
    {
      "wallet": "0x...",
      "net": 1234.56,
      "gain": 5000.00,
      "loss": -3765.44,
      "volume": 50000.00
    }
  ]
}
  `);
}

async function loadUICache(cacheFile: string): Promise<Map<string, UIData>> {
  const cache = new Map<string, UIData>();

  if (!fs.existsSync(cacheFile)) {
    console.log(`\nNo UI cache file found at: ${cacheFile}`);
    console.log('You will need to scrape UI data manually using Playwright MCP.');
    return cache;
  }

  try {
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    for (const w of data.wallets || []) {
      cache.set(w.wallet.toLowerCase(), {
        net: w.net,
        gain: w.gain,
        loss: w.loss,
        volume: w.volume,
      });
    }
    console.log(`Loaded ${cache.size} wallets from UI cache`);
  } catch (e: any) {
    console.log(`Warning: Could not load UI cache: ${e.message}`);
  }

  return cache;
}

// -----------------------------------------------------------------------------
// Main Validation Loop
// -----------------------------------------------------------------------------

async function validateWallet(
  input: WalletInput,
  uiCache: Map<string, UIData>
): Promise<ValidationResult> {
  const wallet = input.wallet.toLowerCase();
  console.log(`\nValidating: ${wallet.slice(0, 20)}... ${input.username ? `(${input.username})` : ''}`);

  // 1. Compute V20b PnL
  console.log('  Computing V20b PnL...');
  const v20b = await calculateV20bPnL(wallet);

  // 2. Get CLOB trade count
  const clobCount = input.clob_trade_count !== undefined
    ? input.clob_trade_count
    : await getClobTradeCount(wallet);

  // 3. Get clamp percentage
  const clampPct = await getClampPct(wallet);

  // 4. Get UI data
  const uiData = uiCache.get(wallet);

  // 5. Calculate deltas
  const abs_delta = uiData ? Math.abs(v20b.total_pnl - uiData.net) : null;
  const pct_delta = uiData && Math.abs(uiData.net) > 0
    ? (abs_delta! / Math.abs(uiData.net)) * 100
    : null;

  // 6. Determine status
  const { status, reason_code } = determineStatus(uiData?.net || null, v20b.total_pnl, clampPct);

  // 7. Build result
  const result: ValidationResult = {
    wallet_address: wallet,
    username: input.username,

    ui_net: uiData?.net || null,
    ui_gain: uiData?.gain || null,
    ui_loss: uiData?.loss || null,
    ui_volume: uiData?.volume || null,

    v20b_net: v20b.total_pnl,
    v20b_realized: v20b.realized_pnl,
    v20b_unrealized: v20b.unrealized_pnl,
    v20b_positions: v20b.positions,
    v20b_resolved: v20b.resolved,
    v20b_redemption_only: v20b.redemption_only_positions,

    clob_trade_count: clobCount,
    clamp_pct: clampPct,

    abs_delta,
    pct_delta,

    status,
    reason_code,

    calculated_at: new Date().toISOString(),
  };

  // Log result
  if (status === 'PASS') {
    console.log(`  ✅ PASS - Delta: $${abs_delta?.toFixed(2) || 'N/A'} (${pct_delta?.toFixed(2) || 'N/A'}%)`);
  } else if (status === 'FAIL') {
    console.log(`  ❌ FAIL - ${reason_code} - Delta: $${abs_delta?.toFixed(2) || 'N/A'} (${pct_delta?.toFixed(2) || 'N/A'}%)`);
  } else {
    console.log(`  ⚠️  ERROR - ${reason_code}`);
  }

  return result;
}

// -----------------------------------------------------------------------------
// Report Generation
// -----------------------------------------------------------------------------

function generateReport(results: ValidationResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION REPORT');
  console.log('='.repeat(80));

  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;

  console.log(`\nTotal Wallets: ${total}`);
  console.log(`PASS:  ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`FAIL:  ${failed}/${total} (${((failed / total) * 100).toFixed(1)}%)`);
  console.log(`ERROR: ${errors}/${total} (${((errors / total) * 100).toFixed(1)}%)`);

  // Reason code breakdown
  if (failed > 0) {
    console.log('\nFAILURE BREAKDOWN:');
    const reasons = results.filter(r => r.status === 'FAIL')
      .reduce((acc, r) => {
        acc[r.reason_code || 'UNKNOWN'] = (acc[r.reason_code || 'UNKNOWN'] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    for (const [reason, count] of Object.entries(reasons)) {
      console.log(`  ${reason}: ${count}`);
    }
  }

  // Delta statistics (for non-error results)
  const validResults = results.filter(r => r.abs_delta !== null && r.pct_delta !== null);
  if (validResults.length > 0) {
    const avgAbsDelta = validResults.reduce((sum, r) => sum + (r.abs_delta || 0), 0) / validResults.length;
    const avgPctDelta = validResults.reduce((sum, r) => sum + (r.pct_delta || 0), 0) / validResults.length;

    const sortedAbs = validResults.map(r => r.abs_delta!).sort((a, b) => a - b);
    const sortedPct = validResults.map(r => r.pct_delta!).sort((a, b) => a - b);
    const medianAbs = sortedAbs[Math.floor(sortedAbs.length / 2)];
    const medianPct = sortedPct[Math.floor(sortedPct.length / 2)];

    console.log('\nDELTA STATISTICS:');
    console.log(`  Avg Abs Delta: $${avgAbsDelta.toFixed(2)}`);
    console.log(`  Median Abs Delta: $${medianAbs.toFixed(2)}`);
    console.log(`  Avg Pct Delta: ${avgPctDelta.toFixed(2)}%`);
    console.log(`  Median Pct Delta: ${medianPct.toFixed(2)}%`);
  }

  // Top failures (largest deltas)
  const topFailures = results
    .filter(r => r.status === 'FAIL' && r.abs_delta !== null)
    .sort((a, b) => (b.abs_delta || 0) - (a.abs_delta || 0))
    .slice(0, 5);

  if (topFailures.length > 0) {
    console.log('\nTOP 5 FAILURES (by absolute delta):');
    for (let i = 0; i < topFailures.length; i++) {
      const f = topFailures[i];
      console.log(`  ${i + 1}. ${f.wallet_address.slice(0, 20)}... - $${f.abs_delta?.toFixed(2)} (${f.pct_delta?.toFixed(2)}%) - ${f.reason_code}`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(80));
  console.log('UI PARITY HARNESS - V20b vs Polymarket UI');
  console.log('='.repeat(80));
  console.log(`Date: ${new Date().toISOString()}\n`);

  // Parse command-line args
  const args = process.argv.slice(2);
  const config: HarnessConfig = {
    walletList: args.includes('--wallets')
      ? args[args.indexOf('--wallets') + 1]?.split(',').filter(Boolean)
      : undefined,
    limit: args.includes('--limit')
      ? parseInt(args[args.indexOf('--limit') + 1], 10) || 50
      : 50,
    skipScrape: args.includes('--skip-scrape'),
    cacheFile: path.join(process.cwd(), 'tmp', 'ui-scrape-cache.json'),
    outputFile: path.join(process.cwd(), 'data', 'ui-parity-results.json'),
  };

  // Load wallet list
  const wallets = await loadWalletList(config);
  console.log(`Processing ${wallets.length} wallets (limit: ${config.limit})\n`);

  // Load UI cache
  const uiCache = await loadUICache(config.cacheFile);

  // If no cache and not skipping scrape, print instructions
  if (uiCache.size === 0 && !config.skipScrape) {
    printScrapingInstructions(wallets);
    console.log('\n⚠️  No UI data available. Please scrape using Playwright MCP and re-run.');
    console.log('Or use --skip-scrape to generate partial results.\n');
    return;
  }

  // Validate each wallet
  console.log('Starting validation...\n');
  const results: ValidationResult[] = [];

  for (const wallet of wallets) {
    try {
      const result = await validateWallet(wallet, uiCache);
      results.push(result);
    } catch (e: any) {
      console.log(`  ⚠️  ERROR: ${e.message}`);
      results.push({
        wallet_address: wallet.wallet,
        username: wallet.username,
        ui_net: null,
        ui_gain: null,
        ui_loss: null,
        ui_volume: null,
        v20b_net: 0,
        v20b_realized: 0,
        v20b_unrealized: 0,
        v20b_positions: 0,
        v20b_resolved: 0,
        v20b_redemption_only: 0,
        clob_trade_count: 0,
        abs_delta: null,
        pct_delta: null,
        status: 'ERROR',
        reason_code: 'CALCULATION_FAILED',
        notes: e.message,
        calculated_at: new Date().toISOString(),
      });
    }
  }

  // Generate report
  generateReport(results);

  // Save results
  const output = {
    generated_at: new Date().toISOString(),
    config,
    summary: {
      total: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      errors: results.filter(r => r.status === 'ERROR').length,
    },
    results,
  };

  fs.writeFileSync(config.outputFile, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${config.outputFile}`);
}

main().catch(console.error);
