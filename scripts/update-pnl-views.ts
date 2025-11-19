#!/usr/bin/env tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n=== UPDATING P&L VIEWS TO USE vw_resolutions_unified ===\n');

  const viewsToUpdate = [
    'vw_trade_pnl',
    'vw_trade_pnl_final',
    'vw_wallet_pnl_simple',
    'vw_wallet_positions',
  ];

  for (const viewName of viewsToUpdate) {
    console.log(`\nChecking ${viewName}...`);

    // Get current definition
    const defQuery = await ch.query({
      query: `
        SELECT create_table_query
        FROM system.tables
        WHERE database = 'cascadian_clean'
          AND name = '${viewName}'
          AND engine = 'View'
      `,
      format: 'JSONEachRow',
    });

    const defs = await defQuery.json() as Array<{ create_table_query: string }>;

    if (defs.length === 0) {
      console.log(`  ⚠️  View not found in cascadian_clean`);
      continue;
    }

    const currentDef = defs[0].create_table_query;

    // Check if it uses old resolution tables
    const usesOldTable =
      currentDef.includes('vw_resolutions_all') ||
      currentDef.includes('market_resolutions_final') ||
      currentDef.includes('resolutions_src_api');

    const alreadyUpdated = currentDef.includes('vw_resolutions_unified');

    if (alreadyUpdated) {
      console.log(`  ✅ Already using vw_resolutions_unified`);
      continue;
    }

    if (!usesOldTable) {
      console.log(`  ℹ️  Does not use resolution tables directly (may use subview)`);
      continue;
    }

    console.log(`  🔄 Needs update`);

    // Show what would change
    const oldTable = currentDef.includes('vw_resolutions_all')
      ? 'vw_resolutions_all'
      : currentDef.includes('market_resolutions_final')
      ? 'market_resolutions_final'
      : 'resolutions_src_api';

    console.log(`     Currently uses: ${oldTable}`);
    console.log(`     Will use:       vw_resolutions_unified`);

    // Create new definition
    const newDef = currentDef.replace(/vw_resolutions_all/g, 'vw_resolutions_unified');

    console.log(`\n     Applying update...`);

    try {
      // Drop and recreate view
      await ch.command({ query: `DROP VIEW IF EXISTS cascadian_clean.${viewName}` });
      await ch.command({ query: newDef });
      console.log(`     ✅ Updated successfully`);
    } catch (error: any) {
      console.log(`     ❌ Error: ${error.message}`);
      console.log(`     Skipping this view`);
    }
  }

  console.log('\n=== VERIFICATION ===\n');

  // Test that views still work
  for (const viewName of viewsToUpdate) {
    try {
      const testQuery = await ch.query({
        query: `SELECT count(*) as cnt FROM cascadian_clean.${viewName} LIMIT 1`,
        format: 'JSONEachRow',
      });

      const result = (await testQuery.json())[0] as { cnt: string };
      console.log(`${viewName.padEnd(25)}: ✅ Working (${parseInt(result.cnt).toLocaleString()} rows)`);
    } catch (error: any) {
      console.log(`${viewName.padEnd(25)}: ❌ Error - ${error.message}`);
    }
  }

  console.log('\n✅ P&L views updated successfully!\n');

  await ch.close();
}

main().catch(console.error);
