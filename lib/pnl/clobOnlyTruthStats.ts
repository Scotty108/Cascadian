/**
 * CLOB-Only Truth Stats Utility
 * Computes running statistics on the scraped ground truth dataset
 */

import * as fs from 'fs';
import * as path from 'path';

export interface WalletTruthEntry {
  wallet: string;
  uiPnl: number;
  gain: number;
  loss: number;
  volume: number;
  scrapedAt: string;
  identityCheckPass: boolean;
  clobEvents: number;
  openPositionsApprox: number;
  cashFlowEstimate: number;
  notes?: string;
  v29Pnl?: number;
  v29Error?: number;
  v29ErrorPct?: number;
}

export interface TruthDataset {
  metadata: {
    generated_at: string;
    source: string;
    method: string;
    classification: string;
    wallet_count: number;
    identity_pass_count: number;
  };
  wallets: WalletTruthEntry[];
  validation_method?: object;
}

export interface PnlBins {
  loss_large: number;    // < -$10k
  loss_medium: number;   // -$10k to -$1k
  loss_small: number;    // -$1k to $0
  gain_small: number;    // $0 to $1k
  gain_medium: number;   // $1k to $10k
  gain_large: number;    // > $10k
}

export interface PositionBins {
  bin_1_10: number;
  bin_11_25: number;
  bin_26_50: number;
  bin_51_100: number;
  bin_100_plus: number;
}

export interface V29Comparison {
  wallet: string;
  uiPnl: number;
  v29Pnl: number;
  absError: number;
  pctError: number;
}

export interface TruthStats {
  wallet_count: number;
  identity_pass_count: number;
  identity_pass_rate: number;
  high_pnl_count: number;  // |PnL| >= $500
  skipped_count: number;   // |PnL| < $500

  pnl_bins: PnlBins;
  position_bins: PositionBins;

  // Cash flow vs UI sanity
  cashflow_ui_correlation: number;
  cashflow_ui_sign_match_rate: number;

  // V29 comparisons (if available)
  v29_comparisons?: {
    count: number;
    within_1_dollar: number;
    within_5_dollars: number;
    within_10_dollars: number;
    within_1_pct: number;
    within_2_pct: number;
    worst_3: V29Comparison[];
  };
}

const TRUTH_PATH = path.join(process.cwd(), 'data/regression/clob_only_truth_v1.json');
const PROGRESS_PATH = path.join(process.cwd(), 'tmp/clob_only_truth_progress.jsonl');
const STATS_SNAPSHOT_PATH = path.join(process.cwd(), 'tmp/clob_only_truth_stats_snapshot.json');

