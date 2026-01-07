/**
 * Validate Score = μ × M Formula
 *
 * This script validates each component of the scoring formula:
 * 1. R_i = positionPnl / costBasis (per-position return)
 * 2. μ = mean(R_i) (average return per trade)
 * 3. M = median(|R_i|) (typical move size)
 * 4. Score = μ × M
 *
 * Usage: npx tsx scripts/validate-score-formula.ts [wallet_address]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';
import { calculateScore } from '../lib/leaderboard/scoring';

// Manual implementations for validation
function manualMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function manualMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

async function validate(wallet: string) {
  console.log('═'.repeat(80));
  console.log('SCORE FORMULA VALIDATION');
  console.log('Score = μ × M');
  console.log('═'.repeat(80));
  console.log(`\nWallet: ${wallet}\n`);

  // Get CCR-v1 metrics
  const metrics = await computeCCRv1(wallet);
  const returns = metrics.position_returns;

  console.log('─'.repeat(80));
  console.log('STEP 1: Validate position_returns (R_i)');
  console.log('─'.repeat(80));
  console.log(`Total positions: ${returns.length}`);
  console.log(`\nSample R_i values (first 10):`);
  returns.slice(0, 10).forEach((r, i) => {
    console.log(`  R_${i + 1} = ${r.toFixed(4)} (${(r * 100).toFixed(1)}%)`);
  });

  // Validate R_i range
  const minR = Math.min(...returns);
  const maxR = Math.max(...returns);
  console.log(`\nR_i range: [${minR.toFixed(4)}, ${maxR.toFixed(4)}]`);
  console.log(`Expected: -1.0 (100% loss) to ~3.0+ (300%+ gain)`);
  console.log(`Status: ${minR >= -1.01 && maxR <= 10 ? '✅ Valid range' : '⚠️ Check outliers'}`);

  console.log('\n' + '─'.repeat(80));
  console.log('STEP 2: Validate μ = mean(R_i)');
  console.log('─'.repeat(80));

  // Calculate μ using library
  const { mu: libraryMu } = calculateScore(returns);

  // Calculate μ manually
  const manualMu = manualMean(returns);

  console.log(`Library μ:  ${libraryMu.toFixed(6)} (${(libraryMu * 100).toFixed(2)}%)`);
  console.log(`Manual μ:   ${manualMu.toFixed(6)} (${(manualMu * 100).toFixed(2)}%)`);
  console.log(`Difference: ${Math.abs(libraryMu - manualMu).toFixed(10)}`);
  console.log(`Status: ${Math.abs(libraryMu - manualMu) < 0.0001 ? '✅ Match' : '❌ Mismatch'}`);

  // Cross-check with CCR-v1's avg_win/avg_loss
  const winReturns = returns.filter(r => r > 0);
  const lossReturns = returns.filter(r => r < 0);
  console.log(`\nBreakdown:`);
  console.log(`  Winning positions: ${winReturns.length} (avg: ${(manualMean(winReturns) * 100).toFixed(1)}%)`);
  console.log(`  Losing positions:  ${lossReturns.length} (avg: ${(manualMean(lossReturns) * 100).toFixed(1)}%)`);
  console.log(`  CCR-v1 avg_win_pct: ${metrics.avg_win_pct}%`);
  console.log(`  CCR-v1 avg_loss_pct: -${metrics.avg_loss_pct}%`);

  console.log('\n' + '─'.repeat(80));
  console.log('STEP 3: Validate M = median(|R_i|)');
  console.log('─'.repeat(80));

  // Calculate M using library
  const { M: libraryM } = calculateScore(returns);

  // Calculate M manually
  const absReturns = returns.map(Math.abs);
  const manualM = manualMedian(absReturns);

  console.log(`Library M:  ${libraryM.toFixed(6)} (${(libraryM * 100).toFixed(2)}%)`);
  console.log(`Manual M:   ${manualM.toFixed(6)} (${(manualM * 100).toFixed(2)}%)`);
  console.log(`Difference: ${Math.abs(libraryM - manualM).toFixed(10)}`);
  console.log(`Status: ${Math.abs(libraryM - manualM) < 0.0001 ? '✅ Match' : '❌ Mismatch'}`);

  // Show |R_i| distribution
  const sorted = [...absReturns].sort((a, b) => a - b);
  console.log(`\n|R_i| distribution:`);
  console.log(`  Min:    ${sorted[0].toFixed(4)} (${(sorted[0] * 100).toFixed(1)}%)`);
  console.log(`  25th:   ${sorted[Math.floor(sorted.length * 0.25)].toFixed(4)}`);
  console.log(`  Median: ${manualM.toFixed(4)} (${(manualM * 100).toFixed(1)}%)`);
  console.log(`  75th:   ${sorted[Math.floor(sorted.length * 0.75)].toFixed(4)}`);
  console.log(`  Max:    ${sorted[sorted.length - 1].toFixed(4)} (${(sorted[sorted.length - 1] * 100).toFixed(1)}%)`);

  console.log('\n' + '─'.repeat(80));
  console.log('STEP 4: Validate Score = μ × M');
  console.log('─'.repeat(80));

  const { score: libraryScore } = calculateScore(returns);
  const manualScore = manualMu * manualM;

  console.log(`Library Score: ${libraryScore.toFixed(6)}`);
  console.log(`Manual Score:  ${manualScore.toFixed(6)}`);
  console.log(`Formula: ${manualMu.toFixed(4)} × ${manualM.toFixed(4)} = ${manualScore.toFixed(6)}`);
  console.log(`Difference: ${Math.abs(libraryScore - manualScore).toFixed(10)}`);
  console.log(`Status: ${Math.abs(libraryScore - manualScore) < 0.0001 ? '✅ Match' : '❌ Mismatch'}`);

  console.log('\n' + '═'.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('═'.repeat(80));

  const checks = [
    { name: 'R_i range valid', pass: minR >= -1.01 && maxR <= 10 },
    { name: 'μ calculation', pass: Math.abs(libraryMu - manualMu) < 0.0001 },
    { name: 'M calculation', pass: Math.abs(libraryM - manualM) < 0.0001 },
    { name: 'Score calculation', pass: Math.abs(libraryScore - manualScore) < 0.0001 },
  ];

  checks.forEach(c => {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);
  });

  const allPass = checks.every(c => c.pass);
  console.log(`\nOverall: ${allPass ? '✅ ALL VALIDATIONS PASSED' : '❌ SOME VALIDATIONS FAILED'}`);

  console.log('\n' + '─'.repeat(80));
  console.log('FINAL METRICS');
  console.log('─'.repeat(80));
  console.log(`  μ (mean return):   ${(manualMu * 100).toFixed(2)}%`);
  console.log(`  M (typical move):  ${(manualM * 100).toFixed(2)}%`);
  console.log(`  Score (μ × M):     ${manualScore.toFixed(6)}`);
  console.log(`  Positions:         ${returns.length}`);
  console.log(`  Win Rate:          ${(metrics.win_rate * 100).toFixed(1)}%`);
  console.log(`  Realized PnL:      $${metrics.realized_pnl.toLocaleString()}`);
}

// Run
const wallet = process.argv[2] || '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';
validate(wallet).catch(console.error);
