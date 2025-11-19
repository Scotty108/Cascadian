#!/usr/bin/env tsx
/**
 * Fix Position Lifecycle Bug
 *
 * Problem: 252,933 positions marked as "open" when most markets are resolved
 * Evidence: Wallet 0x4ce7 has 48+ closed positions on Polymarket but shows 0 in our system
 *
 * Solution: Mark positions as CLOSED when condition_id has resolution in market_resolutions_final
 *
 * Expected outcome: Reduce "open" positions from 252K → 10-20K truly active positions
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 300000, // 5 min for large operations
});

async function fixPositionLifecycle() {
  console.log('================================================================================');
  console.log('🔧 FIXING POSITION LIFECYCLE BUG');
  console.log('================================================================================\n');

  // Step 1: Find position tables
  console.log('1️⃣ Finding position tables...');
  const tables = await ch.query({
    query: `
      SELECT
        database,
        name,
        engine
      FROM system.tables
      WHERE (name LIKE '%position%' OR name LIKE '%pnl%')
        AND database IN ('default', 'cascadian_clean')
        AND engine NOT IN ('View', 'MaterializedView')
      ORDER BY database, name
    `,
    format: 'JSONEachRow',
  });
  const tableList = await tables.json<any>();

  console.log('   Found tables:');
  tableList.forEach((t: any) => {
    console.log(`   - ${t.database}.${t.name} (${t.engine})`);
  });

  // Step 2: Check current "open" position counts
  console.log('\n2️⃣ Checking current position counts...');

  // Try vw_positions_open first
  let openPositionsTable = 'default.vw_positions_open';
  let openCount = 0;

  try {
    const openCheck = await ch.query({
      query: `SELECT count() as cnt FROM ${openPositionsTable}`,
      format: 'JSONEachRow',
    });
    const openData = await openCheck.json<any>();
    openCount = parseInt(openData[0].cnt);
    console.log(`   ${openPositionsTable}: ${openCount.toLocaleString()} open positions`);
  } catch (e: any) {
    console.log(`   ❌ ${openPositionsTable} does not exist`);

    // Try to find the actual position table
    console.log('   Searching for base position table...');
    const posTableSearch = await ch.query({
      query: `
        SELECT name, database
        FROM system.tables
        WHERE name LIKE '%position%'
          AND database IN ('default', 'cascadian_clean')
          AND engine IN ('ReplacingMergeTree', 'MergeTree')
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const posTable = await posTableSearch.json<any>();

    if (posTable.length > 0) {
      openPositionsTable = `${posTable[0].database}.${posTable[0].name}`;
      console.log(`   Found: ${openPositionsTable}`);

      const openCheck2 = await ch.query({
        query: `SELECT count() as cnt FROM ${openPositionsTable}`,
        format: 'JSONEachRow',
      });
      const openData2 = await openCheck2.json<any>();
      openCount = parseInt(openData2[0].cnt);
      console.log(`   Total positions: ${openCount.toLocaleString()}`);
    }
  }

  // Step 3: Count how many positions should be marked as CLOSED
  console.log('\n3️⃣ Identifying positions with resolutions...');
  const shouldBeClosedQuery = await ch.query({
    query: `
      SELECT count() as should_close
      FROM ${openPositionsTable} p
      INNER JOIN default.market_resolutions_final r
        ON p.condition_id = r.condition_id_norm
      WHERE length(r.payout_numerators) > 0
    `,
    format: 'JSONEachRow',
  });
  const shouldBeClosedData = await shouldBeClosedQuery.json<any>();
  const shouldClose = parseInt(shouldBeClosedData[0].should_close);

  console.log(`   Positions with resolutions: ${shouldClose.toLocaleString()}`);
  console.log(`   Will remain open: ${(openCount - shouldClose).toLocaleString()}`);
  console.log(`   Reduction: ${((shouldClose / openCount) * 100).toFixed(1)}%`);

  // Step 4: Check wallet 0x4ce7 specifically
  console.log('\n4️⃣ Checking wallet 0x4ce7 (test case)...');
  const TEST_WALLET = '4ce73141dbfce41e65db3723e31059a730f0abad';

  const walletCheck = await ch.query({
    query: `
      SELECT
        count() as total_positions,
        countIf(r.condition_id_norm IS NOT NULL) as with_resolution,
        countIf(r.condition_id_norm IS NULL) as no_resolution
      FROM ${openPositionsTable} p
      LEFT JOIN default.market_resolutions_final r
        ON p.condition_id = r.condition_id_norm
        AND length(r.payout_numerators) > 0
      WHERE lower(p.wallet_address) = lower('${TEST_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const walletData = await walletCheck.json<any>();

  console.log(`   Total positions: ${walletData[0].total_positions}`);
  console.log(`   With resolution (should close): ${walletData[0].with_resolution}`);
  console.log(`   No resolution (stay open): ${walletData[0].no_resolution}`);
  console.log(`   Expected after fix: ${walletData[0].with_resolution} closed positions`);

  // Step 5: Get table schema to understand structure
  console.log('\n5️⃣ Analyzing table schema...');
  const schemaQuery = await ch.query({
    query: `DESCRIBE TABLE ${openPositionsTable}`,
    format: 'JSONEachRow',
  });
  const schema = await schemaQuery.json<any>();

  const hasStatusColumn = schema.some((col: any) => col.name === 'status');
  const hasPositionClosedColumn = schema.some((col: any) => col.name === 'position_closed');
  const hasIsOpenColumn = schema.some((col: any) => col.name === 'is_open');

  console.log('   Schema analysis:');
  console.log(`   - Has 'status' column: ${hasStatusColumn}`);
  console.log(`   - Has 'position_closed' column: ${hasPositionClosedColumn}`);
  console.log(`   - Has 'is_open' column: ${hasIsOpenColumn}`);

  if (!hasStatusColumn && !hasPositionClosedColumn && !hasIsOpenColumn) {
    console.log('\n   ⚠️  No status/lifecycle columns found!');
    console.log('   This table may need a schema update first.');
    console.log('\n   Key columns found:');
    schema.slice(0, 10).forEach((col: any) => {
      console.log(`   - ${col.name} (${col.type})`);
    });
  }

  // Step 6: Propose fix strategy
  console.log('\n6️⃣ Fix strategy...');
  console.log('   Based on table structure, the fix approach is:');

  if (hasStatusColumn) {
    console.log('   ✅ Use status column to mark CLOSED');
    console.log('   SQL: UPDATE/INSERT positions SET status = "CLOSED" WHERE condition_id IN (resolutions)');
  } else if (hasPositionClosedColumn) {
    console.log('   ✅ Use position_closed timestamp');
    console.log('   SQL: UPDATE/INSERT positions SET position_closed = resolution.resolved_at WHERE...');
  } else if (hasIsOpenColumn) {
    console.log('   ✅ Use is_open boolean flag');
    console.log('   SQL: UPDATE/INSERT positions SET is_open = 0 WHERE...');
  } else {
    console.log('   ⚠️  OPTION A: Rebuild table with status column (atomic rebuild pattern)');
    console.log('   ⚠️  OPTION B: Create new view that filters by resolution join');
    console.log('   ⚠️  OPTION C: Modify P&L views to check resolution table directly');
  }

  // Step 7: Preview fix query
  console.log('\n7️⃣ Preview: Positions that will be marked CLOSED...');
  const previewQuery = await ch.query({
    query: `
      SELECT
        p.wallet_address,
        p.condition_id,
        count() as position_count
      FROM ${openPositionsTable} p
      INNER JOIN default.market_resolutions_final r
        ON p.condition_id = r.condition_id_norm
      WHERE length(r.payout_numerators) > 0
      GROUP BY p.wallet_address, p.condition_id
      ORDER BY position_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const preview = await previewQuery.json<any>();

  preview.forEach((row: any, idx: number) => {
    console.log(`   ${idx + 1}. Wallet ${row.wallet_address.substring(0, 8)}... | Condition ${row.condition_id.substring(0, 16)}... | Count: ${row.position_count}`);
  });

  console.log('\n================================================================================');
  console.log('✅ ANALYSIS COMPLETE');
  console.log('================================================================================');
  console.log(`\nSummary:`);
  console.log(`- Current open positions: ${openCount.toLocaleString()}`);
  console.log(`- Should be marked closed: ${shouldClose.toLocaleString()}`);
  console.log(`- Will remain open: ${(openCount - shouldClose).toLocaleString()}`);
  console.log(`- Wallet 0x4ce7: ${walletData[0].with_resolution} positions should close`);
  console.log(`\nNext step: Execute the fix based on table schema analysis above`);

  await ch.close();
}

fixPositionLifecycle().catch(console.error);