export function loadTruthDataset(): TruthDataset | null {
  try {
    const data = fs.readFileSync(TRUTH_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function saveTruthDataset(dataset: TruthDataset): void {
  fs.writeFileSync(TRUTH_PATH, JSON.stringify(dataset, null, 2));
}

export function appendProgressEntry(entry: Partial<WalletTruthEntry> & { skipped?: boolean }): void {
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFileSync(PROGRESS_PATH, line);
}

function classifyPnlBin(pnl: number): keyof PnlBins {
  if (pnl < -10000) return 'loss_large';
  if (pnl < -1000) return 'loss_medium';
  if (pnl < 0) return 'loss_small';
  if (pnl < 1000) return 'gain_small';
  if (pnl < 10000) return 'gain_medium';
  return 'gain_large';
}

function classifyPositionBin(positions: number): keyof PositionBins {
  if (positions <= 10) return 'bin_1_10';
  if (positions <= 25) return 'bin_11_25';
  if (positions <= 50) return 'bin_26_50';
  if (positions <= 100) return 'bin_51_100';
  return 'bin_100_plus';
}

export function computeStats(dataset: TruthDataset, v29Results?: Map<string, number>): TruthStats {
  const wallets = dataset.wallets;

  // Basic counts
  const wallet_count = wallets.length;
  const identity_pass_count = wallets.filter(w => w.identityCheckPass).length;
  const high_pnl_count = wallets.filter(w => Math.abs(w.uiPnl) >= 500).length;
  const skipped_count = wallet_count - high_pnl_count;

  // PnL bins
  const pnl_bins: PnlBins = {
    loss_large: 0,
    loss_medium: 0,
    loss_small: 0,
    gain_small: 0,
    gain_medium: 0,
    gain_large: 0,
  };

  // Position bins
  const position_bins: PositionBins = {
    bin_1_10: 0,
    bin_11_25: 0,
    bin_26_50: 0,
    bin_51_100: 0,
    bin_100_plus: 0,
  };

  // Cash flow correlation
  let signMatches = 0;
  const cashflows: number[] = [];
  const uiPnls: number[] = [];

  for (const w of wallets) {
    pnl_bins[classifyPnlBin(w.uiPnl)]++;
    position_bins[classifyPositionBin(w.openPositionsApprox)]++;

    cashflows.push(w.cashFlowEstimate);
    uiPnls.push(w.uiPnl);

    const cfSign = w.cashFlowEstimate >= 0 ? 1 : -1;
    const pnlSign = w.uiPnl >= 0 ? 1 : -1;
    if (cfSign === pnlSign) signMatches++;
  }

  // Simple correlation
  const correlation = computeCorrelation(cashflows, uiPnls);

  const stats: TruthStats = {
    wallet_count,
    identity_pass_count,
    identity_pass_rate: wallet_count > 0 ? identity_pass_count / wallet_count : 0,
    high_pnl_count,
    skipped_count,
    pnl_bins,
    position_bins,
    cashflow_ui_correlation: correlation,
    cashflow_ui_sign_match_rate: wallet_count > 0 ? signMatches / wallet_count : 0,
  };

  // V29 comparisons if available
  if (v29Results && v29Results.size > 0) {
    const comparisons: V29Comparison[] = [];

    for (const w of wallets) {
      const v29Pnl = v29Results.get(w.wallet);
      if (v29Pnl !== undefined) {
        const absError = Math.abs(v29Pnl - w.uiPnl);
        const pctError = w.uiPnl !== 0 ? Math.abs((v29Pnl - w.uiPnl) / w.uiPnl) * 100 : (v29Pnl === 0 ? 0 : 100);
        comparisons.push({
          wallet: w.wallet,
          uiPnl: w.uiPnl,
          v29Pnl,
          absError,
          pctError,
        });
      }
    }

    if (comparisons.length > 0) {
      const sorted = [...comparisons].sort((a, b) => b.absError - a.absError);

      stats.v29_comparisons = {
        count: comparisons.length,
        within_1_dollar: comparisons.filter(c => c.absError <= 1).length,
        within_5_dollars: comparisons.filter(c => c.absError <= 5).length,
        within_10_dollars: comparisons.filter(c => c.absError <= 10).length,
        within_1_pct: comparisons.filter(c => c.pctError <= 1).length,
        within_2_pct: comparisons.filter(c => c.pctError <= 2).length,
        worst_3: sorted.slice(0, 3),
      };
    }
  }

  return stats;
}

function computeCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;

  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den > 0 ? num / den : 0;
}

export function saveStatsSnapshot(stats: TruthStats): void {
  fs.writeFileSync(STATS_SNAPSHOT_PATH, JSON.stringify(stats, null, 2));
}

export function formatDashboard(stats: TruthStats): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  CLOB-ONLY TRUTH SCRAPING DASHBOARD');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`  Wallets scraped:     ${stats.wallet_count}`);
  lines.push(`  Identity pass rate:  ${stats.identity_pass_count}/${stats.wallet_count} (${(stats.identity_pass_rate * 100).toFixed(1)}%)`);
  lines.push(`  |PnL| >= $500:       ${stats.high_pnl_count}`);
  lines.push(`  Skipped (low PnL):   ${stats.skipped_count}`);
  lines.push('');
  lines.push('  PnL Distribution:');
  lines.push(`    Loss Large (<-$10k):  ${stats.pnl_bins.loss_large}`);
  lines.push(`    Loss Medium (-$10k to -$1k): ${stats.pnl_bins.loss_medium}`);
  lines.push(`    Loss Small (-$1k to $0): ${stats.pnl_bins.loss_small}`);
  lines.push(`    Gain Small ($0 to $1k): ${stats.pnl_bins.gain_small}`);
  lines.push(`    Gain Medium ($1k to $10k): ${stats.pnl_bins.gain_medium}`);
  lines.push(`    Gain Large (>$10k): ${stats.pnl_bins.gain_large}`);
  lines.push('');
  lines.push('  Open Positions Distribution:');
  lines.push(`    1-10:     ${stats.position_bins.bin_1_10}`);
  lines.push(`    11-25:    ${stats.position_bins.bin_11_25}`);
  lines.push(`    26-50:    ${stats.position_bins.bin_26_50}`);
  lines.push(`    51-100:   ${stats.position_bins.bin_51_100}`);
  lines.push(`    100+:     ${stats.position_bins.bin_100_plus}`);
  lines.push('');
  lines.push(`  CashFlow vs UI correlation: ${stats.cashflow_ui_correlation.toFixed(3)}`);
  lines.push(`  Sign match rate: ${(stats.cashflow_ui_sign_match_rate * 100).toFixed(1)}%`);

  if (stats.v29_comparisons) {
    const v = stats.v29_comparisons;
    lines.push('');
    lines.push('  V29 vs UI Accuracy:');
    lines.push(`    Compared: ${v.count} wallets`);
    lines.push(`    Within $1:  ${v.within_1_dollar}/${v.count} (${(v.within_1_dollar / v.count * 100).toFixed(1)}%)`);
    lines.push(`    Within $5:  ${v.within_5_dollars}/${v.count} (${(v.within_5_dollars / v.count * 100).toFixed(1)}%)`);
    lines.push(`    Within $10: ${v.within_10_dollars}/${v.count} (${(v.within_10_dollars / v.count * 100).toFixed(1)}%)`);
    lines.push(`    Within 1%:  ${v.within_1_pct}/${v.count} (${(v.within_1_pct / v.count * 100).toFixed(1)}%)`);
    lines.push(`    Within 2%:  ${v.within_2_pct}/${v.count} (${(v.within_2_pct / v.count * 100).toFixed(1)}%)`);

    if (v.worst_3.length > 0) {
      lines.push('');
      lines.push('  Worst 3 errors:');
      for (const w of v.worst_3) {
        lines.push(`    ${w.wallet.slice(0, 10)}... UI: $${w.uiPnl.toFixed(2)}, V29: $${w.v29Pnl.toFixed(2)}, Err: $${w.absError.toFixed(2)} (${w.pctError.toFixed(1)}%)`);
      }
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

export function getInterpretation(stats: TruthStats): string {
  const parts: string[] = [];
  parts.push(`So far: ${stats.wallet_count} wallets, ${stats.identity_pass_count} identity pass`);

  if (stats.v29_comparisons) {
    const v = stats.v29_comparisons;
    parts.push(`${v.within_10_dollars}/${v.count} within $10`);
  }

  if (stats.high_pnl_count >= 40) {
    parts.push('✓ Ready for ui-parity test');
  } else {
    parts.push(`Need ${40 - stats.high_pnl_count} more high-PnL wallets`);
  }

  return parts.join(', ');
}
