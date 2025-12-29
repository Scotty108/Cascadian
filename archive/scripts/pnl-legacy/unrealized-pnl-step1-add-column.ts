#!/usr/bin/env npx tsx

/**
 * UNREALIZED P&L SYSTEM - STEP 1: Add Column
 *
 * Adds unrealized_pnl_usd column to trades_raw table.
 * Uses Nullable(Float64) to handle missing price data gracefully.
 *
 * Runtime: ~1-2 minutes (schema change only, no data migration)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

(async () => {
  const client = getClickHouseClient();

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('UNREALIZED P&L SYSTEM - STEP 1: ADD COLUMN TO TRADES_RAW');
  console.log('════════════════════════════════════════════════════════════════════\n');

  try {
    // Check if column already exists
    console.log('1. Checking if unrealized_pnl_usd column already exists...');
    const schema = await client.query({
      query: 'DESCRIBE TABLE trades_raw',
      format: 'JSONEachRow'
    });
    const schemaData: any = await schema.json();
    const hasColumn = schemaData.some((col: any) => col.name === 'unrealized_pnl_usd');

    if (hasColumn) {
      console.log('   ✅ Column already exists. No action needed.\n');
      await client.close();
      process.exit(0);
    }

    console.log('   Column does not exist. Adding now...\n');

    // Add column
    console.log('2. Adding unrealized_pnl_usd column...');
    await client.exec({
      query: `
        ALTER TABLE trades_raw
        ADD COLUMN IF NOT EXISTS unrealized_pnl_usd Nullable(Float64)
      `
    });
    console.log('   ✅ Column added successfully\n');

    // Verify
    console.log('3. Verifying column was added...');
    const verifySchema = await client.query({
      query: 'DESCRIBE TABLE trades_raw',
      format: 'JSONEachRow'
    });
    const verifyData: any = await verifySchema.json();
    const verified = verifyData.some((col: any) => col.name === 'unrealized_pnl_usd');

    if (verified) {
      console.log('   ✅ Verification successful. Column is present.\n');
    } else {
      console.log('   ❌ Verification failed. Column not found.\n');
      process.exit(1);
    }

    console.log('════════════════════════════════════════════════════════════════════');
    console.log('✅ STEP 1 COMPLETE');
    console.log('════════════════════════════════════════════════════════════════════\n');
    console.log('Next step: Run unrealized-pnl-step2-calculate.ts to populate the column\n');

    await client.close();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    await client.close();
    process.exit(1);
  }
})();
