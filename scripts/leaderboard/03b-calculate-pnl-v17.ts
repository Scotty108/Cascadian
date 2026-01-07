/**
 * CCR-v1 Leaderboard: Calculate PnL using V17 Engine Directly
 *
 * Uses the canonical V17 engine for accurate PnL calculation
 * Slower but accurate (calls engine per wallet)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';
import * as fs from 'fs';

interface Candidate {
  wallet: string;
  markets: number;
  trades: number;
  volume: number;
  active_days: number;
  trades_per_day: number;
  avg_trade_size: number;
}

async function calculatePnLWithV17() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: Calculate PnL with V17 Engine');
  console.log('='.repeat(70));
  console.log('');

  // Load candidates
  const candidatesPath = 'scripts/leaderboard/final-candidates.json';
  if (!fs.existsSync(candidatesPath)) {
    console.error('Error: final-candidates.json not found.');
    process.exit(1);
  }

  const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates: Candidate[] = candidatesData.wallets;

  // Process top 500 by volume for speed
  const topCandidates = candidates.slice(0, 500);
  console.log(`Processing top ${topCandidates.length} candidates by volume\n`);

  const engine = createV17Engine();
  const results: any[] = [];
  const startTime = Date.now();

  for (let i = 0; i < topCandidates.length; i++) {
    const c = topCandidates[i];
    process.stdout.write(`\r  Processing ${i + 1}/${topCandidates.length}: ${c.wallet.slice(0, 10)}...`);

    try {
      const pnl = await engine.compute(c.wallet);

      // Calculate win rate from resolved positions
      const resolvedPositions = pnl.positions.filter(p => p.is_resolved);
      const wins = resolvedPositions.filter(p => p.realized_pnl > 0).length;
      const losses = resolvedPositions.filter(p => p.realized_pnl < 0).length;
      const winRate = resolvedPositions.length > 0 ? wins / resolvedPositions.length : 0;

      // Calculate profit factor
      const grossGains = resolvedPositions.filter(p => p.realized_pnl > 0).reduce((s, p) => s + p.realized_pnl, 0);
      const grossLosses = Math.abs(resolvedPositions.filter(p => p.realized_pnl < 0).reduce((s, p) => s + p.realized_pnl, 0));
      const profitFactor = grossLosses > 0 ? grossGains / grossLosses : grossGains > 0 ? 99 : 0;

      // V-Score
      const velocity30d = c.trades_per_day;
      const vScore = velocity30d * Math.log10(1 + c.volume) * (0.5 + winRate) * Math.min(2, profitFactor);

      results.push({
        ...c,
        realized_pnl: pnl.realized_pnl,
        unrealized_pnl: pnl.unrealized_pnl,
        total_pnl: pnl.total_pnl,
        win_count: wins,
        loss_count: losses,
        resolved_positions: resolvedPositions.length,
        win_rate: winRate,
        profit_factor: profitFactor,
        gross_gains: grossGains,
        gross_losses: grossLosses,
        velocity_30d: velocity30d,
        v_score: vScore,
        total_gain: pnl.total_gain,
        total_loss: pnl.total_loss,
      });
    } catch (err: any) {
      console.error(`\nError for ${c.wallet}: ${err.message}`);
    }
  }

  console.log('\n\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Processed: ${results.length} wallets`);

  // Filter to ≥$200 realized PnL
  const profitable = results.filter((r) => r.realized_pnl >= 200);
  console.log(`With ≥$200 realized PnL: ${profitable.length}`);

  // Sort by realized PnL (more meaningful than V-Score for validation)
  profitable.sort((a, b) => b.realized_pnl - a.realized_pnl);

  if (profitable.length > 0) {
    const avgPnL = profitable.reduce((s, c) => s + c.realized_pnl, 0) / profitable.length;
    const avgWinRate = profitable.reduce((s, c) => s + c.win_rate, 0) / profitable.length;

    console.log(`\nPool Statistics:`);
    console.log(`  Avg Realized PnL: $${avgPnL.toFixed(2)}`);
    console.log(`  Avg Win Rate: ${(avgWinRate * 100).toFixed(1)}%`);
  }

  // Top 30 by Realized PnL
  console.log('\nTop 30 by Realized PnL:');
  console.log('-'.repeat(100));
  console.log('Wallet              | Realized PnL | Unrealized | Win Rate | PF    | Volume');
  console.log('-'.repeat(100));

  for (const c of profitable.slice(0, 30)) {
    const wallet = c.wallet.slice(0, 10) + '...' + c.wallet.slice(-4);
    const realPnl = ('$' + c.realized_pnl.toFixed(0)).padStart(12);
    const unrealPnl = ('$' + c.unrealized_pnl.toFixed(0)).padStart(10);
    const wr = ((c.win_rate * 100).toFixed(1) + '%').padStart(8);
    const pf = Math.min(99, c.profit_factor).toFixed(2).padStart(5);
    const vol = ('$' + (c.volume / 1e6).toFixed(2) + 'M').padStart(9);
    console.log(`${wallet.padEnd(19)} | ${realPnl} | ${unrealPnl} | ${wr} | ${pf} | ${vol}`);
  }

  // Save results
  const outputPath = 'scripts/leaderboard/leaderboard-v17-accurate.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated: new Date().toISOString(),
    engine: 'V17 (canonical)',
    processed: results.length,
    profitable_count: profitable.length,
    wallets: profitable,
  }, null, 2));

  console.log(`\nSaved ${profitable.length} wallets to ${outputPath}`);
  console.log(`Runtime: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
}

calculatePnLWithV17().catch(console.error);
