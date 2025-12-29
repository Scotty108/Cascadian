/**
 * ============================================================================
 * UNKNOWN WALLETS DRILLDOWN DIAGNOSTIC
 * ============================================================================
 *
 * PURPOSE: Deep-dive investigation of the 10 UNKNOWN wallets from V23 diagnostic.
 *
 * For each UNKNOWN wallet:
 * 1. Per-Market Breakdown:
 *    - Calculate V23 PnL per condition_id
 *    - Find Top 3 Markets with biggest error contribution
 *
 * 2. Market Diagnostics:
 *    - Check if resolution_price is missing
 *    - Check for open positions (tokens held but unresolved)
 *    - Check for "ghosting" (redemption with no CLOB buys)
 *
 * 3. Specific Diagnosis:
 *    - "Wallet X failed because Market Y is Unresolved"
 *    - "Wallet Z failed because Market Q has no CLOB history"
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { classifyWallet, ClassificationResult } from '../../lib/pnl/walletClassifier';

// ============================================================================
// Types
// ============================================================================

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
}

interface MarketDiagnostic {
  condition_id: string;
  v23_pnl: number;
  cash_flow: number;
  token_balance: number;
  resolution_price: number | null;
  unrealized_value: number;
  has_clob_buys: boolean;
  has_redemptions: boolean;
  is_ghost: boolean;
  is_unresolved: boolean;
  error_contribution: number;
  diagnosis: string;
}

interface WalletDrilldown {
  wallet: string;
  ui_pnl: number;
  v23_pnl: number;
  error_pct: number;
  total_conditions: number;
  worst_markets: MarketDiagnostic[];
  primary_diagnosis: string;
  root_causes: string[];
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

async function getPerMarketDiagnostics(wallet: string): Promise<MarketDiagnostic[]> {
  // Simplified query - get per-condition breakdown directly
  const query = `
    SELECT
      condition_id,
      sum(usdc_delta) as cash_flow,
      sum(token_delta) as token_balance,
      countIf(token_delta > 0) as buy_count,
      countIf(source_type = 'PayoutRedemption') as redemption_count
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
      AND source_type = 'CLOB'
    GROUP BY condition_id
    ORDER BY abs(sum(usdc_delta)) DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return [];
  }

  const diagnostics: MarketDiagnostic[] = [];

  for (const row of rows) {
    if (!row || !row.condition_id) continue;

    const cash_flow = Number(row.cash_flow) || 0;
    const token_balance = Number(row.token_balance) || 0;
    const has_clob_buys = Number(row.buy_count) > 0;
    const has_redemptions = Number(row.redemption_count) > 0;

    // For now, resolution_price is null (would need separate lookup)
    const resolution_price: number | null = null;

    // Calculate V23-style PnL
    const effective_price = resolution_price !== null ? resolution_price : 0.5;
    const unrealized_value = token_balance * effective_price;
    const v23_pnl = cash_flow + unrealized_value;

    // Diagnosis flags
    const is_ghost = has_redemptions && !has_clob_buys;
    const is_unresolved = resolution_price === null && Math.abs(token_balance) > 100;

    // Determine diagnosis
    let diagnosis = 'OK';
    if (is_ghost) {
      diagnosis = 'GHOST: Redemption without CLOB buys';
    } else if (is_unresolved) {
      diagnosis = `UNRESOLVED: ${Math.abs(token_balance).toFixed(0)} tokens at $0.50`;
    } else if (Math.abs(cash_flow) > 10000) {
      diagnosis = `HIGH_VOLUME: $${formatPnL(Math.abs(cash_flow))} traded`;
    }

    diagnostics.push({
      condition_id: String(row.condition_id),
      v23_pnl,
      cash_flow,
      token_balance,
      resolution_price,
      unrealized_value,
      has_clob_buys,
      has_redemptions,
      is_ghost,
      is_unresolved,
      error_contribution: Math.abs(v23_pnl),
      diagnosis,
    });
  }

  return diagnostics;
}

async function drilldownWallet(wallet: string, ui_pnl: number): Promise<WalletDrilldown> {
  // Get V23 overall PnL
  const v23Result = await calculateV23PnL(wallet);
  const v23_pnl = v23Result.totalPnl;
  const error_pct = errorPct(v23_pnl, ui_pnl);

  // Get per-market diagnostics
  const marketDiagnostics = await getPerMarketDiagnostics(wallet);

  // Calculate error contribution per market
  // The idea: if we could fix this market, how much would error reduce?
  const totalGap = ui_pnl - v23_pnl;
  for (const m of marketDiagnostics) {
    // Error contribution is proportional to the PnL magnitude
    m.error_contribution = Math.abs(m.v23_pnl);
  }

  // Sort by error contribution (biggest first)
  marketDiagnostics.sort((a, b) => b.error_contribution - a.error_contribution);

  // Identify worst 3 markets
  const worstMarkets = marketDiagnostics.slice(0, 3);

  // Identify root causes
  const rootCauses: string[] = [];

  const ghostCount = marketDiagnostics.filter((m) => m.is_ghost).length;
  if (ghostCount > 0) {
    rootCauses.push(`${ghostCount} markets have redemptions without CLOB buys (GHOST)`);
  }

  const unresolvedCount = marketDiagnostics.filter((m) => m.is_unresolved).length;
  if (unresolvedCount > 0) {
    rootCauses.push(`${unresolvedCount} markets are unresolved with token holdings`);
  }

  const missingPriceCount = marketDiagnostics.filter(
    (m) => m.resolution_price === null && !m.is_unresolved
  ).length;
  if (missingPriceCount > 0) {
    rootCauses.push(`${missingPriceCount} markets have missing resolution prices`);
  }

  // Determine primary diagnosis
  let primaryDiagnosis = 'Unknown - requires manual investigation';
  if (ghostCount > 0 && ghostCount >= unresolvedCount) {
    primaryDiagnosis = `GHOST MARKETS: ${ghostCount} conditions have PayoutRedemption but no CLOB buys. Tokens acquired through Split/Merge or Transfer.`;
  } else if (unresolvedCount > 0) {
    primaryDiagnosis = `UNRESOLVED POSITIONS: ${unresolvedCount} markets still open, valued at $0.50 default.`;
  } else if (worstMarkets.length > 0 && Math.abs(worstMarkets[0].v23_pnl) > Math.abs(totalGap) * 0.5) {
    primaryDiagnosis = `SINGLE MARKET ISSUE: ${worstMarkets[0].condition_id.substring(0, 16)}... accounts for most of the error.`;
  }

  return {
    wallet,
    ui_pnl,
    v23_pnl,
    error_pct,
    total_conditions: marketDiagnostics.length,
    worst_markets: worstMarkets,
    primary_diagnosis: primaryDiagnosis,
    root_causes: rootCauses,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                            UNKNOWN WALLETS DRILLDOWN DIAGNOSTIC                                                                  ║');
  console.log('║  MISSION: Deep-dive into UNKNOWN failures to identify specific root causes                                                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  // Load wallets
  const allWallets = await loadBenchmarkWallets();
  console.log(`Loaded ${allWallets.length} wallets from benchmark`);
  console.log('');

  // First, classify all wallets to find UNKNOWNs
  console.log('Step 1: Classifying wallets to find UNKNOWNs...');
  const unknownWallets: BenchmarkWallet[] = [];

  for (let i = 0; i < allWallets.length; i++) {
    const w = allWallets[i];
    try {
      process.stdout.write(`\r  [${i + 1}/${allWallets.length}] ${w.wallet.substring(0, 12)}...`);
      const classification = await classifyWallet(w.wallet, w.ui_pnl);
      if (classification.classification === 'UNKNOWN') {
        unknownWallets.push(w);
      }
    } catch (err: any) {
      // Skip on error
    }
  }
  console.log(`\n\nFound ${unknownWallets.length} UNKNOWN wallets to investigate`);
  console.log('');

  if (unknownWallets.length === 0) {
    console.log('No UNKNOWN wallets found. All wallets are either PASS or MAKER.');
    return;
  }

  // Drilldown on each UNKNOWN
  console.log('Step 2: Deep-dive investigation of UNKNOWN wallets...');
  console.log('');

  const drilldowns: WalletDrilldown[] = [];

  for (let i = 0; i < unknownWallets.length; i++) {
    const w = unknownWallets[i];
    console.log(`[${i + 1}/${unknownWallets.length}] Investigating ${w.wallet.substring(0, 16)}...`);

    try {
      const dd = await drilldownWallet(w.wallet, w.ui_pnl);
      drilldowns.push(dd);
    } catch (err: any) {
      console.log(`  ⚠️ Error: ${err.message}`);
    }
  }
  console.log('');

  // ============================================================================
  // REPORT
  // ============================================================================
  console.log('═'.repeat(140));
  console.log('DRILLDOWN REPORT: UNKNOWN WALLET DIAGNOSES');
  console.log('═'.repeat(140));
  console.log('');

  for (const dd of drilldowns) {
    console.log('┌' + '─'.repeat(138) + '┐');
    console.log(`│ WALLET: ${dd.wallet.padEnd(50)} UI PnL: ${formatPnL(dd.ui_pnl).padStart(12)} │`);
    console.log(`│ V23 PnL: ${formatPnL(dd.v23_pnl).padEnd(12)} Error: ${dd.error_pct.toFixed(1).padStart(6)}% Gap: ${formatPnL(dd.ui_pnl - dd.v23_pnl).padStart(12)} │`);
    console.log('├' + '─'.repeat(138) + '┤');
    console.log(`│ PRIMARY DIAGNOSIS: ${dd.primary_diagnosis.substring(0, 116).padEnd(116)} │`);
    console.log('├' + '─'.repeat(138) + '┤');

    if (dd.root_causes.length > 0) {
      console.log('│ ROOT CAUSES:'.padEnd(139) + '│');
      for (const cause of dd.root_causes) {
        console.log(`│   • ${cause.substring(0, 130).padEnd(132)} │`);
      }
      console.log('├' + '─'.repeat(138) + '┤');
    }

    console.log('│ WORST MARKETS:'.padEnd(139) + '│');
    console.log('│   Condition ID                                      | V23 PnL    | Cash Flow  | Tokens     | Resolved | Diagnosis                     │');
    console.log('│   ' + '-'.repeat(134) + ' │');

    for (const m of dd.worst_markets) {
      const condId = m.condition_id.substring(0, 48).padEnd(50);
      const v23 = formatPnL(m.v23_pnl).padStart(10);
      const cash = formatPnL(m.cash_flow).padStart(10);
      const tokens = m.token_balance.toFixed(0).padStart(10);
      const resolved = m.resolution_price !== null ? m.resolution_price.toFixed(2).padStart(8) : 'N/A'.padStart(8);
      const diag = m.diagnosis.substring(0, 30).padEnd(30);
      console.log(`│   ${condId} | ${v23} | ${cash} | ${tokens} | ${resolved} | ${diag} │`);
    }

    console.log('└' + '─'.repeat(138) + '┘');
    console.log('');
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('═'.repeat(140));
  console.log('SUMMARY OF ROOT CAUSES');
  console.log('═'.repeat(140));
  console.log('');

  // Count root cause types
  let totalGhost = 0;
  let totalUnresolved = 0;
  let totalMissingPrice = 0;
  let totalSingleMarket = 0;

  for (const dd of drilldowns) {
    if (dd.primary_diagnosis.includes('GHOST')) totalGhost++;
    if (dd.primary_diagnosis.includes('UNRESOLVED')) totalUnresolved++;
    if (dd.primary_diagnosis.includes('MISSING_PRICE')) totalMissingPrice++;
    if (dd.primary_diagnosis.includes('SINGLE MARKET')) totalSingleMarket++;
  }

  console.log(`  GHOST MARKETS (redemption without CLOB):  ${totalGhost} wallets`);
  console.log(`  UNRESOLVED POSITIONS (tokens at $0.50):   ${totalUnresolved} wallets`);
  console.log(`  MISSING RESOLUTION PRICES:                ${totalMissingPrice} wallets`);
  console.log(`  SINGLE MARKET ISSUE:                      ${totalSingleMarket} wallets`);
  console.log('');

  // ============================================================================
  // RECOMMENDATIONS
  // ============================================================================
  console.log('═'.repeat(140));
  console.log('RECOMMENDATIONS');
  console.log('═'.repeat(140));
  console.log('');

  if (totalGhost > 0) {
    console.log('1. GHOST MARKETS FIX:');
    console.log('   • These wallets acquired tokens through Split/Merge or ERC1155 Transfer, not CLOB');
    console.log('   • V23 CLOB-only misses this acquisition - no cost basis');
    console.log('   • Options: (a) Exclude from copy trading, (b) Include Split/Merge in cost basis');
    console.log('');
  }

  if (totalUnresolved > 0) {
    console.log('2. UNRESOLVED POSITIONS FIX:');
    console.log('   • These wallets hold tokens in markets not yet resolved');
    console.log('   • V23 values at $0.50 default, but UI may use market price');
    console.log('   • Fix: Implement Mark-to-Market using last trade price');
    console.log('');
  }

  if (totalMissingPrice > 0) {
    console.log('3. MISSING RESOLUTION PRICES FIX:');
    console.log('   • Some resolved markets are missing from vw_pm_resolution_prices');
    console.log('   • Fix: Verify pm_condition_resolutions coverage, rebuild view');
    console.log('');
  }

  console.log('═'.repeat(140));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(140));
}

main().catch(console.error);
