/**
 * Test Polymarket Subgraph P&L Engine
 *
 * Uses the official Polymarket subgraph formula:
 * - BUY: avgPrice = (avgPrice × amount + price × buyAmount) / (amount + buyAmount)
 * - SPLIT: Treated as BUY at $0.50
 * - SELL: deltaPnL = adjustedAmount × (sellPrice - avgPrice)
 * - REDEMPTION: deltaPnL = amount × (resolutionPrice - avgPrice)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { loadPolymarketPnlEventsForWallet } from '@/lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '@/lib/pnl/polymarketSubgraphEngine';

const WALLETS = [
  { addr: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e', name: 'calibration', uiPnl: -31.05 },
  { addr: '0xbc971290ada03af329502e7be8a1bd9bfdaa0b93', name: 'bc97', uiPnl: -30.29 },
  { addr: '0x2cf91edd66c4c3c95cfde54cb866790b7fdfa1c9', name: '2cf9', uiPnl: -607.67 },
  { addr: '0xd6c4844cacbc0270291764969f72c51f3646df3a', name: 'd6c4', uiPnl: null },
  { addr: '0xd0d566309cf72737a93e4fdacdf524d992b76240', name: 'd0d5', uiPnl: null },
  { addr: '0xcb704d3b753db8724594da1d405caf8036368444', name: 'cb70', uiPnl: null },
];

async function main() {
  console.log('=== POLYMARKET SUBGRAPH ENGINE P&L ===');
  console.log('Formula: deltaPnL = adjustedAmount × (sellPrice - avgPrice)\n');

  for (const { addr, name, uiPnl } of WALLETS) {
    console.log(`\n--- ${name} ---`);
    console.log(`Wallet: ${addr}`);
    try {
      // Include synthetic redemptions for losers - positions that resolved to $0
      // Without this, losing positions don't show up in P&L!
      const loadResult = await loadPolymarketPnlEventsForWallet(addr, {
        includeTxHashSplits: false,
        includeSyntheticRedemptions: true,
        syntheticRedemptionMode: 'all',  // Synthesize for ALL resolved positions
      });
      const events = loadResult.events;
      console.log(`Loaded ${events.length} events`);

      const result = computeWalletPnlFromEvents(addr, events);
      console.log(`Our P&L: $${result.realizedPnl.toFixed(2)}`);
      if (uiPnl !== null) {
        console.log(`PM UI:   $${uiPnl.toFixed(2)}`);
        console.log(`Error:   $${Math.abs(result.realizedPnl - uiPnl).toFixed(2)}`);
      }
      console.log(`Events:`, {
        buys: result.eventCounts.ORDER_MATCHED_BUY,
        sells: result.eventCounts.ORDER_MATCHED_SELL,
        splits: result.eventCounts.SPLIT,
        redemptions: result.eventCounts.REDEMPTION,
      });
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
  }
}

main().catch(console.error);
