#!/usr/bin/env tsx
/**
 * Fix Repaired Views - Eliminate t.* Shadowing and Add CID Normalization
 * 
 * Step 1: Discover actual schema of pm_trades_canonical_v3
 * Step 2: Recreate repaired view with explicit columns
 * Step 3: Add CID normalization helper view
 * Step 4: Validate Xi market recovery and zero collisions
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const XCN_REAL = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function main() {
  console.log('═'.repeat(80));
  console.log('FIX REPAIRED VIEWS - ELIMINATE t.* SHADOWING');
  console.log('═'.repeat(80));
  console.log('');

  // ========================================================================
  // STEP 1: Discover Schema
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 1: DISCOVER pm_trades_canonical_v3 SCHEMA');
  console.log('═'.repeat(80));
  console.log('');

  const schemaResult = await clickhouse.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = 'default' AND table = 'pm_trades_canonical_v3'
      ORDER BY position
    `,
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json() as any[];

  console.log('Available columns:');
  console.log('─'.repeat(60));
  for (const col of schema) {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  }
  console.log('');

  // Build column list for view (excluding wallet_address which we'll compute)
  const columnNames = schema.map((c: any) => c.name);
  const viewColumns = columnNames
    .filter((name: string) => name !== 'wallet_address')
    .map((name: string) => `t.${name}`)
    .join(',\n      ');

  // ========================================================================
  // STEP 2: Recreate Repaired View (Explicit Columns)
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 2: RECREATE REPAIRED VIEW (NO t.* SHADOWING)');
  console.log('═'.repeat(80));
  console.log('');

  const repairViewQuery = `
    CREATE OR REPLACE VIEW vw_trades_canonical_xcn_repaired AS
    SELECT
      ${viewColumns},
      t.wallet_address,
      rm.correct_wallet,
      coalesce(rm.correct_wallet, t.wallet_address) AS wallet_address_fixed
    FROM pm_trades_canonical_v3 t
    LEFT JOIN tmp_xcn_repair_map rm ON t.transaction_hash = rm.transaction_hash
  `;

  console.log('Creating vw_trades_canonical_xcn_repaired...');
  await clickhouse.command({ query: repairViewQuery });
  console.log('✅ Success');

  // ========================================================================
  // STEP 3: Add CID Normalization Helper View
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 3: CREATE CID NORMALIZATION HELPER VIEW');
  console.log('═'.repeat(80));
  console.log('');

  const normedViewQuery = `
    CREATE OR REPLACE VIEW vw_trades_canonical_normed AS
    SELECT
      *,
      replaceRegexpAll(lower(condition_id_norm_v3), '^0x', '') AS cid_norm
    FROM vw_trades_canonical_xcn_repaired
  `;

  console.log('Creating vw_trades_canonical_normed...');
  await clickhouse.command({ query: normedViewQuery });
  console.log('✅ Success');

  // ========================================================================
  // STEP 4: Recreate XCN-Only View
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 4: RECREATE XCN-ONLY VIEW');
  console.log('═'.repeat(80));
  console.log('');

  const xcnViewQuery = `
    CREATE OR REPLACE VIEW vw_xcn_repaired_only AS
    SELECT *
    FROM vw_trades_canonical_normed
    WHERE lower(wallet_address_fixed) = '${XCN_REAL.toLowerCase()}'
  `;

  console.log('Creating vw_xcn_repaired_only...');
  await clickhouse.command({ query: xcnViewQuery });
  console.log('✅ Success');

  // ========================================================================
  // STEP 5: Validate Xi Market Recovery
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 5: VALIDATE XI MARKET RECOVERY');
  console.log('═'.repeat(80));
  console.log('');

  const xiQuery = `
    SELECT
      count(*) AS trades,
      sumIf(usd_value, trade_direction = 'BUY') AS cost,
      sumIf(usd_value, trade_direction = 'SELL') AS proceeds,
      sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
      min(timestamp) AS first_trade,
      max(timestamp) AS last_trade
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
  `;

  const xiResult = await clickhouse.query({ query: xiQuery, format: 'JSONEachRow' });
  const xiData = await xiResult.json() as any[];

  if (xiData.length > 0 && parseInt(xiData[0].trades) > 0) {
    const trades = parseInt(xiData[0].trades);
    const cost = parseFloat(xiData[0].cost || '0');
    const proceeds = parseFloat(xiData[0].proceeds || '0');
    const netShares = parseFloat(xiData[0].net_shares || '0');
    const firstTrade = xiData[0].first_trade;
    const lastTrade = xiData[0].last_trade;

    console.log('✅ XI MARKET RECOVERED IN REPAIRED VIEW');
    console.log('');
    console.log(`  Trades:      ${trades.toLocaleString()}`);
    console.log(`  Cost:        $${cost.toFixed(2)}`);
    console.log(`  Proceeds:    $${proceeds.toFixed(2)}`);
    console.log(`  Net Shares:  ${netShares.toFixed(2)}`);
    console.log(`  First Trade: ${firstTrade}`);
    console.log(`  Last Trade:  ${lastTrade}`);
    console.log('');

    if (trades === 1833) {
      console.log('✅ EXACT MATCH: 1,833 trades (matches original pm_trades_canonical_v3 count)');
    } else if (trades > 1800) {
      console.log(`✅ CLOSE MATCH: ${trades} trades (expected ~1,833)`);
    } else {
      console.log(`⚠️  PARTIAL RECOVERY: ${trades} trades (expected 1,833)`);
    }
  } else {
    console.log('❌ Xi Market STILL NOT FOUND after view fix');
    console.log('   → Further investigation needed');
  }

  // ========================================================================
  // STEP 6: Validate Zero Collisions
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 6: VALIDATE ZERO COLLISIONS AFTER FIX');
  console.log('═'.repeat(80));
  console.log('');

  const collisionQuery = `
    SELECT count() AS collided_hashes
    FROM (
      SELECT transaction_hash, countDistinct(wallet_address_fixed) AS w
      FROM vw_trades_canonical_xcn_repaired
      GROUP BY transaction_hash
      HAVING w > 1
    )
  `;

  const collisionResult = await clickhouse.query({ query: collisionQuery, format: 'JSONEachRow' });
  const collisionData = await collisionResult.json() as any[];
  const collidedHashes = parseInt(collisionData[0]?.collided_hashes || '0');

  if (collidedHashes === 0) {
    console.log('✅ ZERO COLLISIONS CONFIRMED');
    console.log('   All transaction hashes now map to single wallet_address_fixed');
  } else {
    console.log(`⚠️  ${collidedHashes} collisions remain after repair`);
    console.log('   Repair logic may need adjustment');
  }

  // ========================================================================
  // STEP 7: Trade Count Comparison
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 7: TRADE COUNT COMPARISON (REAL WALLET)');
  console.log('═'.repeat(80));
  console.log('');

  const originalQuery = `
    SELECT count() AS trades
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = '${XCN_REAL.toLowerCase()}'
  `;

  const repairedQuery = `
    SELECT count() AS trades
    FROM vw_xcn_repaired_only
  `;

  const [originalResult, repairedResult] = await Promise.all([
    clickhouse.query({ query: originalQuery, format: 'JSONEachRow' }),
    clickhouse.query({ query: repairedQuery, format: 'JSONEachRow' })
  ]);

  const originalData = await originalResult.json() as any[];
  const repairedData = await repairedResult.json() as any[];

  const originalCount = parseInt(originalData[0]?.trades || '0');
  const repairedCount = parseInt(repairedData[0]?.trades || '0');
  const delta = repairedCount - originalCount;

  console.log(`Original (pm_trades_canonical_v3):  ${originalCount.toLocaleString()} trades`);
  console.log(`Repaired (vw_xcn_repaired_only):    ${repairedCount.toLocaleString()} trades`);
  console.log(`Delta:                              ${delta >= 0 ? '+' : ''}${delta.toLocaleString()} trades`);
  console.log('');

  if (Math.abs(delta) === 0) {
    console.log('✅ PERFECT MATCH: Repaired view preserves all original trades');
  } else if (Math.abs(delta) < originalCount * 0.01) {
    console.log('✅ ACCEPTABLE: Delta < 1% of original');
  } else {
    console.log(`⚠️  SIGNIFICANT DELTA: ${((Math.abs(delta) / originalCount) * 100).toFixed(2)}% change`);
  }

  // ========================================================================
  // FINAL SUMMARY
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('REPAIR COMPLETE - SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Views Created:');
  console.log('  • vw_trades_canonical_xcn_repaired (explicit columns, no t.* shadowing)');
  console.log('  • vw_trades_canonical_normed (CID normalization helper)');
  console.log('  • vw_xcn_repaired_only (real wallet filter)');
  console.log('');
  console.log('Validation Results:');
  console.log(`  • Xi Market Trades: ${parseInt(xiData[0]?.trades || '0').toLocaleString()} (expected 1,833)`);
  console.log(`  • Collisions: ${collidedHashes} (expected 0)`);
  console.log(`  • Total XCN Trades: ${repairedCount.toLocaleString()} (original: ${originalCount.toLocaleString()})`);
  console.log('');
  console.log('Next Steps:');
  console.log('  • Use vw_xcn_repaired_only for C3 PnL reruns');
  console.log('  • Share tmp_xcn_repair_map + /tmp/xcn_hash_collisions.tsv as audit trail');
  console.log('  • Monitor repaired view for data quality');
  console.log('');
}

main().catch(console.error);
