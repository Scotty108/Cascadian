/**
 * ============================================================================
 * FAIL_BOTH WALLETS DRILLDOWN DIAGNOSTIC
 * ============================================================================
 *
 * PURPOSE: Deep-dive investigation of the 7+ FAIL_BOTH wallets from V23b benchmark.
 *
 * For each wallet that fails BOTH V23 and V23b:
 * 1. Check open positions vs metadata prices
 * 2. Compare last_trade_price vs outcome_prices from pm_market_metadata
 * 3. Identify root cause of error
 *
 * HYPOTHESIS: The UI uses pm_market_metadata.outcome_prices, not last_trade_price.
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { calculateV23bPnL } from '../../lib/pnl/shadowLedgerV23b';
import { getActivityCounts, isMarketMaker } from '../../lib/pnl/walletClassifier';

// ============================================================================
// Types
// ============================================================================

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
}

interface WalletAnalysis {
  wallet: string;
  ui_pnl: number;
  v23_pnl: number;
  v23b_pnl: number;
  v23_error_pct: number;
  v23b_error_pct: number;
  is_maker: boolean;
  verdict: string;
  unresolved_positions: number;
  metadata_price_impact: number;
  root_cause: string;
}

// ============================================================================
// Helpers
// ============================================================================

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatPnL(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ============================================================================
// Data Loading
// ============================================================================

async function loadBenchmarkWallets(): Promise<BenchmarkWallet[]> {
  const query = `
    SELECT wallet, pnl_value as ui_pnl
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = 'fresh_2025_12_04_alltime'
    ORDER BY abs(pnl_value) DESC
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    wallet: r.wallet,
    ui_pnl: Number(r.ui_pnl),
  }));
}

/**
 * Get UI prices from pm_market_metadata.outcome_prices
 * Returns Map<condition_id|outcome_index, price>
 */
async function loadUIMarketPrices(wallet: string): Promise<Map<string, number>> {
  // First get all conditions this wallet has traded
  const conditionsQuery = `
    SELECT DISTINCT condition_id
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id != ''
      AND condition_id IS NOT NULL
  `;
  const condResult = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' });
  const condRows = (await condResult.json()) as any[];

  if (condRows.length === 0) return new Map();

  const conditionIds = condRows.map(r => `'${r.condition_id.toLowerCase()}'`).join(',');

  // Now get metadata prices for these conditions
  const metaQuery = `
    SELECT
      lower(condition_id) as condition_id,
      outcome_prices
    FROM pm_market_metadata
    WHERE lower(condition_id) IN (${conditionIds})
  `;
  const metaResult = await clickhouse.query({ query: metaQuery, format: 'JSONEachRow' });
  const metaRows = (await metaResult.json()) as any[];

  const prices = new Map<string, number>();

  for (const m of metaRows) {
    const conditionId = m.condition_id;
    let priceStr = m.outcome_prices;

    // Parse the double-escaped JSON string
    // Format: "["0.5", "0.5"]"
    try {
      if (priceStr.startsWith('"') && priceStr.endsWith('"')) {
        priceStr = priceStr.slice(1, -1);
      }
      const priceArray = JSON.parse(priceStr);
      if (Array.isArray(priceArray)) {
        for (let i = 0; i < priceArray.length; i++) {
          const key = `${conditionId}|${i}`;
          const price = Number(priceArray[i]);
          if (!isNaN(price) && isFinite(price) && price >= 0 && price <= 1) {
            prices.set(key, price);
          }
        }
      }
    } catch {
      // Skip malformed data
    }
  }

  return prices;
}

/**
 * Get unresolved positions for a wallet and compute impact of different price oracles
 */
