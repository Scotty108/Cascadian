/**
 * Debug V13 Condition Ledger vs Static Ground Truth
 *
 * Compares V13 ledger processing against static ground truth calculation
 * to find the exact divergence point.
 */

import { computeStaticPositionSummary } from '../../lib/pnl/staticPositionAnalysis';
import { debugV13ConditionLedger } from '../../lib/pnl/uiActivityEngineV13';

// Smart Money 1 wallet
const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

// The "biggest loser" position from previous analysis
const CONDITION_ID = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';
const OUTCOME_INDEX = 1; // NO side

async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG V13 CONDITION LEDGER VS STATIC GROUND TRUTH');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Condition: ${CONDITION_ID}`);
  console.log(`Outcome Index: ${OUTCOME_INDEX}`);
  console.log('='.repeat(80));

  // Get both results in parallel
  const [staticResult, v13Ledger] = await Promise.all([
    computeStaticPositionSummary(WALLET, CONDITION_ID, OUTCOME_INDEX),
    debugV13ConditionLedger(WALLET, CONDITION_ID, OUTCOME_INDEX),
  ]);

  console.log('\n=== STATIC GROUND TRUTH ===');
  console.log(`  CLOB Buys:   ${staticResult.clobBuyQty.toLocaleString()} tokens for $${staticResult.clobBuyCost.toLocaleString()}`);
  console.log(`  CLOB Sells:  ${staticResult.clobSellQty.toLocaleString()} tokens for $${staticResult.clobSellProceeds.toLocaleString()}`);
  console.log(`  NegRisk:     ${staticResult.negriskQty.toLocaleString()} tokens for $${staticResult.negriskCost.toLocaleString()}`);
  console.log(`  Total Acquired: ${staticResult.totalQtyAcquired.toLocaleString()}`);
  console.log(`  Total Cost:     $${staticResult.totalCost.toLocaleString()}`);
  console.log(`  Remaining Qty:  ${staticResult.remainingQty.toLocaleString()}`);
  console.log(`  Payout/Token:   $${staticResult.payoutPerToken}`);
  console.log(`  FINAL PNL:      $${staticResult.impliedPnlWithResolution.toLocaleString()}`);

  console.log('\n=== V13 LEDGER DEBUG ===');
  console.log(`  Total Events:   ${v13Ledger.events.length}`);
  console.log(`  Final Position: ${v13Ledger.final_position.toLocaleString()}`);
  console.log(`  Resolution:     $${v13Ledger.resolution_payout}`);
  console.log(`  FINAL PNL:      $${v13Ledger.final_realized_pnl.toLocaleString()}`);

  // Count by source
  const bySrc: Record<string, { buys: number; sells: number; buyQty: number; sellQty: number }> = {};
  for (const evt of v13Ledger.events) {
    if (!bySrc[evt.source]) {
      bySrc[evt.source] = { buys: 0, sells: 0, buyQty: 0, sellQty: 0 };
    }
    if (evt.side === 'buy') {
      bySrc[evt.source].buys++;
      bySrc[evt.source].buyQty += evt.qty;
    } else {
      bySrc[evt.source].sells++;
      bySrc[evt.source].sellQty += evt.qty;
    }
  }

  console.log('\n=== V13 BREAKDOWN BY SOURCE ===');
  for (const [src, data] of Object.entries(bySrc)) {
    console.log(`  ${src}: ${data.buys} buys (${data.buyQty.toLocaleString()} qty), ${data.sells} sells (${data.sellQty.toLocaleString()} qty)`);
  }

  console.log('\n=== COMPARISON ===');
  const pnlDiff = Math.abs(v13Ledger.final_realized_pnl - staticResult.impliedPnlWithResolution);
  const match = pnlDiff < 1; // Within $1

  console.log(`  Static PnL:    $${staticResult.impliedPnlWithResolution.toLocaleString()}`);
  console.log(`  V13 PnL:       $${v13Ledger.final_realized_pnl.toLocaleString()}`);
  console.log(`  Difference:    $${pnlDiff.toLocaleString()}`);
  console.log(`  MATCH:         ${match ? 'YES' : 'NO'}`);

  if (!match) {
    console.log('\n=== DIVERGENCE ANALYSIS ===');

    // Compare totals
    const v13TotalBuyQty = v13Ledger.events.filter(e => e.side === 'buy').reduce((s, e) => s + e.qty, 0);
    const v13TotalSellQty = v13Ledger.events.filter(e => e.side === 'sell').reduce((s, e) => s + e.qty, 0);

    console.log(`  Static Total Acquired: ${staticResult.totalQtyAcquired.toLocaleString()}`);
    console.log(`  V13 Total Buy Qty:     ${v13TotalBuyQty.toLocaleString()}`);
    console.log(`  Diff:                  ${(staticResult.totalQtyAcquired - v13TotalBuyQty).toLocaleString()}`);

    console.log(`  Static Total Sold:     ${staticResult.totalQtySold.toLocaleString()}`);
    console.log(`  V13 Total Sell Qty:    ${v13TotalSellQty.toLocaleString()}`);
    console.log(`  Diff:                  ${(staticResult.totalQtySold - v13TotalSellQty).toLocaleString()}`);

    // Show first/last few events
    console.log('\n=== FIRST 5 V13 EVENTS ===');
    for (let i = 0; i < Math.min(5, v13Ledger.events.length); i++) {
      const e = v13Ledger.events[i];
      console.log(`  ${i + 1}. [${e.source}] ${e.side} ${e.qty.toLocaleString()} @ $${e.price.toFixed(4)} | pos=${e.position_qty_after.toLocaleString()} | pnl=$${e.realized_pnl_after.toLocaleString()}`);
    }

    console.log('\n=== LAST 5 V13 EVENTS ===');
    const start = Math.max(0, v13Ledger.events.length - 5);
    for (let i = start; i < v13Ledger.events.length; i++) {
      const e = v13Ledger.events[i];
      console.log(`  ${i + 1}. [${e.source}] ${e.side} ${e.qty.toLocaleString()} @ $${e.price.toFixed(4)} | pos=${e.position_qty_after.toLocaleString()} | pnl=$${e.realized_pnl_after.toLocaleString()}`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
