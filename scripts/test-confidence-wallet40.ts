/**
 * Quick test of getWalletDiagnostics on Wallet 40
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletDiagnostics } from '../lib/pnl/pnlEngineV1';

async function main() {
  const wallet = '0x90389ac0cedd49ada33432f3b7aac7a28c9fb34f';
  console.log('Testing diagnostics for Wallet 40:', wallet);
  console.log('');

  const diag = await getWalletDiagnostics(wallet);

  console.log('=== DIAGNOSTICS ===');
  console.log(`Total trades: ${diag.totalTradeCount}`);
  console.log(`Total positions: ${diag.totalPositions}`);
  console.log('');
  console.log('Token Sources:');
  console.log(`  NegRisk conversions: ${diag.negRiskConversions} (${diag.negRiskTokens} tokens)`);
  console.log(`  CTF splits/merges: ${diag.ctfSplitMergeCount} (${diag.ctfSplitTokens} split tokens)`);
  console.log('');
  console.log('Phantom Analysis:');
  console.log(`  Phantom tokens: ${diag.phantomTokens}`);
  console.log(`  Phantom %: ${diag.phantomPercent}%`);
  console.log(`  Unexplained phantom: ${diag.unexplainedPhantom}`);
  console.log('');
  console.log('Other Metrics:');
  console.log(`  Open positions: ${diag.openPositions}`);
  console.log(`  Resolved %: ${diag.resolvedPositionPct}%`);
  console.log(`  Largest position %: ${diag.largestPositionPct}%`);
  console.log('');

  // Check if would be flagged as LOW
  const isLow = diag.unexplainedPhantom > 1000;
  console.log('=== CONFIDENCE CHECK ===');
  console.log(`unexplainedPhantom (${diag.unexplainedPhantom}) > 1000 ? ${isLow ? 'YES → LOW CONFIDENCE' : 'NO'}`);

  if (isLow) {
    console.log('\n✅ Wallet 40 would now be correctly flagged as LOW confidence!');
  } else {
    console.log('\n❌ Wallet 40 would still NOT be flagged as LOW confidence');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
