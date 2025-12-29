#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * DIAGNOSE ENGINE FAILURES
 * ============================================================================
 *
 * Deep dive into why each engine fails for specific wallets.
 * Helps identify root causes and fixes.
 *
 * Usage:
 *   npx tsx scripts/pnl/diagnose-engine-failures.ts --wallet=0x...
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import { clickhouse } from '../../lib/clickhouse/client';

const args = process.argv.slice(2);
let wallet = '0x57c22158a0fba791d6c3049a8aa981e0c0ddb716'; // Default: V11 returns $0

for (const arg of args) {
  if (arg.startsWith('--wallet=')) wallet = arg.split('=')[1];
}

async function diagnose() {
  console.log('='.repeat(80));
  console.log('ENGINE FAILURE DIAGNOSIS');
  console.log('='.repeat(80));
  console.log(`\nWallet: ${wallet}\n`);

  // 1. Check if wallet exists in different data sources
  console.log('1. DATA SOURCE COVERAGE\n');

  // V2 trader events (used by V11)
  const v2Query = `
    SELECT
      count() as event_count,
      count(DISTINCT token_id) as unique_tokens,
      sum(usdc_amount) / 1e6 as total_usdc
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
  `;
  const v2Res = await clickhouse.query({ query: v2Query, format: 'JSONEachRow' });
  const v2Data = (await v2Res.json())[0] as any;
  console.log(`  pm_trader_events_v2:`);
  console.log(`    Events: ${v2Data.event_count}`);
  console.log(`    Unique tokens: ${v2Data.unique_tokens}`);
  console.log(`    Total USDC: $${Number(v2Data.total_usdc).toFixed(2)}`);

  // V8 unified ledger (used by V29)
  const v8Query = `
    SELECT
      count() as event_count,
      count(DISTINCT condition_id) as unique_conditions,
      sum(abs(usdc_delta)) as total_usdc
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
  `;
  const v8Res = await clickhouse.query({ query: v8Query, format: 'JSONEachRow' });
  const v8Data = (await v8Res.json())[0] as any;
  console.log(`\n  pm_unified_ledger_v8_tbl:`);
  console.log(`    Events: ${v8Data.event_count}`);
  console.log(`    Unique conditions: ${v8Data.unique_conditions}`);
  console.log(`    Total USDC: $${Number(v8Data.total_usdc).toFixed(2)}`);

  // V7 unified ledger (used by V23C)
  const v7Query = `
    SELECT
      count() as event_count,
      count(DISTINCT condition_id) as unique_conditions,
      sum(abs(usdc_delta)) as total_usdc
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
  `;
  const v7Res = await clickhouse.query({ query: v7Query, format: 'JSONEachRow' });
  const v7Data = (await v7Res.json())[0] as any;
  console.log(`\n  pm_unified_ledger_v7:`);
  console.log(`    Events: ${v7Data.event_count}`);
  console.log(`    Unique conditions: ${v7Data.unique_conditions}`);
  console.log(`    Total USDC: $${Number(v7Data.total_usdc).toFixed(2)}`);

  // 2. Check token mapping coverage
  console.log('\n\n2. TOKEN MAPPING COVERAGE\n');

  // Get tokens from V2 that can/cannot be mapped
  const tokenMappingQuery = `
    WITH wallet_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
    SELECT
      count(*) as total_tokens,
      countIf(m3.condition_id IS NOT NULL) as mapped_v3,
      countIf(m5.condition_id IS NOT NULL) as mapped_v5
    FROM wallet_tokens wt
    LEFT JOIN pm_token_to_condition_map_v3 m3 ON wt.token_id = m3.token_id_dec
    LEFT JOIN pm_token_to_condition_map_v5 m5 ON wt.token_id = m5.token_id_dec
  `;
  const tokenRes = await clickhouse.query({ query: tokenMappingQuery, format: 'JSONEachRow' });
  const tokenData = (await tokenRes.json())[0] as any;
  console.log(`  Wallet's tokens: ${tokenData.total_tokens}`);
  console.log(`  Mapped in V3 (V11 uses): ${tokenData.mapped_v3} (${((tokenData.mapped_v3/tokenData.total_tokens)*100).toFixed(1)}%)`);
  console.log(`  Mapped in V5 (latest): ${tokenData.mapped_v5} (${((tokenData.mapped_v5/tokenData.total_tokens)*100).toFixed(1)}%)`);

  const missingV3 = tokenData.total_tokens - tokenData.mapped_v3;
  if (missingV3 > 0) {
    console.log(`\n  ⚠️  V11 MISSING ${missingV3} tokens due to outdated V3 map!`);
  }

  // 3. Check resolution coverage
  console.log('\n\n3. RESOLUTION COVERAGE\n');

  const resQuery = `
    WITH wallet_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
    )
    SELECT
      count(*) as total_conditions,
      countIf(r.payout_numerators IS NOT NULL) as resolved_count
    FROM wallet_conditions wc
    LEFT JOIN pm_condition_resolutions r ON lower(wc.condition_id) = lower(r.condition_id)
  `;
  const resRes = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resData = (await resRes.json())[0] as any;
  console.log(`  Conditions traded: ${resData.total_conditions}`);
  console.log(`  Resolved: ${resData.resolved_count} (${((resData.resolved_count/resData.total_conditions)*100).toFixed(1)}%)`);
  console.log(`  Unresolved: ${resData.total_conditions - resData.resolved_count}`);

  // 4. Sample events from each source
  console.log('\n\n4. SAMPLE EVENTS\n');

  const sampleQuery = `
    SELECT
      source_type,
      condition_id,
      outcome_index,
      usdc_delta,
      token_delta,
      event_time
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
    ORDER BY event_time DESC
    LIMIT 10
  `;
  const sampleRes = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleRows = await sampleRes.json() as any[];

  console.log('  Latest 10 events from V8 ledger:');
  for (const r of sampleRows) {
    console.log(`    ${r.source_type.padEnd(20)} cond=${r.condition_id.slice(0,10)}... USDC=${Number(r.usdc_delta).toFixed(2)} tokens=${Number(r.token_delta).toFixed(2)}`);
  }

  // 5. Check for data quality issues
  console.log('\n\n5. DATA QUALITY CHECKS\n');

  // Check for NULL condition_ids
  const nullCondQuery = `
    SELECT
      count() as null_condition_events
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND (condition_id IS NULL OR condition_id = '')
  `;
  const nullRes = await clickhouse.query({ query: nullCondQuery, format: 'JSONEachRow' });
  const nullData = (await nullRes.json())[0] as any;
  console.log(`  Events with NULL condition_id: ${nullData.null_condition_events}`);

  // Check for duplicate events
  const dupQuery = `
    SELECT
      count() as total,
      count(DISTINCT event_id) as unique_ids
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
  `;
  const dupRes = await clickhouse.query({ query: dupQuery, format: 'JSONEachRow' });
  const dupData = (await dupRes.json())[0] as any;
  const duplicates = dupData.total - dupData.unique_ids;
  console.log(`  Duplicate events (same event_id): ${duplicates}`);

  // 6. Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('DIAGNOSIS SUMMARY');
  console.log('='.repeat(80));

  const issues: string[] = [];

  if (missingV3 > 0) {
    issues.push(`V11 uses V3 map which is missing ${missingV3} tokens - UPGRADE TO V5`);
  }
  if (v7Data.event_count !== v8Data.event_count) {
    issues.push(`V23C uses V7 ledger (${v7Data.event_count} events) vs V8 (${v8Data.event_count}) - UPGRADE TO V8`);
  }
  if (duplicates > 0) {
    issues.push(`Found ${duplicates} duplicate events - CHECK DEDUPLICATION`);
  }
  if (nullData.null_condition_events > 0) {
    issues.push(`${nullData.null_condition_events} events have NULL condition_id - CHECK ENRICHMENT`);
  }

  if (issues.length === 0) {
    console.log('\n✅ No obvious data issues found. Problem may be in calculation logic.\n');
  } else {
    console.log('\n⚠️  ISSUES FOUND:\n');
    for (const issue of issues) {
      console.log(`  • ${issue}`);
    }
    console.log('');
  }
}

diagnose().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
