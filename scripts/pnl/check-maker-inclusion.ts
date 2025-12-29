#!/usr/bin/env npx tsx
/**
 * Check whether Polymarket UI "Volume traded" includes maker fills
 *
 * Compare UI volume against:
 * 1. Taker-only: sum(abs(usdc)) WHERE event_id LIKE '%-t'
 * 2. All fills: sum(abs(usdc)) for all events
 *
 * Whichever matches UI tells us whether to include maker fills.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

// Wallets with known UI "Volume traded" values
const testWallets = [
  {
    wallet: '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191',
    username: 'Patapam222',
    ui_volume: 6158.03
  },
  {
    wallet: '0x46e669b5f53bfa7d8ff438a228dd06159ec0a3a1',
    username: 'mnfgia',
    ui_volume: 7916.07
  },
  {
    wallet: '0x88cee1fe5e14407927029b6cff5ad0fc4613d70e',
    username: null,
    ui_volume: 2553.38
  },
];

async function checkMakerInclusion() {
  console.log('='.repeat(100));
  console.log('CHECKING WHETHER UI INCLUDES MAKER FILLS');
  console.log('='.repeat(100));
  console.log();

  for (const test of testWallets) {
    console.log(`\n--- ${test.username || test.wallet} ---`);
    console.log(`UI Volume traded: $${test.ui_volume.toFixed(2)}`);

    // Query 1: Taker-only volume (event_id ends with '-t')
    const takerQ = await clickhouse.query({
      query: `
        SELECT
          sum(abs(usdc_amount)) / 1000000.0 as volume
        FROM (
          SELECT event_id, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String}
            AND is_deleted = 0
            AND event_id LIKE '%-t'
          GROUP BY event_id
        )
      `,
      query_params: { wallet: test.wallet },
      format: 'JSONEachRow'
    });
    const takerRows = await takerQ.json() as any[];
    const takerVolume = takerRows[0]?.volume || 0;

    // Query 2: All fills volume (both taker and maker)
    const allQ = await clickhouse.query({
      query: `
        SELECT
          sum(abs(usdc_amount)) / 1000000.0 as volume
        FROM (
          SELECT event_id, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String}
            AND is_deleted = 0
          GROUP BY event_id
        )
      `,
      query_params: { wallet: test.wallet },
      format: 'JSONEachRow'
    });
    const allRows = await allQ.json() as any[];
    const allVolume = allRows[0]?.volume || 0;

    // Query 3: Maker-only volume (event_id ends with '-m')
    const makerQ = await clickhouse.query({
      query: `
        SELECT
          sum(abs(usdc_amount)) / 1000000.0 as volume,
          count() as count
        FROM (
          SELECT event_id, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String}
            AND is_deleted = 0
            AND event_id LIKE '%-m'
          GROUP BY event_id
        )
      `,
      query_params: { wallet: test.wallet },
      format: 'JSONEachRow'
    });
    const makerRows = await makerQ.json() as any[];
    const makerVolume = makerRows[0]?.volume || 0;
    const makerCount = makerRows[0]?.count || 0;

    // Calculate ratios
    const takerRatio = takerVolume / test.ui_volume;
    const allRatio = allVolume / test.ui_volume;

    console.log(`\nDatabase volumes:`);
    console.log(`  Taker-only (-t): $${takerVolume.toFixed(2)} (ratio to UI: ${takerRatio.toFixed(3)}x)`);
    console.log(`  Maker-only (-m): $${makerVolume.toFixed(2)} (${makerCount} events)`);
    console.log(`  All fills:       $${allVolume.toFixed(2)} (ratio to UI: ${allRatio.toFixed(3)}x)`);

    // Determine which matches
    const takerDelta = Math.abs(takerVolume - test.ui_volume);
    const allDelta = Math.abs(allVolume - test.ui_volume);

    if (takerDelta < allDelta && takerRatio > 0.9 && takerRatio < 1.1) {
      console.log(`\n  ✓ TAKER-ONLY matches UI (delta: $${takerDelta.toFixed(2)})`);
    } else if (allDelta < takerDelta && allRatio > 0.9 && allRatio < 1.1) {
      console.log(`\n  ✓ ALL FILLS matches UI (delta: $${allDelta.toFixed(2)})`);
    } else {
      console.log(`\n  ✗ NEITHER matches well - UI may include other sources`);
      console.log(`    Taker delta: $${takerDelta.toFixed(2)}, All delta: $${allDelta.toFixed(2)}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('CONCLUSION');
  console.log('='.repeat(100));
  console.log('\nCompare the ratios above to determine if UI uses taker-only or all fills.');
  console.log('If taker-only ratios are ~1.0, use event_id LIKE \'%-t\'');
  console.log('If all-fills ratios are ~1.0, include both maker and taker events');
  console.log();

  await clickhouse.close();
}

checkMakerInclusion().catch(console.error);
