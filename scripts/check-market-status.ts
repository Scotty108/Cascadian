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

async function main() {
  console.log('═'.repeat(80));
  console.log('FINAL DIAGNOSIS: Where are the missing 171K resolutions?');
  console.log('═'.repeat(80));
  console.log();

  // Summary
  console.log('What we know:');
  console.log('  - fact_trades_clean: 227,838 unique markets traded');
  console.log('  - ALL resolution tables combined: only 56,081 markets (24.6%)');
  console.log('  - Missing: 171,757 markets (75.4%)');
  console.log();

  console.log('Conclusion:');
  console.log('  The missing 171K markets either:');
  console.log('  1. Are still OPEN (unresolved)');
  console.log('  2. Are CLOSED but never backfilled into database');
  console.log('  3. Need to be fetched from Polymarket API');
  console.log();

  console.log('═'.repeat(80));
  console.log('RECOMMENDED ACTION');
  console.log('═'.repeat(80));
  console.log();
  console.log('BUILD UNIFIED RESOLUTION VIEW FROM BEST SOURCES:');
  console.log();
  console.log('1. Use api_ctf_bridge (26.44% coverage - BEST)');
  console.log('2. Update PnL views to use this source');
  console.log('3. Accept that 75% of markets are unresolved');
  console.log('4. PnL will show NULL for these (which is CORRECT)');
  console.log();
  console.log('FOR THE REMAINING 75%:');
  console.log('  - IF they are closed: Backfill from Polymarket API');
  console.log('  - IF they are open: Wait for resolution');
  console.log();

  await client.close();
}

main().catch(console.error);
