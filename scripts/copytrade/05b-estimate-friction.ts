/**
 * Phase 5B: Estimate Execution Friction from Phase 2D Metrics
 *
 * Simplified friction model:
 * - Entry friction ≈ entry_slippage_bps * total_notional
 * - Exit friction ≈ exit_slippage_bps * gross_wins (payouts)
 * - Shadow P&L = original_pnl - entry_friction - exit_friction
 *
 * This is an approximation, but captures the key dynamics:
 * - High-volume traders pay more friction
 * - Winners pay exit friction on their payouts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import * as fs from 'fs';

// Friction parameters
const FRICTION = {
  entry_slippage_bps: 50,      // 0.5% slippage on entry
  exit_slippage_bps: 30,       // 0.3% slippage on exit
};

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

interface ShadowMetrics {
  wallet: string;
  // Original metrics
  original_pnl: number;
  original_omega: number;
  n_events: number;
  total_notional: number;
  gross_wins: number;
  gross_losses: number;
  // Friction estimates
  entry_friction: number;
  exit_friction: number;
  total_friction: number;
  // Shadow metrics
  shadow_pnl: number;
  shadow_omega: number;
  execution_drag_pct: number;
  // Copy-trading flags
  is_copyable: boolean;
  rejection_reason?: string;
}

function computeShadowFromPhase2D(): ShadowMetrics[] {
  console.log('=== Phase 5B: Estimate Friction from Phase 2D Metrics ===\n');
  console.log('Friction model:');
  console.log(`  Entry friction = ${FRICTION.entry_slippage_bps} bps × total_notional`);
  console.log(`  Exit friction = ${FRICTION.exit_slippage_bps} bps × gross_wins`);
  console.log(`  Shadow P&L = original_pnl - entry_friction - exit_friction\n`);

  // Load Phase 2D output
  const phase2dPath = 'exports/copytrade/phase2d_alltime_with_orphans.json';
  if (!fs.existsSync(phase2dPath)) {
    throw new Error('Phase 2D output not found. Run 02d-alltime-with-orphans.ts first.');
  }
  const phase2d = JSON.parse(fs.readFileSync(phase2dPath, 'utf-8'));
  const wallets: Phase2DWallet[] = phase2d.wallets;
  console.log(`Loaded ${wallets.length} wallets from Phase 2D\n`);

  const results: ShadowMetrics[] = [];

  for (const w of wallets) {
    // Calculate friction
    const entry_friction = (FRICTION.entry_slippage_bps / 10000) * w.total_notional;
    const exit_friction = (FRICTION.exit_slippage_bps / 10000) * w.gross_wins;
    const total_friction = entry_friction + exit_friction;

    // Shadow P&L
    const shadow_pnl = w.realized_pnl - total_friction;

    // Shadow omega (adjust gross_wins and gross_losses for friction)
    // Entry friction affects both wins and losses proportionally
    // Exit friction only affects wins (payouts)
    const entry_pct = entry_friction / w.total_notional;
    const adjusted_gross_wins = Math.max(0, w.gross_wins - exit_friction - (entry_pct * w.gross_wins));
    const adjusted_gross_losses = w.gross_losses + (entry_pct * w.gross_losses);
    const shadow_omega = adjusted_gross_losses > 0 ? adjusted_gross_wins / adjusted_gross_losses : 0;

    // Execution drag
    const execution_drag_pct = w.realized_pnl !== 0
      ? ((w.realized_pnl - shadow_pnl) / Math.abs(w.realized_pnl)) * 100
      : 0;

    // Copyability check
    let is_copyable = true;
    let rejection_reason: string | undefined;

    if (shadow_pnl <= 0) {
      is_copyable = false;
      rejection_reason = 'Shadow P&L <= 0 (not profitable after friction)';
    } else if (shadow_omega < 1.2) {
      is_copyable = false;
      rejection_reason = `Shadow omega ${shadow_omega.toFixed(2)} < 1.2`;
    } else if (execution_drag_pct > 50) {
      is_copyable = false;
      rejection_reason = `Execution drag ${execution_drag_pct.toFixed(1)}% > 50%`;
    } else if (w.n_events < 10) {
      is_copyable = false;
      rejection_reason = `Only ${w.n_events} events (need >= 10)`;
    }

    results.push({
      wallet: w.wallet,
      original_pnl: w.realized_pnl,
      original_omega: w.omega,
      n_events: w.n_events,
      total_notional: w.total_notional,
      gross_wins: w.gross_wins,
      gross_losses: w.gross_losses,
      entry_friction: Math.round(entry_friction * 100) / 100,
      exit_friction: Math.round(exit_friction * 100) / 100,
      total_friction: Math.round(total_friction * 100) / 100,
      shadow_pnl: Math.round(shadow_pnl * 100) / 100,
      shadow_omega: Math.round(shadow_omega * 100) / 100,
      execution_drag_pct: Math.round(execution_drag_pct * 10) / 10,
      is_copyable,
      rejection_reason,
    });
  }

  // Filter to copyable wallets
  const copyable = results.filter(r => r.is_copyable);
  const rejected = results.filter(r => !r.is_copyable);

  console.log(`\n=== RESULTS ===`);
  console.log(`Copyable wallets: ${copyable.length}`);
  console.log(`Rejected wallets: ${rejected.length}`);

  // Sort copyable by shadow omega
  copyable.sort((a, b) => b.shadow_omega - a.shadow_omega);

  // Display top 30
  console.log('\n=== TOP 30 by Shadow Omega ===');
  console.log('Wallet                                     | Orig P&L | Shad P&L | Friction | Drag% | Orig Ω | Shad Ω | Events');
  console.log('-------------------------------------------|----------|----------|----------|-------|--------|--------|-------');
  for (const r of copyable.slice(0, 30)) {
    const origPnl = r.original_pnl >= 0 ? `+$${Math.round(r.original_pnl).toLocaleString()}` : `-$${Math.abs(Math.round(r.original_pnl)).toLocaleString()}`;
    const shadPnl = r.shadow_pnl >= 0 ? `+$${Math.round(r.shadow_pnl).toLocaleString()}` : `-$${Math.abs(Math.round(r.shadow_pnl)).toLocaleString()}`;
    const friction = `$${Math.round(r.total_friction).toLocaleString()}`;
    console.log(
      `${r.wallet} | ${origPnl.padStart(8)} | ${shadPnl.padStart(8)} | ${friction.padStart(8)} | ${String(r.execution_drag_pct).padStart(5)}% | ${String(r.original_omega).padStart(6)}x | ${String(r.shadow_omega).padStart(6)}x | ${String(r.n_events).padStart(6)}`
    );
  }

  // Show rejection reasons
  console.log('\n=== REJECTION BREAKDOWN ===');
  const reasons = rejected.reduce((acc, r) => {
    const key = r.rejection_reason || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}: ${reason}`);
  }

  // Save output
  const outputPath = 'exports/copytrade/phase5b_shadow_estimated.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '5B',
    description: 'Shadow P&L estimated from Phase 2D metrics (friction model)',
    friction_params: FRICTION,
    methodology: {
      entry_friction: 'entry_slippage_bps × total_notional',
      exit_friction: 'exit_slippage_bps × gross_wins',
      shadow_pnl: 'original_pnl - entry_friction - exit_friction',
    },
    gate_criteria: {
      shadow_pnl: '> 0',
      shadow_omega: '> 1.2',
      execution_drag_pct: '< 50%',
      n_events: '>= 10',
    },
    input_count: wallets.length,
    copyable_count: copyable.length,
    rejected_count: rejected.length,
    rejection_breakdown: reasons,
    wallets: copyable,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return copyable;
}

if (require.main === module) {
  computeShadowFromPhase2D();
}