async function analyzeUnresolvedPositions(wallet: string): Promise<{
  count: number;
  v23b_value: number;
  metadata_value: number;
  positions: Array<{
    condition_id: string;
    outcome_index: number;
    tokens: number;
    last_trade_price: number;
    metadata_price: number;
    v23b_val: number;
    metadata_val: number;
  }>;
}> {
  // Get all positions
  const posQuery = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(token_delta) as net_tokens
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id != ''
        AND source_type = 'CLOB'
      GROUP BY condition_id, outcome_index
      HAVING abs(sum(token_delta)) > 0.01
    ),
    resolutions AS (
      SELECT
        lower(condition_id) as cid
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators IS NOT NULL
        AND payout_numerators != ''
        AND payout_numerators != '[]'
    ),
    last_prices AS (
      SELECT
        condition_id,
        outcome_index,
        argMax(abs(usdc_delta / nullIf(token_delta, 0)), event_time) as last_price
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND token_delta != 0
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    )
    SELECT
      p.condition_id,
      p.outcome_index,
      p.net_tokens,
      lp.last_price
    FROM positions p
    LEFT JOIN resolutions r ON lower(p.condition_id) = r.cid
    LEFT JOIN last_prices lp ON p.condition_id = lp.condition_id AND p.outcome_index = lp.outcome_index
    WHERE r.cid IS NULL  -- Only unresolved
  `;

  const result = await clickhouse.query({ query: posQuery, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // Load metadata prices
  const metaPrices = await loadUIMarketPrices(wallet);

  let v23b_value = 0;
  let metadata_value = 0;
  const positions: Array<{
    condition_id: string;
    outcome_index: number;
    tokens: number;
    last_trade_price: number;
    metadata_price: number;
    v23b_val: number;
    metadata_val: number;
  }> = [];

  for (const row of rows) {
    const tokens = Number(row.net_tokens);
    const lastPrice = Number(row.last_price) || 0.5;
    const key = `${row.condition_id.toLowerCase()}|${row.outcome_index}`;
    const metaPrice = metaPrices.get(key) ?? 0.5;

    const v23b_val = tokens * lastPrice;
    const meta_val = tokens * metaPrice;

    v23b_value += v23b_val;
    metadata_value += meta_val;

    positions.push({
      condition_id: row.condition_id,
      outcome_index: row.outcome_index,
      tokens,
      last_trade_price: lastPrice,
      metadata_price: metaPrice,
      v23b_val,
      metadata_val: meta_val,
    });
  }

  return {
    count: positions.length,
    v23b_value,
    metadata_value,
    positions,
  };
}

// ============================================================================
// Analysis
// ============================================================================

async function analyzeWallet(wallet: string, ui_pnl: number): Promise<WalletAnalysis> {
  // Get activity to check maker status
  const activity = await getActivityCounts(wallet);
  const is_maker = isMarketMaker(activity);

  // Calculate V23
  const v23Result = await calculateV23PnL(wallet);
  const v23_pnl = v23Result.totalPnl;
  const v23_error = errorPct(v23_pnl, ui_pnl);

  // Calculate V23b
  const v23bResult = await calculateV23bPnL(wallet, { markToMarket: true });
  const v23b_pnl = v23bResult.totalPnl;
  const v23b_error = errorPct(v23b_pnl, ui_pnl);

  // Determine verdict
  let verdict: string;
  if (is_maker) {
    verdict = 'MAKER';
  } else if (v23_error < 1.0 && v23b_error < 1.0) {
    verdict = 'PASS_BOTH';
  } else if (v23_error >= 1.0 && v23b_error < 1.0) {
    verdict = 'FIX_BY_V23B';
  } else if (v23_error < 1.0 && v23b_error >= 1.0) {
    verdict = 'REGRESSED';
  } else {
    verdict = 'FAIL_BOTH';
  }

  // Analyze unresolved positions
  const unresolvedAnalysis = await analyzeUnresolvedPositions(wallet);

  // Compute potential fix with metadata prices
  const metadata_price_impact = unresolvedAnalysis.metadata_value - unresolvedAnalysis.v23b_value;

  // Determine root cause
  let root_cause = 'Unknown';
  if (is_maker) {
    root_cause = 'Market Maker (Split/Merge activity)';
  } else if (verdict === 'FAIL_BOTH') {
    if (unresolvedAnalysis.count > 0 && Math.abs(metadata_price_impact) > 1000) {
      root_cause = `Price oracle mismatch: ${unresolvedAnalysis.count} unresolved positions, metadata impact ${formatPnL(metadata_price_impact)}`;
    } else if (unresolvedAnalysis.count === 0) {
      root_cause = 'All positions resolved - error may be in trade data or fees';
    } else {
      root_cause = 'Multiple factors - requires manual investigation';
    }
  }

  return {
    wallet,
    ui_pnl,
    v23_pnl,
    v23b_pnl,
    v23_error_pct: v23_error,
    v23b_error_pct: v23b_error,
    is_maker,
    verdict,
    unresolved_positions: unresolvedAnalysis.count,
    metadata_price_impact,
    root_cause,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                    FAIL_BOTH WALLETS DRILLDOWN                                             ║');
  console.log('║  MISSION: Find root causes for wallets failing both V23 and V23b                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  // Load benchmark wallets
  const wallets = await loadBenchmarkWallets();
  console.log(`Loaded ${wallets.length} wallets from benchmark set 'fresh_2025_12_04_alltime'`);
  console.log('');

  // Analyze all wallets
  const analyses: WalletAnalysis[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    process.stdout.write(`\r[${i + 1}/${wallets.length}] ${w.wallet.substring(0, 16)}...`);

    try {
      const analysis = await analyzeWallet(w.wallet, w.ui_pnl);
      analyses.push(analysis);
    } catch (err: any) {
      console.log(`\n  Error: ${err.message}`);
    }
  }

  console.log('\n');

  // Filter to FAIL_BOTH
  const failBoth = analyses.filter(a => a.verdict === 'FAIL_BOTH');

  // Summary
  console.log('═'.repeat(110));
  console.log('SUMMARY');
  console.log('═'.repeat(110));

  const verdicts = {
    PASS_BOTH: analyses.filter(a => a.verdict === 'PASS_BOTH').length,
    FIX_BY_V23B: analyses.filter(a => a.verdict === 'FIX_BY_V23B').length,
    REGRESSED: analyses.filter(a => a.verdict === 'REGRESSED').length,
    FAIL_BOTH: failBoth.length,
    MAKER: analyses.filter(a => a.verdict === 'MAKER').length,
  };

  console.log('');
  console.log('| Verdict     | Count |');
  console.log('|-------------|-------|');
  console.log(`| PASS_BOTH   | ${String(verdicts.PASS_BOTH).padStart(5)} |`);
  console.log(`| FIX_BY_V23B | ${String(verdicts.FIX_BY_V23B).padStart(5)} |`);
  console.log(`| REGRESSED   | ${String(verdicts.REGRESSED).padStart(5)} |`);
  console.log(`| FAIL_BOTH   | ${String(verdicts.FAIL_BOTH).padStart(5)} |`);
  console.log(`| MAKER       | ${String(verdicts.MAKER).padStart(5)} |`);
  console.log('');

  // Detailed FAIL_BOTH analysis
  console.log('═'.repeat(110));
  console.log('FAIL_BOTH WALLETS DETAILED ANALYSIS');
  console.log('═'.repeat(110));
  console.log('');

  for (const a of failBoth) {
    console.log('┌' + '─'.repeat(108) + '┐');
    console.log(`│ WALLET: ${a.wallet.padEnd(50)} UI PnL: ${formatPnL(a.ui_pnl).padStart(12)} │`);
    console.log(`│ V23:  ${formatPnL(a.v23_pnl).padEnd(12)} (${a.v23_error_pct.toFixed(2).padStart(6)}% error)                                                     │`);
    console.log(`│ V23b: ${formatPnL(a.v23b_pnl).padEnd(12)} (${a.v23b_error_pct.toFixed(2).padStart(6)}% error)                                                     │`);
    console.log('├' + '─'.repeat(108) + '┤');
    console.log(`│ Unresolved Positions: ${String(a.unresolved_positions).padStart(5)}                                                                         │`);
    console.log(`│ Metadata Price Impact: ${formatPnL(a.metadata_price_impact).padStart(12)} (V23c would add this)                                       │`);
    console.log('├' + '─'.repeat(108) + '┤');
    console.log(`│ ROOT CAUSE: ${a.root_cause.substring(0, 95).padEnd(95)} │`);
    console.log('└' + '─'.repeat(108) + '┘');
    console.log('');
  }

  // Compute what V23c would achieve
  console.log('═'.repeat(110));
  console.log('V23c PROJECTION (using pm_market_metadata.outcome_prices)');
  console.log('═'.repeat(110));
  console.log('');

  let v23c_fixes = 0;
  for (const a of failBoth) {
    // Estimate V23c PnL by adjusting V23b with metadata price impact
    const v23c_pnl = a.v23b_pnl + a.metadata_price_impact;
    const v23c_error = errorPct(v23c_pnl, a.ui_pnl);

    if (v23c_error < 1.0) {
      v23c_fixes++;
      console.log(`✓ ${a.wallet.substring(0, 16)}... V23c would PASS (${v23c_error.toFixed(2)}% error)`);
    } else {
      console.log(`✗ ${a.wallet.substring(0, 16)}... V23c still FAILS (${v23c_error.toFixed(2)}% error)`);
    }
  }

  console.log('');
  console.log(`V23c projected fixes: ${v23c_fixes} / ${failBoth.length} FAIL_BOTH wallets`);
  console.log('');

  // Recommendations
  console.log('═'.repeat(110));
  console.log('RECOMMENDATIONS');
  console.log('═'.repeat(110));
  console.log('');
  console.log('1. IMPLEMENT V23c with pm_market_metadata.outcome_prices as the price oracle');
  console.log('   - For unresolved positions: use outcome_prices[outcome_index]');
  console.log('   - Fallback to last_trade_price if metadata missing');
  console.log('   - Fallback to $0.50 if both missing');
  console.log('');
  console.log('2. This should match the Polymarket UI PnL calculation exactly');
  console.log('');

  console.log('═'.repeat(110));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(110));
}

main().catch(console.error);
