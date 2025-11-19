#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

/**
 * PHASE 7: Drop Empty/Unused Databases
 * Target: Databases that are no longer needed (shadow_v1, cascadian_ops, etc.)
 * Risk: VERY LOW - these are empty or contain old experimental data
 */

const EMPTY_DATABASES = [
  'cascadian_archive',   // 0 tables
  'cascadian_ops',       // 0 tables
  'shadow_v1',           // 10 tables but null size (likely empty)
  'shadow_v1_fixed',     // 6 tables but null size
  'shadow_v1_formula',   // 8 tables but null size
  'test_settlement',     // 1 table but null size
];

async function cleanupEmptyDatabases() {
  console.log('PHASE 7: Cleanup Empty/Unused Databases\n');
  console.log('═'.repeat(80));
  console.log(`Target: ${EMPTY_DATABASES.length} empty/unused databases`);
  console.log('Risk: VERY LOW - old experimental data\n');

  console.log('Databases to be dropped:');
  console.log('  - cascadian_archive (0 tables)');
  console.log('  - cascadian_ops (0 tables)');
  console.log('  - shadow_v1 (10 empty tables - old shadow/pivot experiments)');
  console.log('  - shadow_v1_fixed (6 empty tables)');
  console.log('  - shadow_v1_formula (8 empty tables)');
  console.log('  - test_settlement (1 empty table - test data)\n');

  console.log('Databases to KEEP:');
  console.log('  ✅ default (92 tables, 46.89 GiB - main analytics)');
  console.log('  ✅ cascadian_clean (33 tables, 13.31 GiB - production data)');
  console.log('  ✅ system (461 tables - ClickHouse metadata)\n');

  let dropped = 0;
  let skipped = 0;
  let errors = 0;

  console.log('Dropping databases...\n');

  for (const database of EMPTY_DATABASES) {
    try {
      await client.exec({
        query: `DROP DATABASE IF EXISTS ${database}`,
      });

      console.log(`✓ Dropped ${database}`);
      dropped++;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unknown database')) {
        console.log(`ℹ️  ${database} already doesn't exist`);
        skipped++;
      } else {
        console.error(`✗ Error dropping ${database}:`, err);
        errors++;
      }
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('PHASE 7 COMPLETE!\n');
  console.log(`Dropped: ${dropped} databases`);
  console.log(`Skipped (doesn't exist): ${skipped} databases`);
  console.log(`Errors: ${errors}`);
  console.log('\nDatabases remaining:');
  console.log('  - default (analytics)');
  console.log('  - cascadian_clean (production)');
  console.log('  - system (ClickHouse metadata)\n');

  console.log('Next steps:');
  console.log('  1. Verify backfill completion');
  console.log('  2. Rebuild wallet PnL tables from clean data');
  console.log('  3. Final validation of all production queries\n');

  await client.close();
}

cleanupEmptyDatabases().catch(console.error);
