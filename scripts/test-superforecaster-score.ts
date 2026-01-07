/**
 * Test Superforecaster Score using CCR-v1
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeWalletScore } from '../lib/leaderboard/superforecasterScore';
import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

async function main() {
  const wallet = process.argv[2] || '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

  console.log('═'.repeat(70));
  console.log('SUPERFORECASTER SCORE (CCR-v1 Based)');
  console.log(`Wallet: ${wallet.slice(0, 12)}...`);
  console.log('═'.repeat(70));

  // First show CCR-v1 metrics
  console.log('\nRunning CCR-v1...');
  const metrics = await computeCCRv1(wallet);

  console.log('\n' + '─'.repeat(70));
  console.log('CCR-v1 METRICS');
  console.log('─'.repeat(70));
  console.log(`Total PnL:        $${metrics.total_pnl.toLocaleString()}`);
  console.log(`Realized PnL:     $${metrics.realized_pnl.toLocaleString()}`);
  console.log(`Positions:        ${metrics.positions_count}`);
  console.log(`Resolved:         ${metrics.resolved_count}`);
  console.log(`Win/Loss:         ${metrics.win_count}/${metrics.loss_count}`);
  console.log(`Win Rate:         ${(metrics.win_rate * 100).toFixed(1)}%`);
  console.log(`Total Trades:     ${metrics.total_trades}`);
  console.log(`Position Returns: ${metrics.position_returns.length} entries`);

  // Show return distribution
  if (metrics.position_returns.length > 0) {
    const returns = metrics.position_returns.sort((a, b) => a - b);
    console.log('\nReturn Distribution (decimal):');
    console.log(`  Min:    ${returns[0].toFixed(4)}`);
    console.log(`  p25:    ${returns[Math.floor(returns.length * 0.25)].toFixed(4)}`);
    console.log(`  Median: ${returns[Math.floor(returns.length * 0.5)].toFixed(4)}`);
    console.log(`  p75:    ${returns[Math.floor(returns.length * 0.75)].toFixed(4)}`);
    console.log(`  Max:    ${returns[returns.length - 1].toFixed(4)}`);
  }

  // Now compute the score
  console.log('\n' + '═'.repeat(70));
  console.log('SUPERFORECASTER SCORE');
  console.log('═'.repeat(70));

  const score = await computeWalletScore(wallet);

  if (score.eligible) {
    console.log(`\nSCORE: ${score.score.toFixed(6)}`);
    console.log('');
    console.log('Formula: Score = μ_cap × √M');
    console.log('─'.repeat(40));
    console.log(`μ_raw (raw mean):     ${(score.muRaw * 100).toFixed(2)}%`);
    console.log(`p95+ (win cap):       ${(score.p95Plus * 100).toFixed(2)}%`);
    console.log(`μ_cap (capped mean):  ${(score.muCap * 100).toFixed(2)}%`);
    console.log(`M (median abs):       ${(score.M * 100).toFixed(2)}%`);
    console.log(`√M:                   ${Math.sqrt(score.M).toFixed(4)}`);
    console.log('');
    console.log('Diagnostics:');
    console.log(`  Num positions:  ${score.numPositions}`);
    console.log(`  Num wins:       ${score.numWins}`);
    console.log(`  Win rate:       ${(score.winRate * 100).toFixed(1)}%`);
    console.log(`  Avg win:        +${score.avgWinPct.toFixed(1)}%`);
    console.log(`  Avg loss:       -${score.avgLossPct.toFixed(1)}%`);
  } else {
    console.log(`\nNot eligible: ${score.reason}`);
  }

  console.log('\n' + '═'.repeat(70));
}

main().catch(console.error);
