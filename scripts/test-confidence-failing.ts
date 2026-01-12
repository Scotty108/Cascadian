/**
 * Test getWalletPnLWithConfidence on failing wallets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletPnLWithConfidence } from '../lib/pnl/pnlEngineV1';

async function getApiPnL(wallet: string): Promise<number> {
  const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
  const data = await res.json();
  return data[data.length - 1]?.p || 0;
}

async function main() {
  // Failing wallets from validation
  const wallets = [
    { name: 'W2 (taker_heavy)', address: '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d', expectedGap: 283 },
    { name: 'Wallet 40 (ctf_users)', address: '0x90389ac0cedd49ada33432f3b7aac7a28c9fb34f', expectedGap: 3965 },
  ];

  console.log('=== Testing getWalletPnLWithConfidence on Failing Wallets ===\n');

  for (const wallet of wallets) {
    console.log(`\n--- ${wallet.name} ---`);
    console.log(`Address: ${wallet.address}`);
    console.log(`Expected gap: $${wallet.expectedGap}`);

    try {
      // Get API value
      const apiPnl = await getApiPnL(wallet.address);
      console.log(`API PnL: $${apiPnl.toFixed(2)}`);

      // Get confidence result
      const result = await getWalletPnLWithConfidence(wallet.address);
      const gap = Math.abs(apiPnl - result.total);

      console.log(`\nV1 PnL: $${result.total.toFixed(2)}`);
      console.log(`Gap: $${gap.toFixed(2)}`);
      console.log(`Engine used: ${result.engineUsed}`);
      console.log(`Confidence: ${result.confidence.toUpperCase()}`);
      console.log(`Reasons: ${result.confidenceReasons.join(', ')}`);
      console.log(`\nDiagnostics:`);
      console.log(`  - NegRisk conversions: ${result.diagnostics.negRiskConversions}`);
      console.log(`  - NegRisk tokens: ${result.diagnostics.negRiskTokens}`);
      console.log(`  - Phantom tokens: ${result.diagnostics.phantomTokens}`);
      console.log(`  - Phantom %: ${result.diagnostics.phantomPercent}%`);
      console.log(`  - CTF split tokens: ${result.diagnostics.ctfSplitTokens}`);
      console.log(`  - UNEXPLAINED phantom: ${result.diagnostics.unexplainedPhantom}`);
      console.log(`  - Self-fill txs: ${result.diagnostics.selfFillTxs}`);
      console.log(`  - Open positions: ${result.diagnostics.openPositions}`);
      console.log(`  - Total positions: ${result.diagnostics.totalPositions}`);
      console.log(`  - CTF splits/merges: ${result.diagnostics.ctfSplitMergeCount}`);
      console.log(`  - Recent trades (7d): ${result.diagnostics.recentTradeCount}`);
      console.log(`  - Largest position %: ${result.diagnostics.largestPositionPct}%`);
      console.log(`  - Resolved %: ${result.diagnostics.resolvedPositionPct}%`);
      console.log(`  - Total trades: ${result.diagnostics.totalTradeCount}`);
      console.log(`  - Avg trade USD: $${result.diagnostics.avgTradeUsd}`);

      // Validate confidence is LOW for failing wallets
      if (result.confidence === 'low') {
        console.log(`\n✅ CORRECT: Low confidence for failing wallet`);
      } else {
        console.log(`\n⚠️  WARNING: Expected LOW confidence for failing wallet, got ${result.confidence}`);
      }
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
