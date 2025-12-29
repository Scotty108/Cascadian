/**
 * Test V11_POLY engine (the canonical Polymarket subgraph port)
 * This uses FIFO tracking instead of simple aggregation
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';

const WALLET = process.argv[2] || '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a'; // darkrider11

async function main() {
  console.log(`\n=== V11_POLY Engine Test for ${WALLET} ===\n`);

  try {
    // Load events with synthetic redemptions (loser-only)
    console.log('Loading events...');
    const loadResult = await loadPolymarketPnlEventsForWallet(WALLET, {
      includeSyntheticRedemptions: true,
    });
    const events = loadResult.events;
    console.log(`Loaded ${events.length} events`);
    console.log(`Gap stats: ${JSON.stringify(loadResult.gapStats)}`);

    // Compute PnL using Polymarket subgraph algorithm
    console.log('\nComputing PnL...');
    const result = computeWalletPnlFromEvents(WALLET, events);

    console.log('\n=== V11_POLY Results ===');
    console.log(`Realized PnL:       $${result.realizedPnl.toLocaleString()}`);
    console.log(`Volume:             $${result.volume.toLocaleString()}`);
    console.log(`Unique Positions:   ${result.positionCount}`);
    console.log(`Event Counts:       ${JSON.stringify(result.eventCounts)}`);

    // Show some position details
    console.log('\n=== Sample Positions ===');
    let count = 0;
    for (const [posId, pos] of result.positions) {
      if (count >= 5) break;
      console.log(`${posId.slice(0, 30)}...`);
      console.log(`  Amount: ${(Number(pos.amount) / 1_000_000).toFixed(2)}`);
      console.log(`  AvgPrice: ${(Number(pos.avgPrice) / 1_000_000).toFixed(4)}`);
      console.log(`  RealizedPnL: $${(Number(pos.realizedPnl) / 1_000_000).toLocaleString()}`);
      count++;
    }

  } catch (e) {
    console.error('ERROR:', e);
  }

  console.log('\n=== Expected UI Value: +$604,472 ===\n');
}

main().catch(console.error);
