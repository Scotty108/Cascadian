/**
 * Run Static Position Analysis
 *
 * Computes ground truth PnL for Smart Money 1's biggest losing position.
 */

import { computeStaticPositionSummary } from '../../lib/pnl/staticPositionAnalysis';

// Smart Money 1 wallet
const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

// The "biggest loser" position from previous analysis
const CONDITION_ID = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';
const OUTCOME_INDEX = 1; // NO side

async function main() {
  console.log('='.repeat(80));
  console.log('STATIC POSITION ANALYSIS - GROUND TRUTH');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Condition: ${CONDITION_ID}`);
  console.log(`Outcome Index: ${OUTCOME_INDEX}`);
  console.log('='.repeat(80));

  const summary = await computeStaticPositionSummary(WALLET, CONDITION_ID, OUTCOME_INDEX);

  console.log('\n=== CLOB BREAKDOWN ===');
  console.log(`  Buys:  ${summary.clobBuyQty.toLocaleString()} tokens for $${summary.clobBuyCost.toLocaleString()}`);
  console.log(`  Sells: ${summary.clobSellQty.toLocaleString()} tokens for $${summary.clobSellProceeds.toLocaleString()}`);

  console.log('\n=== NEGRISK BREAKDOWN ===');
  console.log(`  Acquisitions: ${summary.negriskQty.toLocaleString()} tokens for $${summary.negriskCost.toLocaleString()}`);

  console.log('\n=== TOTALS ===');
  console.log(`  Total Acquired: ${summary.totalQtyAcquired.toLocaleString()} tokens`);
  console.log(`  Total Cost:     $${summary.totalCost.toLocaleString()}`);
  console.log(`  Avg Cost Basis: $${(summary.totalCost / summary.totalQtyAcquired).toFixed(6)}`);

  console.log('\n=== POSITION AT RESOLUTION ===');
  console.log(`  Total Sold:    ${summary.totalQtySold.toLocaleString()} tokens`);
  console.log(`  Total Proceeds: $${summary.totalProceeds.toLocaleString()}`);
  console.log(`  Remaining Qty: ${summary.remainingQty.toLocaleString()} tokens`);
  console.log(`  Payout/Token:  $${summary.payoutPerToken}`);

  console.log('\n=== IMPLIED PNL ===');
  const fromSells = summary.totalProceeds - (summary.totalQtySold * (summary.totalCost / summary.totalQtyAcquired));
  const fromResolution = summary.remainingQty * summary.payoutPerToken - (summary.remainingQty * (summary.totalCost / summary.totalQtyAcquired));

  console.log(`  PnL from Sells:      $${fromSells.toLocaleString()}`);
  console.log(`  PnL from Resolution: $${fromResolution.toLocaleString()}`);
  console.log(`  TOTAL IMPLIED PNL:   $${summary.impliedPnlWithResolution.toLocaleString()}`);

  console.log('\n='.repeat(80));
  console.log('GROUND TRUTH SUMMARY');
  console.log('='.repeat(80));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(console.error);
