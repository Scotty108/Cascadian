/**
 * Phase 6: Apply Hard Filters for Scalpers and Safe-Bet Grinders
 *
 * SCALPER DETECTION:
 * - High trades-per-position ratio (frequent trading)
 * - Low average position size (small bets)
 * - Short average hold time (when available)
 *
 * SAFE-BET GRINDER DETECTION:
 * - High win rate (> 75%) combined with low omega
 * - Low average profit per win (grinding small edges)
 * - Pattern: betting on near-certain outcomes
 *
 * USER REQUIREMENT: Do NOT use "all-time PnL < $200k" as crowding proxy.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import * as fs from 'fs';

// Filter thresholds
const FILTERS = {
  // Scalper filters
  max_trades_per_position: 8,      // Scalpers trade same position many times
  min_avg_position_size: 100,      // Skip tiny bets
  // Safe-bet grinder filters
  max_win_rate_for_low_omega: 80,  // High win rate + low omega = grinder
  min_omega_for_high_win_rate: 1.5, // If win rate > 70%, omega must be > 1.5
  max_avg_profit_per_win: 5000,    // Low avg profit per win = grinding
  min_profit_per_win_ratio: 0.03,  // profit/notional per win must be > 3%
  // Activity filters
  min_days_active: 7,              // Must have traded over multiple days
};

interface Phase5BWallet {
  wallet: string;
  original_pnl: number;
  original_omega: number;
  n_events: number;
  total_notional: number;
  gross_wins: number;
  gross_losses: number;
  entry_friction: number;
  exit_friction: number;
  total_friction: number;
  shadow_pnl: number;
  shadow_omega: number;
  execution_drag_pct: number;
  is_copyable: boolean;
  rejection_reason?: string;
}

interface Phase2DWallet {
  wallet: string;
  n_positions: number;
  n_events: number;
  n_trades: number;
  total_notional: number;
  n_resolved: number;
  n_orphaned: number;
  n_wins: number;
  n_losses: number;
  win_pct: number;
  omega: number;
  realized_pnl: number;
  orphan_pnl: number;
  gross_wins: number;
  gross_losses: number;
  first_trade: string;
  last_trade: string;
  tier?: string;
}

interface FilteredWallet extends Phase5BWallet {
  // Additional metrics for filtering
  n_positions: number;
  n_trades: number;
  n_wins: number;
  n_losses: number;
  win_pct: number;
  first_trade: string;
  last_trade: string;
  // Derived metrics
  trades_per_position: number;
  avg_position_size: number;
  avg_profit_per_win: number;
  profit_per_win_ratio: number;
  days_active: number;
  // Filter results
  filter_flags: string[];
  passed_filters: boolean;
}

function applyFilters(): FilteredWallet[] {
  console.log('=== Phase 6: Apply Scalper/Grinder Filters ===\n');
  console.log('Filter thresholds:');
  console.log('  SCALPER:');
  console.log(`    max_trades_per_position: ${FILTERS.max_trades_per_position}`);
  console.log(`    min_avg_position_size: $${FILTERS.min_avg_position_size}`);
  console.log('  SAFE-BET GRINDER:');
  console.log(`    max_win_rate_for_low_omega: ${FILTERS.max_win_rate_for_low_omega}%`);
  console.log(`    min_omega_for_high_win_rate: ${FILTERS.min_omega_for_high_win_rate}x`);
  console.log(`    min_profit_per_win_ratio: ${FILTERS.min_profit_per_win_ratio * 100}%`);
  console.log('  ACTIVITY:');
  console.log(`    min_days_active: ${FILTERS.min_days_active}\n`);

  // Load Phase 5B output
  const phase5bPath = 'exports/copytrade/phase5b_shadow_estimated.json';
  if (!fs.existsSync(phase5bPath)) {
    throw new Error('Phase 5B output not found. Run 05b-estimate-friction.ts first.');
  }
  const phase5b = JSON.parse(fs.readFileSync(phase5bPath, 'utf-8'));
  const phase5bWallets: Phase5BWallet[] = phase5b.wallets;

  // Load Phase 2D for additional metrics
  const phase2dPath = 'exports/copytrade/phase2d_alltime_with_orphans.json';
  if (!fs.existsSync(phase2dPath)) {
    throw new Error('Phase 2D output not found.');
  }
  const phase2d = JSON.parse(fs.readFileSync(phase2dPath, 'utf-8'));
  const phase2dMap = new Map<string, Phase2DWallet>(
    phase2d.wallets.map((w: Phase2DWallet) => [w.wallet, w])
  );

  console.log(`Loaded ${phase5bWallets.length} wallets from Phase 5B\n`);

  const results: FilteredWallet[] = [];

  for (const w5 of phase5bWallets) {
    const w2 = phase2dMap.get(w5.wallet);
    if (!w2) continue;

    // Calculate derived metrics
    const trades_per_position = w2.n_positions > 0 ? w2.n_trades / w2.n_positions : 0;
    const avg_position_size = w2.n_positions > 0 ? w2.total_notional / w2.n_positions : 0;
    const avg_profit_per_win = w2.n_wins > 0 ? w2.gross_wins / w2.n_wins : 0;
    const profit_per_win_ratio = w2.total_notional > 0
      ? (w2.n_wins > 0 ? w2.gross_wins / w2.n_wins : 0) / (w2.total_notional / w2.n_positions)
      : 0;

    // Calculate days active
    const firstTrade = new Date(w2.first_trade);
    const lastTrade = new Date(w2.last_trade);
    const days_active = Math.ceil((lastTrade.getTime() - firstTrade.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Apply filters
    const filter_flags: string[] = [];

    // Scalper check
    if (trades_per_position > FILTERS.max_trades_per_position) {
      filter_flags.push(`SCALPER: ${trades_per_position.toFixed(1)} trades/position > ${FILTERS.max_trades_per_position}`);
    }
    if (avg_position_size < FILTERS.min_avg_position_size) {
      filter_flags.push(`SMALL_BETS: avg $${Math.round(avg_position_size)} < $${FILTERS.min_avg_position_size}`);
    }

    // Safe-bet grinder check
    if (w2.win_pct > FILTERS.max_win_rate_for_low_omega && w2.omega < FILTERS.min_omega_for_high_win_rate) {
      filter_flags.push(`GRINDER: ${w2.win_pct}% win rate but only ${w2.omega}x omega`);
    }
    if (profit_per_win_ratio < FILTERS.min_profit_per_win_ratio && w2.n_wins >= 5) {
      filter_flags.push(`LOW_EDGE: ${(profit_per_win_ratio * 100).toFixed(1)}% profit/win ratio < ${FILTERS.min_profit_per_win_ratio * 100}%`);
    }

    // Activity check
    if (days_active < FILTERS.min_days_active) {
      filter_flags.push(`SHORT_HISTORY: ${days_active} days < ${FILTERS.min_days_active}`);
    }

    const passed_filters = filter_flags.length === 0;

    results.push({
      ...w5,
      n_positions: w2.n_positions,
      n_trades: w2.n_trades,
      n_wins: w2.n_wins,
      n_losses: w2.n_losses,
      win_pct: w2.win_pct,
      first_trade: w2.first_trade,
      last_trade: w2.last_trade,
      trades_per_position: Math.round(trades_per_position * 10) / 10,
      avg_position_size: Math.round(avg_position_size),
      avg_profit_per_win: Math.round(avg_profit_per_win),
      profit_per_win_ratio: Math.round(profit_per_win_ratio * 1000) / 1000,
      days_active,
      filter_flags,
      passed_filters,
    });
  }

  // Separate passed and filtered
  const passed = results.filter(r => r.passed_filters);
  const filtered = results.filter(r => !r.passed_filters);

  console.log(`=== RESULTS ===`);
  console.log(`Passed all filters: ${passed.length}`);
  console.log(`Filtered out: ${filtered.length}\n`);

  // Sort passed by shadow omega
  passed.sort((a, b) => b.shadow_omega - a.shadow_omega);

  // Display top 20 passed
  console.log('=== TOP 20 COPYABLE WALLETS (passed all filters) ===');
  console.log('Wallet                                     | Shad Ω | Win% | P&L      | Pos  | Trades | $/Pos | Days');
  console.log('-------------------------------------------|--------|------|----------|------|--------|-------|-----');
  for (const r of passed.slice(0, 20)) {
    const pnl = r.shadow_pnl >= 0 ? `+$${Math.round(r.shadow_pnl).toLocaleString()}` : `-$${Math.abs(Math.round(r.shadow_pnl)).toLocaleString()}`;
    console.log(
      `${r.wallet} | ${String(r.shadow_omega).padStart(6)}x | ${String(r.win_pct).padStart(4)}% | ${pnl.padStart(8)} | ${String(r.n_positions).padStart(4)} | ${String(r.n_trades).padStart(6)} | ${('$' + r.avg_position_size).padStart(5)} | ${String(r.days_active).padStart(4)}`
    );
  }

  // Show filtered wallets with reasons
  console.log(`\n=== FILTERED OUT (${filtered.length}) ===`);
  for (const r of filtered) {
    console.log(`  ${r.wallet}: ${r.filter_flags.join(', ')}`);
  }

  // Aggregate filter reasons
  const allFlags = filtered.flatMap(r => r.filter_flags.map(f => f.split(':')[0]));
  const flagCounts = allFlags.reduce((acc, flag) => {
    acc[flag] = (acc[flag] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\n=== FILTER BREAKDOWN ===');
  for (const [flag, count] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${flag}: ${count}`);
  }

  // Save output
  const outputPath = 'exports/copytrade/phase6_filtered.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '6',
    description: 'Wallets after scalper/grinder filters',
    filter_thresholds: FILTERS,
    input_count: phase5bWallets.length,
    passed_count: passed.length,
    filtered_count: filtered.length,
    filter_breakdown: flagCounts,
    wallets: passed,
    filtered_wallets: filtered.map(r => ({
      wallet: r.wallet,
      reasons: r.filter_flags,
    })),
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return passed;
}

if (require.main === module) {
  applyFilters();
}
