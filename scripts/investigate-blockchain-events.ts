#!/usr/bin/env npx tsx
/**
 * Investigate Blockchain Event Tables
 *
 * Check if we already have any on-chain resolution events stored
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n🔍 INVESTIGATING BLOCKCHAIN EVENT DATA\n');
  console.log('═'.repeat(80));

  // Step 1: Find relevant tables
  console.log('\n1️⃣ Searching for relevant tables...\n');

  const tablesResult = await ch.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE database IN ('default', 'cascadian', 'polymarket')
        AND (
          name LIKE '%event%'
          OR name LIKE '%resolution%'
          OR name LIKE '%ctf%'
          OR name LIKE '%condition%'
          OR name LIKE '%payout%'
          OR name LIKE '%blockchain%'
          OR name LIKE '%erc1155%'
        )
      ORDER BY total_rows DESC
    `
  });

  const tables = await tablesResult.json();

  if (tables.data.length === 0) {
    console.log('  ❌ No relevant tables found');
  } else {
    console.log(`  ✅ Found ${tables.data.length} relevant tables:\n`);

    for (const table of tables.data) {
      console.log(`  📋 ${table.database}.${table.name}`);
      console.log(`     Engine: ${table.engine}`);
      console.log(`     Rows: ${Number(table.total_rows).toLocaleString()}`);
      console.log(`     Size: ${(Number(table.total_bytes) / 1024 / 1024).toFixed(2)} MB\n`);
    }
  }

  // Step 2: Check for any resolution-like data
  console.log('\n2️⃣ Checking market_resolutions_final table...\n');

  try {
    const resCount = await ch.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNT(DISTINCT condition_id_norm) as unique_conditions,
          COUNT(CASE WHEN payout_numerators IS NOT NULL AND length(payout_numerators) > 0 THEN 1 END) as with_payouts,
          source,
          COUNT(*) as count
        FROM default.market_resolutions_final
        GROUP BY source
      `
    });

    const data = await resCount.json();
    console.log('  Current resolution data:');

    for (const row of data.data) {
      console.log(`    Source: ${row.source} - ${Number(row.count).toLocaleString()} resolutions`);
    }
  } catch (error: any) {
    console.log(`  ⚠️  Error querying resolutions: ${error.message}`);
  }

  // Step 3: Look for any CTF-related tables
  console.log('\n3️⃣ Searching for CTF (Conditional Token Framework) data...\n');

  const ctfResult = await ch.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database IN ('default', 'cascadian', 'polymarket')
        AND name LIKE '%ctf%'
    `
  });

  const ctfTables = await ctfResult.json();

  if (ctfTables.data.length === 0) {
    console.log('  ❌ No CTF tables found');
    console.log('  → Need to fetch on-chain ConditionResolution events');
  } else {
    console.log(`  ✅ Found ${ctfTables.data.length} CTF tables`);
    for (const table of ctfTables.data) {
      console.log(`    ${table.name}: ${Number(table.total_rows).toLocaleString()} rows`);
    }
  }

  // Step 4: Check ERC1155 tables for potential resolution data
  console.log('\n4️⃣ Checking ERC1155 tables...\n');

  const erc1155Result = await ch.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database IN ('default', 'cascadian', 'polymarket')
        AND (name LIKE '%erc1155%' OR name LIKE '%1155%')
    `
  });

  const erc1155Tables = await erc1155Result.json();

  if (erc1155Tables.data.length > 0) {
    console.log(`  ✅ Found ${erc1155Tables.data.length} ERC1155 tables:\n`);
    for (const table of erc1155Tables.data) {
      console.log(`    ${table.name}: ${Number(table.total_rows).toLocaleString()} rows`);
    }
  } else {
    console.log('  ❌ No ERC1155 tables found');
  }

  console.log('\n═'.repeat(80));
  console.log('\n📊 SUMMARY\n');

  console.log('Available Data Sources:');
  console.log('  1. Polymarket API: ❌ Returns 0 markets with payouts');
  console.log('  2. Database tables: ' + (tables.data.length > 0 ? '✅ Some data exists' : '❌ No relevant tables'));
  console.log('  3. On-chain CTF events: ' + (ctfTables.data.length > 0 ? '✅ May have data' : '⚠️  Need to fetch'));

  console.log('\n🎯 RECOMMENDED NEXT STEPS:\n');

  if (ctfTables.data.length === 0) {
    console.log('1. Fetch ConditionResolution events from CTF contract on-chain');
    console.log('2. Contract: 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045 (Polymarket CTF)');
    console.log('3. Event: ConditionResolution(bytes32 indexed conditionId, uint payoutNumerators[])');
    console.log('4. Use Goldsky, Flipside, or direct RPC to fetch historical events');
    console.log('5. Cross-reference with our 227K traded condition IDs');
  } else {
    console.log('1. Investigate existing CTF tables for resolution data');
    console.log('2. Cross-reference with traded markets');
    console.log('3. Build backfill from existing on-chain data');
  }

  console.log('\n' + '═'.repeat(80) + '\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
