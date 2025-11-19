#!/usr/bin/env npx tsx
/**
 * Check which table and column names the P&L views are using
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
  console.log('\n🔍 CHECKING P&L VIEW DEFINITIONS\n');
  console.log('═'.repeat(80));

  const viewsToCheck = [
    'default.vw_trades_canonical',
    'default.vw_wallet_pnl_calculated',
    'default.vw_wallet_pnl_summary',
    'cascadian_clean.vw_trades_canonical'
  ];

  for (const viewName of viewsToCheck) {
    console.log(`\n📋 ${viewName}:\n`);

    try {
      const viewDef = await ch.query({
        query: `SHOW CREATE TABLE ${viewName}`,
        format: 'JSONEachRow'
      });
      const viewDefData = await viewDef.json<any>();
      const createStmt = viewDefData[0].statement;

      // Check which table it uses
      if (createStmt.includes('cascadian_clean.fact_trades_clean')) {
        console.log(`  ✅ Uses: cascadian_clean.fact_trades_clean`);
      } else if (createStmt.includes('default.fact_trades_clean')) {
        console.log(`  ⚠️  Uses: default.fact_trades_clean`);
      }

      // Check which condition ID column it uses
      if (createStmt.includes('cid_hex')) {
        console.log(`  Column: cid_hex`);
      } else if (createStmt.includes('cid') && !createStmt.includes('cid_hex')) {
        console.log(`  Column: cid`);
      }

      // Check if it includes resolutions_external_ingest
      if (createStmt.includes('resolutions_external_ingest')) {
        console.log(`  ✅ Includes resolutions_external_ingest`);
      } else {
        console.log(`  ❌ Does NOT include resolutions_external_ingest`);
      }

      // Print first 500 chars of definition
      console.log(`\n  Definition preview:`);
      console.log(`  ${createStmt.substring(0, 500)}...`);

    } catch (e: any) {
      console.log(`  ❌ View doesn't exist or error: ${e.message}`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('📊 DIAGNOSIS\n');

  console.log('The issue is likely one of:');
  console.log('1. P&L views use default.fact_trades_clean but query cid_hex (column doesn\'t exist)');
  console.log('2. P&L views use cascadian_clean.fact_trades_clean but don\'t include resolutions_external_ingest');
  console.log('3. P&L views use wrong column name for join (cid vs cid_hex mismatch)\n');

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
