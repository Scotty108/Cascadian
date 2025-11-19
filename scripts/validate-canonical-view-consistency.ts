#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

// Task 1: Validate canonical view consistency
// Check for column shadowing, NULL coalesce issues, and data integrity

async function main() {
  console.log('═'.repeat(80));
  console.log('CANONICAL VIEW CONSISTENCY CHECK');
  console.log('═'.repeat(80));
  console.log('');

  try {
    // Test 1: Check for NULL wallet_canonical values
    console.log('TEST 1: NULL wallet_canonical Detection');
    console.log('─'.repeat(80));

    const nullCheckQuery = `
      SELECT count() AS total_rows,
             countIf(wallet_canonical IS NULL) AS null_canonical,
             countIf(wallet_canonical = '') AS empty_canonical
      FROM vw_trades_canonical_with_canonical_wallet
    `;

    const nullResult = await clickhouse.query({ query: nullCheckQuery, format: 'JSONEachRow' });
    const nullData = await nullResult.json() as any[];

    console.log(`  Total rows: ${parseInt(nullData[0].total_rows).toLocaleString()}`);
    console.log(`  NULL wallet_canonical: ${parseInt(nullData[0].null_canonical).toLocaleString()}`);
    console.log(`  Empty wallet_canonical: ${parseInt(nullData[0].empty_canonical).toLocaleString()}`);
    console.log('');

    if (parseInt(nullData[0].null_canonical) > 0) {
      console.log('⚠️  WARNING: Found NULL wallet_canonical values - coalesce may be failing');
    } else {
      console.log('✅ No NULL wallet_canonical values');
    }
    console.log('');

    // Test 2: Reproducible CID check - total trades vs filtered trades
    console.log('TEST 2: CID Consistency Check (Xi Market)');
    console.log('─'.repeat(80));

    const XI_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

    // Count from base table
    const baseQuery = `
      SELECT count() AS base_count
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = '${XI_CID}'
    `;

    const baseResult = await clickhouse.query({ query: baseQuery, format: 'JSONEachRow' });
    const baseData = await baseResult.json() as any[];
    const baseCount = parseInt(baseData[0].base_count);

    // Count from canonical view (no wallet filter)
    const viewNoFilterQuery = `
      SELECT count() AS view_no_filter_count
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE cid_norm = '${XI_CID}'
    `;

    const viewNoFilterResult = await clickhouse.query({ query: viewNoFilterQuery, format: 'JSONEachRow' });
    const viewNoFilterData = await viewNoFilterResult.json() as any[];
    const viewNoFilterCount = parseInt(viewNoFilterData[0].view_no_filter_count);

    // Count from canonical view (with XCN wallet filter)
    const XCN_ACCOUNT = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
    const viewWithFilterQuery = `
      SELECT count() AS view_with_filter_count
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE cid_norm = '${XI_CID}'
        AND wallet_canonical = '${XCN_ACCOUNT}'
    `;

    const viewWithFilterResult = await clickhouse.query({ query: viewWithFilterQuery, format: 'JSONEachRow' });
    const viewWithFilterData = await viewWithFilterResult.json() as any[];
    const viewWithFilterCount = parseInt(viewWithFilterData[0].view_with_filter_count);

    console.log(`  Base table count (Xi CID):                    ${baseCount.toLocaleString()}`);
    console.log(`  Canonical view count (Xi CID, no filter):     ${viewNoFilterCount.toLocaleString()}`);
    console.log(`  Canonical view count (Xi CID + XCN wallet):   ${viewWithFilterCount.toLocaleString()}`);
    console.log('');

    if (baseCount !== viewNoFilterCount) {
      console.log(`⚠️  WARNING: Row count mismatch between base and view (${baseCount} vs ${viewNoFilterCount})`);
      console.log('   This suggests column shadowing or JOIN issues');
    } else {
      console.log('✅ Row counts match between base table and view');
    }

    if (viewWithFilterCount !== 1833) {
      console.log(`⚠️  WARNING: XCN wallet count mismatch (expected 1,833, got ${viewWithFilterCount})`);
    } else {
      console.log('✅ XCN wallet count matches expected value (1,833)');
    }
    console.log('');

    // Test 3: Check for duplicate column names (shadowing)
    console.log('TEST 3: Column Shadowing Detection');
    console.log('─'.repeat(80));

    const columnCheckQuery = `
      SELECT *
      FROM vw_trades_canonical_with_canonical_wallet
      LIMIT 1
    `;

    const columnResult = await clickhouse.query({ query: columnCheckQuery, format: 'JSONEachRow' });
    const columnData = await columnResult.json() as any[];

    if (columnData.length > 0) {
      const columns = Object.keys(columnData[0]);
      console.log(`  Total columns in view: ${columns.length}`);
      console.log('');

      // Check for duplicates
      const columnCounts = new Map<string, number>();
      for (const col of columns) {
        columnCounts.set(col, (columnCounts.get(col) || 0) + 1);
      }

      const duplicates = Array.from(columnCounts.entries()).filter(([_, count]) => count > 1);
      if (duplicates.length > 0) {
        console.log('⚠️  WARNING: Duplicate column names detected:');
        duplicates.forEach(([col, count]) => {
          console.log(`     ${col}: appears ${count} times`);
        });
      } else {
        console.log('✅ No duplicate column names');
      }

      // Check for critical columns
      const criticalColumns = ['wallet_canonical', 'wallet_raw', 'cid_norm'];
      console.log('');
      console.log('  Critical columns present:');
      criticalColumns.forEach(col => {
        if (columns.includes(col)) {
          console.log(`     ✅ ${col}`);
        } else {
          console.log(`     ❌ ${col} (MISSING!)`);
        }
      });
    }
    console.log('');

    // Test 4: Sample coalesce logic validation
    console.log('TEST 4: Coalesce Logic Validation');
    console.log('─'.repeat(80));

    const coalesceQuery = `
      SELECT
        lower(t.wallet_address) AS raw_wallet,
        ov.canonical_wallet AS override_result,
        wim.canonical_wallet AS wim_canonical,
        wim.user_eoa AS wim_eoa,
        coalesce(
          ov.canonical_wallet,
          wim.canonical_wallet,
          wim.user_eoa,
          lower(t.wallet_address)
        ) AS final_canonical
      FROM pm_trades_canonical_v3 t
      LEFT JOIN wallet_identity_overrides ov
        ON lower(t.wallet_address) = ov.executor_wallet
      LEFT JOIN wallet_identity_map wim
        ON lower(t.wallet_address) = wim.proxy_wallet
        AND wim.proxy_wallet != wim.user_eoa
      WHERE lower(t.wallet_address) = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
      LIMIT 5
    `;

    const coalesceResult = await clickhouse.query({ query: coalesceQuery, format: 'JSONEachRow' });
    const coalesceData = await coalesceResult.json() as any[];

    if (coalesceData.length > 0) {
      const row = coalesceData[0];
      console.log(`  Raw wallet:           ${row.raw_wallet || 'NULL'}`);
      console.log(`  Override result:      ${row.override_result || 'NULL'}`);
      console.log(`  WIM canonical:        ${row.wim_canonical || 'NULL'}`);
      console.log(`  WIM EOA:              ${row.wim_eoa || 'NULL'}`);
      console.log(`  Final canonical:      ${row.final_canonical || 'NULL'}`);
      console.log('');

      if (row.final_canonical === '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b') {
        console.log('✅ XCN coalesce logic working correctly');
      } else {
        console.log('⚠️  WARNING: Coalesce not resolving to expected account wallet');
      }
    }
    console.log('');

    console.log('═'.repeat(80));
    console.log('✅ CONSISTENCY CHECK COMPLETE');
    console.log('═'.repeat(80));

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
