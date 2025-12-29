/**
 * Forensic Analysis - Smart Money 1
 *
 * Deep dive into top 3 winning and top 3 losing positions
 * to understand the PnL discrepancy.
 *
 * V13 shows: -$282,753
 * UI shows:  +$332,563
 * Gap:       ~$615K
 */

import { debugV13ConditionLedger } from '../../lib/pnl/uiActivityEngineV13';

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

// Top 3 losers from debug-wallet-all-positions.ts (full condition IDs)
const TOP_LOSERS = [
  { condition_id: 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917', outcome_index: 1, pnl: -3875754 },
  { condition_id: 'cd1b6b71a1964f15e2c14809594cbfa0d576270e8ef94c8c24913121097e09e5', outcome_index: 1, pnl: -484260 },
  { condition_id: '57f90c89879a5b5e69fad9c2a261fa6f44f3653001aa3a02446aed92aaff21bf', outcome_index: 1, pnl: -122937 },
];

// Top 3 winners from debug-wallet-all-positions.ts (full condition IDs)
const TOP_WINNERS = [
  { condition_id: 'c6485bb7ea46d7bb89beb9c91e7572ecfc72a6273789496f78bc5e989e4d1638', outcome_index: 1, pnl: 3404903 },
  { condition_id: '265366ede72d73e137b2b9095a6cdc9be6149290caa295738a95e3d881ad0865', outcome_index: 1, pnl: 520724 },
  { condition_id: 'e64f063b9e2b02f8ac679ebacfb938088c1ddde2a953a1ebfd4a92b802910371', outcome_index: 1, pnl: 114938 },
];

async function main() {
  console.log('='.repeat(80));
  console.log('FORENSIC ANALYSIS - SMART MONEY 1');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log('V13 PnL: -$282,753 | UI PnL: +$332,563 | Gap: ~$615K');
  console.log('='.repeat(80));

  // Analyze top losers
  console.log('\n\n' + '='.repeat(80));
  console.log('TOP 3 LOSING POSITIONS - DETAILED LEDGER');
  console.log('='.repeat(80));

  for (const pos of TOP_LOSERS) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`POSITION: ${pos.condition_id.substring(0, 24)}... idx=${pos.outcome_index}`);
    console.log(`V13 PnL: $${pos.pnl.toLocaleString()}`);
    console.log('─'.repeat(70));

    try {
      const ledger = await debugV13ConditionLedger(WALLET, pos.condition_id, pos.outcome_index);

      console.log(`\n  Events: ${ledger.events.length}`);
      console.log(`  Final Position: ${ledger.final_position.toFixed(4)} shares`);
      console.log(`  Realized PnL: $${ledger.final_realized_pnl.toFixed(2)}`);
      console.log(`  Resolution Payout: ${ledger.resolution_payout !== null ? '$' + ledger.resolution_payout : 'N/A'}`);

      // Show first 5 and last 5 events
      console.log('\n  FIRST 5 EVENTS:');
      for (const e of ledger.events.slice(0, 5)) {
        console.log(`    ${e.time} | ${e.source.padEnd(12)} | ${e.side.padEnd(4)} | qty=${e.qty.toFixed(2)} @ $${e.price.toFixed(4)} | pos=${e.position_qty_after.toFixed(2)} | pnl=${e.realized_pnl_after.toFixed(2)}`);
      }
      if (ledger.events.length > 10) {
        console.log(`    ... (${ledger.events.length - 10} more events) ...`);
      }
      console.log('\n  LAST 5 EVENTS:');
      for (const e of ledger.events.slice(-5)) {
        console.log(`    ${e.time} | ${e.source.padEnd(12)} | ${e.side.padEnd(4)} | qty=${e.qty.toFixed(2)} @ $${e.price.toFixed(4)} | pos=${e.position_qty_after.toFixed(2)} | pnl=${e.realized_pnl_after.toFixed(2)}`);
      }
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  // Analyze top winners
  console.log('\n\n' + '='.repeat(80));
  console.log('TOP 3 WINNING POSITIONS - DETAILED LEDGER');
  console.log('='.repeat(80));

  for (const pos of TOP_WINNERS) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`POSITION: ${pos.condition_id.substring(0, 24)}... idx=${pos.outcome_index}`);
    console.log(`V13 PnL: $${pos.pnl.toLocaleString()}`);
    console.log('─'.repeat(70));

    try {
      const ledger = await debugV13ConditionLedger(WALLET, pos.condition_id, pos.outcome_index);

      console.log(`\n  Events: ${ledger.events.length}`);
      console.log(`  Final Position: ${ledger.final_position.toFixed(4)} shares`);
      console.log(`  Realized PnL: $${ledger.final_realized_pnl.toFixed(2)}`);
      console.log(`  Resolution Payout: ${ledger.resolution_payout !== null ? '$' + ledger.resolution_payout : 'N/A'}`);

      // Show first 5 and last 5 events
      console.log('\n  FIRST 5 EVENTS:');
      for (const e of ledger.events.slice(0, 5)) {
        console.log(`    ${e.time} | ${e.source.padEnd(12)} | ${e.side.padEnd(4)} | qty=${e.qty.toFixed(2)} @ $${e.price.toFixed(4)} | pos=${e.position_qty_after.toFixed(2)} | pnl=${e.realized_pnl_after.toFixed(2)}`);
      }
      if (ledger.events.length > 10) {
        console.log(`    ... (${ledger.events.length - 10} more events) ...`);
      }
      console.log('\n  LAST 5 EVENTS:');
      for (const e of ledger.events.slice(-5)) {
        console.log(`    ${e.time} | ${e.source.padEnd(12)} | ${e.side.padEnd(4)} | qty=${e.qty.toFixed(2)} @ $${e.price.toFixed(4)} | pos=${e.position_qty_after.toFixed(2)} | pnl=${e.realized_pnl_after.toFixed(2)}`);
      }
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
