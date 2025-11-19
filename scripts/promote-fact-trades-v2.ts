#!/usr/bin/env npx tsx
/**
 * PROMOTE FACT_TRADES_V2 TO PRODUCTION
 *
 * Backup current fact_trades_clean and promote fact_trades_v2
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('═'.repeat(80));
console.log('PROMOTE FACT_TRADES_V2 TO PRODUCTION');
console.log('═'.repeat(80));
console.log();

// Step 1: Backup current fact_trades_clean
console.log('Step 1: Backup fact_trades_clean → fact_trades_backup');
console.log('─'.repeat(80));

try {
  // Drop backup if exists
  await client.query({ query: 'DROP TABLE IF EXISTS cascadian_clean.fact_trades_backup' });
  console.log('  Dropped old backup (if existed)');

  // Rename current to backup
  await client.query({
    query: 'RENAME TABLE cascadian_clean.fact_trades_clean TO cascadian_clean.fact_trades_backup'
  });
  console.log('✅ Backed up: fact_trades_clean → fact_trades_backup');

} catch (error: any) {
  console.error(`❌ Backup failed: ${error?.message || error}`);
  console.log('ABORTING - Production table unchanged');
  await client.close();
  process.exit(1);
}

console.log();

// Step 2: Promote v2 to production
console.log('Step 2: Promote fact_trades_v2 → fact_trades_clean');
console.log('─'.repeat(80));

try {
  await client.query({
    query: 'RENAME TABLE cascadian_clean.fact_trades_v2 TO cascadian_clean.fact_trades_clean'
  });
  console.log('✅ Promoted: fact_trades_v2 → fact_trades_clean');

} catch (error: any) {
  console.error(`❌ Promotion failed: ${error?.message || error}`);
  console.log('CRITICAL ERROR - Attempting rollback...');

  try {
    await client.query({
      query: 'RENAME TABLE cascadian_clean.fact_trades_backup TO cascadian_clean.fact_trades_clean'
    });
    console.log('✅ Rolled back to backup');
  } catch (rollbackError) {
    console.error('❌❌ ROLLBACK FAILED - MANUAL INTERVENTION REQUIRED');
  }

  await client.close();
  process.exit(1);
}

console.log();
console.log('═'.repeat(80));
console.log('VERIFY PROMOTION');
console.log('═'.repeat(80));
console.log();

// Step 3: Verify new production table
try {
  const verification = await client.query({
    query: `
      SELECT
        count() AS rows,
        uniqExact(cid_hex) AS markets,
        uniqExact(tx_hash) AS txs,
        uniqExact(wallet_address) AS wallets
      FROM cascadian_clean.fact_trades_clean
    `,
    format: 'JSONEachRow',
  });

  const data = await verification.json<Array<{
    rows: number;
    markets: number;
    txs: number;
    wallets: number;
  }>>();

  const d = data[0];

  console.log('Production Table (fact_trades_clean):');
  console.log();
  console.log(`  Total rows:               ${d.rows.toLocaleString()}`);
  console.log(`  Unique condition IDs:     ${d.markets.toLocaleString()}`);
  console.log(`  Unique tx_hashes:         ${d.txs.toLocaleString()}`);
  console.log(`  Unique wallets:           ${d.wallets.toLocaleString()}`);
  console.log();

  if (d.markets === 227838 && d.rows > 63000000) {
    console.log('✅ VERIFICATION PASSED');
    console.log('   Production table has expected row count and CID coverage');
  } else {
    console.log('⚠️  WARNING: Numbers differ from expected');
    console.log(`   Expected: 227,838 CIDs, ~63.5M rows`);
    console.log(`   Got:      ${d.markets.toLocaleString()} CIDs, ${d.rows.toLocaleString()} rows`);
  }

} catch (error: any) {
  console.error(`❌ Verification failed: ${error?.message || error}`);
}

console.log();
console.log('═'.repeat(80));
console.log('PROMOTION COMPLETE');
console.log('═'.repeat(80));
console.log();
console.log('Next steps:');
console.log('  1. Build resolved-market PnL views on fact_trades_clean');
console.log('  2. Patch missing directions from trades_with_direction');
console.log('  3. Run final gates validation');
console.log('  4. Deploy API endpoints');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
