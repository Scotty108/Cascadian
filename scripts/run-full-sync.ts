/**
 * Run Full Sync - Sync all Polymarket data to database
 *
 * This script runs the full sync operation to populate the database
 * with all ~19,894 markets from Polymarket.
 */

import { syncPolymarketData } from '@/lib/polymarket/sync';

async function main() {
  console.log('🚀 Starting full Polymarket sync...\n');

  try {
    const result = await syncPolymarketData();

    console.log('\n📊 Sync Results:');
    console.log(`  Success: ${result.success ? '✅' : '❌'}`);
    console.log(`  Markets synced: ${result.markets_synced}`);
    console.log(`  Duration: ${(result.duration_ms / 1000).toFixed(1)}s`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.forEach(err => {
        console.log(`  - ${err.error}`);
      });
    }

    if (result.success) {
      console.log('\n✅ Sync completed successfully!');
      console.log(`\n🎉 Your database now has ${result.markets_synced} markets!`);
    } else {
      console.log('\n❌ Sync failed or completed with errors');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Sync failed:', error);
    process.exit(1);
  }
}

main();
