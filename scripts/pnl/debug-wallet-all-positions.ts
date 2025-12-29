/**
 * Debug ALL Positions for a Wallet
 *
 * Get every position for Smart Money 1 to understand where the discrepancy comes from.
 * The specific "biggest loser" position matches (-$5.27M), but overall wallet shows
 * -$3.5M from V13 vs +$332K from UI.
 */

import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';

// Smart Money 1 wallet
const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG ALL POSITIONS FOR SMART MONEY 1');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log('='.repeat(80));

  const engine = createV13Engine();
  const result = await engine.compute(WALLET);

  console.log('\n=== OVERALL SUMMARY ===');
  console.log(`  Total Trades:   ${result.total_trades.toLocaleString()}`);
  console.log(`  Positions:      ${result.positions_count.toLocaleString()}`);
  console.log(`  Markets:        ${result.markets_traded.toLocaleString()}`);
  console.log(`  CLOB Trades:    ${result.clob_trades.toLocaleString()}`);
  console.log(`  NegRisk Acq:    ${result.negrisk_acquisitions.toLocaleString()}`);
  console.log(`  CTF Splits:     ${result.ctf_splits.toLocaleString()}`);
  console.log(`  CTF Merges:     ${result.ctf_merges.toLocaleString()}`);
  console.log(`  Resolutions:    ${result.resolutions.toLocaleString()}`);
  console.log(`  Realized PnL:   $${result.realized_pnl.toLocaleString()}`);
  console.log(`  Total Gain:     $${result.total_gain.toLocaleString()}`);
  console.log(`  Total Loss:     $${result.total_loss.toLocaleString()}`);

  // Sort positions by PnL impact
  const sortedPositions = [...result.positions].sort((a, b) => a.realized_pnl - b.realized_pnl);

  console.log('\n=== TOP 10 LOSING POSITIONS ===');
  for (let i = 0; i < Math.min(10, sortedPositions.length); i++) {
    const p = sortedPositions[i];
    console.log(`  ${i + 1}. [${p.category}] ${p.condition_id.substring(0, 16)}... idx=${p.outcome_index}`);
    console.log(`     PnL: $${p.realized_pnl.toLocaleString()} | Resolved: ${p.is_resolved} | Payout: $${p.resolution_payout}`);
  }

  console.log('\n=== TOP 10 WINNING POSITIONS ===');
  const winPositions = [...result.positions].sort((a, b) => b.realized_pnl - a.realized_pnl);
  for (let i = 0; i < Math.min(10, winPositions.length); i++) {
    const p = winPositions[i];
    console.log(`  ${i + 1}. [${p.category}] ${p.condition_id.substring(0, 16)}... idx=${p.outcome_index}`);
    console.log(`     PnL: $${p.realized_pnl.toLocaleString()} | Resolved: ${p.is_resolved} | Payout: $${p.resolution_payout}`);
  }

  // Calculate sanity check
  const sumOfPositionPnl = result.positions.reduce((sum, p) => sum + p.realized_pnl, 0);
  console.log('\n=== SANITY CHECK ===');
  console.log(`  Sum of Position PnL:  $${sumOfPositionPnl.toLocaleString()}`);
  console.log(`  Reported Realized:    $${result.realized_pnl.toLocaleString()}`);
  console.log(`  Difference:           $${(sumOfPositionPnl - result.realized_pnl).toLocaleString()}`);

  // Look for the biggest loser condition
  const biggestLoser = result.positions.find(
    p => p.condition_id === 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917' && p.outcome_index === 1
  );
  if (biggestLoser) {
    console.log('\n=== KNOWN BIGGEST LOSER ===');
    console.log(`  Found: YES`);
    console.log(`  PnL: $${biggestLoser.realized_pnl.toLocaleString()}`);
  } else {
    console.log('\n=== KNOWN BIGGEST LOSER ===');
    console.log(`  Found: NO - might be missing from V13 results`);
  }

  // Category breakdown
  console.log('\n=== BY CATEGORY ===');
  for (const cat of result.by_category) {
    console.log(`  ${cat.category}: PnL=$${cat.realized_pnl.toLocaleString()} | Trades=${cat.trades_count} | WinRate=${(cat.win_rate * 100).toFixed(1)}%`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('Expected UI PnL: +$332,563');
  console.log(`Actual V13 PnL:  $${result.realized_pnl.toLocaleString()}`);
  console.log(`Difference:      $${(result.realized_pnl - 332563).toLocaleString()}`);
  console.log('='.repeat(80));
}

main().catch(console.error);
