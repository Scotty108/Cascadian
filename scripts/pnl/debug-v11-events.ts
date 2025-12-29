/**
 * Debug V11_POLY event loading
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';

const WALLETS = [
  { address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', name: 'W2' },
  { address: '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', name: 'darkrider11' },
];

async function main() {
  console.log('\n=== Debug V11_POLY Event Loading ===\n');

  for (const wallet of WALLETS) {
    console.log(`\n--- ${wallet.name} (${wallet.address.slice(0, 10)}...) ---`);

    try {
      const result = await loadPolymarketPnlEventsForWallet(wallet.address, {
        includeSyntheticRedemptions: false, // Start without synthetics
      });

      console.log(`Events loaded: ${result.events.length}`);
      console.log(`Gap stats: ${JSON.stringify(result.gapStats)}`);

      // Count by event type - NOTE: property is 'eventType' not 'type'
      const typeCounts: Record<string, number> = {};
      for (const e of result.events) {
        typeCounts[e.eventType] = (typeCounts[e.eventType] || 0) + 1;
      }
      console.log('Event types:', typeCounts);

      // Show first few events
      console.log('\nFirst 5 events:');
      for (const e of result.events.slice(0, 5)) {
        console.log(`  ${e.eventType} | token=${e.tokenId?.toString().slice(0, 15)}... | amount=${e.amount} | price=${e.price} | ts=${e.timestamp}`);
      }

      // Check for BUY/SELL counts
      const buys = result.events.filter(e => e.eventType === 'ORDER_MATCHED_BUY').length;
      const sells = result.events.filter(e => e.eventType === 'ORDER_MATCHED_SELL').length;
      const redemptions = result.events.filter(e => e.eventType === 'REDEMPTION').length;
      console.log(`\nBUYs: ${buys}, SELLs: ${sells}, REDEMPTIONs: ${redemptions}`);

    } catch (e: any) {
      console.log(`ERROR: ${e.message}`);
      console.log(e.stack?.slice(0, 500));
    }
  }
}

main().catch(console.error);
