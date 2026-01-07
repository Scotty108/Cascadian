/**
 * Copy Trading Score Prototype
 *
 * Score = μ × M
 * Where:
 *   μ = mean(R)        - Average return per trade
 *   M = median(|R|)    - Typical move size (filters arbers)
 *   R = position_pnl / cost_basis
 *
 * This prototype uses CCR-v1's existing output to approximate the score.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';

interface ScoreResult {
  wallet: string;
  name: string;
  // From CCR-v1
  win_count: number;
  loss_count: number;
  win_rate: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  edge_ratio: number;
  realized_pnl: number;
  // Derived
  mu: number;          // Approximate mean return
  mu_note: string;     // How μ was calculated
  M: number | null;    // Median abs return (needs raw data)
  score: number | null;
  // Eligibility
  num_trades: number;
  passes_filters: boolean;
}

async function calculateScore(wallet: string, name: string): Promise<ScoreResult> {
  console.log(`\nCalculating score for ${name}...`);

  const ccr = await computeCCRv1(wallet);

  // Calculate μ (mean return per trade)
  // μ = WR × avg_win - (1-WR) × avg_loss
  const wr = ccr.win_rate;
  const avgWin = ccr.avg_win_pct / 100;  // Convert from % to decimal
  const avgLoss = ccr.avg_loss_pct / 100;
  const mu = wr * avgWin - (1 - wr) * avgLoss;

  // M requires raw position returns - we don't have them yet
  // For prototype, estimate M from avg_win and avg_loss
  // This is a rough approximation!
  const M_estimate = (avgWin + avgLoss) / 2;  // Very rough!

  const num_trades = ccr.win_count + ccr.loss_count;
  const passes_filters = num_trades > 15 && mu > 0;

  return {
    wallet,
    name,
    win_count: ccr.win_count,
    loss_count: ccr.loss_count,
    win_rate: ccr.win_rate,
    avg_win_pct: ccr.avg_win_pct,
    avg_loss_pct: ccr.avg_loss_pct,
    edge_ratio: ccr.edge_ratio,
    realized_pnl: ccr.realized_pnl,
    mu,
    mu_note: 'μ = WR × avg_win - (1-WR) × avg_loss',
    M: null,  // Need raw position data for real M
    score: null,  // Can't calculate without M
    num_trades,
    passes_filters
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('COPY TRADING SCORE PROTOTYPE');
  console.log('Score = μ × M (where μ = mean return, M = median |return|)');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  const wallets = [
    { addr: '0x92d8a88f0a9fef812bdf5628770d6a0ecee39762', name: '@biznis33' },
    { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: '@Latina' }
  ];

  const results: ScoreResult[] = [];

  for (const w of wallets) {
    const result = await calculateScore(w.addr, w.name);
    results.push(result);
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  for (const r of results) {
    console.log(`\n${r.name} (${r.wallet.slice(0,10)}...)`);
    console.log('─'.repeat(60));
    console.log(`  Win/Loss:     ${r.win_count}/${r.loss_count} (${(r.win_rate * 100).toFixed(1)}% WR)`);
    console.log(`  Avg Win:      +${r.avg_win_pct.toFixed(1)}%`);
    console.log(`  Avg Loss:     -${r.avg_loss_pct.toFixed(1)}%`);
    console.log(`  Edge Ratio:   ${r.edge_ratio.toFixed(2)}`);
    console.log(`  Realized PnL: $${r.realized_pnl.toLocaleString()}`);
    console.log('');
    console.log(`  μ (mean ret): ${(r.mu * 100).toFixed(1)}%`);
    console.log(`  M (med |ret|): [NEEDS RAW POSITION DATA]`);
    console.log(`  Score:        [NEEDS M TO CALCULATE]`);
    console.log('');
    console.log(`  Trades:       ${r.num_trades}`);
    console.log(`  Eligible:     ${r.passes_filters ? '✅ Yes' : '❌ No'}`);
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('NEXT STEPS');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('To calculate full Score, we need to:');
  console.log('1. Add getTradeReturns() to CCR-v1 that exports per-position R values');
  console.log('2. Calculate M = median(|R|) from raw position returns');
  console.log('3. Score = μ × M');
  console.log('');
  console.log('The CCR-v1 engine already calculates positionPnLs internally (line 901).');
  console.log('We just need to expose it in the output.');
}

main().catch(console.error);
