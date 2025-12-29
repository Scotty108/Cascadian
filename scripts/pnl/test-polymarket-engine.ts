/**
 * Test the Polymarket-accurate engine against golden wallets
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { computePnL, listEngines, getEngineDescription } from '../../lib/pnl/engineRouter';

// UI PnL values extracted via Playwright from polymarket.com/profile/{address} (ALL tab)
// Last updated: 2025-12-17 via Playwright MCP
const GOLDEN_WALLETS = [
  // Original test wallets
  { address: '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd', name: '@cozyfnf', uiPnl: 1409524.60 },
  { address: '0x8fe70c889ce14f67acea5d597e3d0351d73b4f20', name: '@amused85', uiPnl: -3405.14 },
  { address: '0x42592084120b0d5287059919d2a96b3b7acb936f', name: '@antman', uiPnl: 416895.80 },
  // Leaderboard wallets (extracted 2025-12-17)
  { address: '0xb744f56635b537e859152d14b022af5afe485210', name: 'wasianiversonworldchamp2025', uiPnl: 2860257 },
  { address: '0x16b29c50f2439faf627209b2ac0c7bbddaa8a881', name: 'SeriouslySirius', uiPnl: 2182840 },
  { address: '0xee50a31c3f5a7c77824b12a941a54388a2827ed6', name: '0xafEe', uiPnl: 1254597 },
  { address: '0x14964aefa2cd7caff7878b3820a690a03c5aa429', name: 'gmpm', uiPnl: 1217031 },
];

async function main() {
  console.log('=== POLYMARKET-ACCURATE ENGINE TEST ===\n');

  console.log('Available engines:');
  for (const engine of listEngines()) {
    console.log(`  ${engine}: ${getEngineDescription(engine)}`);
  }
  console.log('');

  for (const wallet of GOLDEN_WALLETS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Wallet: ${wallet.name}`);
    console.log(`Address: ${wallet.address}`);
    console.log(`UI PnL (WebFetch): $${wallet.uiPnl.toLocaleString()}`);
    console.log('');

    try {
      const result = await computePnL(wallet.address, 'polymarket_avgcost_v1');

      console.log(`Engine: ${result.engineVersion}`);
      console.log(`Realized PnL: $${result.realizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`Unrealized PnL: $${result.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`Total PnL: $${result.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

      if (result.metadata) {
        console.log(`\nMetadata:`);
        console.log(`  Trades: ${result.metadata.tradeCount}`);
        console.log(`  Splits: ${result.metadata.splitCount}`);
        console.log(`  Merges: ${result.metadata.mergeCount}`);
        console.log(`  Redemptions: ${result.metadata.redemptionCount}`);
        console.log(`  Positions: ${result.metadata.positionCount}`);
        console.log(`  Skipped Sells: ${result.metadata.skippedSells}`);
        console.log(`  Clamped Tokens: ${(result.metadata.clampedTokens as number)?.toLocaleString() || 0}`);
        console.log(`  Auto-Settled PnL: $${(result.metadata.autoSettledPnl as number)?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || 0}`);

        // Transfer exposure (data quality indicator)
        const transfer = result.metadata.transferExposure as { inTokens: number; outTokens: number; exposureRatio: number } | undefined;
        if (transfer) {
          console.log(`\nTransfer Exposure:`);
          console.log(`  Tokens IN: ${Math.round(transfer.inTokens).toLocaleString()}`);
          console.log(`  Tokens OUT: ${Math.round(transfer.outTokens).toLocaleString()}`);
          console.log(`  Exposure Ratio: ${(transfer.exposureRatio * 100).toFixed(1)}%`);
        }

        // Confidence score
        const confidence = result.metadata.confidence as { level: string; score: number; reasons: string[] } | undefined;
        if (confidence) {
          console.log(`\nData Confidence: ${confidence.level} (${confidence.score}/100)`);
          confidence.reasons.forEach(r => console.log(`  • ${r}`));
        }
      }

      const delta = wallet.uiPnl !== 0
        ? ((result.totalPnl - wallet.uiPnl) / Math.abs(wallet.uiPnl)) * 100
        : 0;
      console.log(`\nDelta vs UI: ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`);

      if (Math.abs(delta) <= 10) {
        console.log('Status: ✅ PASS (within ±10%)');
      } else if (Math.abs(delta) <= 25) {
        console.log('Status: ⚠️ MARGINAL (within ±25%)');
      } else {
        console.log('Status: ❌ FAIL');
      }
    } catch (error) {
      console.error(`Error: ${error}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Test complete.');
}

main().catch(console.error);
