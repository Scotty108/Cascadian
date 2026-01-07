/**
 * Test Position Return Engine
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computePositionReturns, computeMarketReturns, calculateWalletScore } from '../lib/pnl/positionReturnEngine';

async function main() {
  const wallet = process.argv[2] || '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

  console.log('═'.repeat(70));
  console.log('MARKET-LEVEL RETURN ENGINE TEST');
  console.log(`Wallet: ${wallet.slice(0, 12)}...`);
  console.log('═'.repeat(70));

  // Use market-level returns (combines split pairs)
  const returns = await computeMarketReturns(wallet);

  console.log('\n' + '─'.repeat(70));
  console.log('SUMMARY');
  console.log('─'.repeat(70));
  console.log(`Markets (resolved):   ${returns.positions.length}`);
  console.log(`Num trades:           ${returns.numTrades}`);
  console.log(`Num markets:          ${returns.numMarkets}`);
  console.log(`Wins:                 ${returns.numWins}`);
  console.log(`Losses:               ${returns.numLosses}`);
  console.log(`Win Rate:             ${returns.numWins + returns.numLosses > 0
    ? ((returns.numWins / (returns.numWins + returns.numLosses)) * 100).toFixed(1)
    : 0}%`);
  console.log(`Total Return:         ${(returns.totalReturn * 100).toFixed(2)}%`);
  console.log(`Avg Return:           ${(returns.avgReturn * 100).toFixed(2)}%`);

  // Show top 5 wins and losses
  console.log('\n' + '─'.repeat(70));
  console.log('TOP 5 WINS');
  const sortedWins = returns.positions.filter(p => p.isWin).sort((a, b) => b.returnPct - a.returnPct);
  for (const p of sortedWins.slice(0, 5)) {
    console.log(`  ${p.conditionId.slice(0, 12)}... | +${p.returnPct.toFixed(1)}% | Entry: $${p.entryCost.toFixed(0)} | Exit: $${p.exitValue.toFixed(0)}`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('TOP 5 LOSSES');
  const sortedLosses = returns.positions.filter(p => !p.isWin).sort((a, b) => a.returnPct - b.returnPct);
  for (const p of sortedLosses.slice(0, 5)) {
    console.log(`  ${p.conditionId.slice(0, 12)}... | ${p.returnPct.toFixed(1)}% | Entry: $${p.entryCost.toFixed(0)} | Exit: $${p.exitValue.toFixed(0)}`);
  }

  // Calculate score
  console.log('\n' + '═'.repeat(70));
  console.log('SUPERFORECASTER SCORE');
  console.log('═'.repeat(70));

  const score = calculateWalletScore(returns);

  if (score.eligible) {
    console.log(`Score:          ${score.score.toFixed(6)}`);
    console.log(`μ_raw:          ${(score.muRaw * 100).toFixed(2)}%`);
    console.log(`μ_cap:          ${(score.muCap * 100).toFixed(2)}%`);
    console.log(`p95_plus:       ${(score.p95Plus * 100).toFixed(2)}%`);
    console.log(`M (median abs): ${(score.M * 100).toFixed(2)}%`);
  } else {
    console.log(`Not eligible: ${score.reason}`);
  }

  // Calculate total PnL for comparison
  const totalPnL = returns.positions.reduce((sum, p) => sum + (p.exitValue - p.entryCost), 0);
  console.log('\n' + '─'.repeat(70));
  console.log('COMPARISON');
  console.log('─'.repeat(70));
  console.log(`Total PnL from markets: $${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`CCR-v1 (maker only):    $411,803`);
  console.log(`Expected UI:            ~$400K`);

  // Show return distribution
  console.log('\n' + '─'.repeat(70));
  console.log('RETURN DISTRIBUTION');
  const rets = returns.positions.map(p => p.returnPct);
  const pctiles = [10, 25, 50, 75, 90].map(p => {
    const sorted = [...rets].sort((a, b) => a - b);
    const idx = Math.floor(p / 100 * sorted.length);
    return { p, val: sorted[idx] };
  });
  for (const { p, val } of pctiles) {
    console.log(`  p${p}: ${val?.toFixed(1) || 'N/A'}%`);
  }
}

main().catch(console.error);
