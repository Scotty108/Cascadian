#!/usr/bin/env tsx
/**
 * XCN Attribution Repair - Fix Transaction Hash Collisions
 *
 * Creates repair map and corrected views for xcnstrategy wallet attribution
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const XCN_REAL = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_MARKET_CID = '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function executeCommand(query: string, description: string) {
  console.log(`\n${description}...`);
  try {
    await clickhouse.command({ query });
    console.log('✅ Success');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('XCN ATTRIBUTION REPAIR - TRANSACTION HASH COLLISION FIX');
  console.log('═'.repeat(80));
  console.log('');

  // ========================================================================
  // TERMINAL 1: Derive per-hash "winner" mapping (repair map)
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 1: CREATE REPAIR MAP');
  console.log('═'.repeat(80));
  console.log('\nLogic: For each collided hash, pick wallet with highest row count');
  console.log('Tie-break: Earliest timestamp wins\n');

  await executeCommand(`
    CREATE OR REPLACE TABLE tmp_xcn_repair_map
    ENGINE = MergeTree
    ORDER BY transaction_hash AS
    SELECT
      transaction_hash,
      tupleElement(
        arrayElement(
          arraySort(
            x -> (tupleElement(x, 2) * -1, tupleElement(x, 3)),
            wallets_hits
          ),
          1
        ),
        1
      ) AS correct_wallet
    FROM (
      SELECT
        transaction_hash,
        groupArray((wallet_address, cnt, min_ts)) AS wallets_hits
      FROM (
        SELECT
          transaction_hash,
          wallet_address,
          count() AS cnt,
          min(timestamp) AS min_ts
        FROM pm_trades_canonical_v3
        WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_xcn_hash_collisions)
        GROUP BY transaction_hash, wallet_address
      )
      GROUP BY transaction_hash
    )
  `, 'Creating tmp_xcn_repair_map (winner selection logic)');

  // ========================================================================
  // TERMINAL 2: Apply repair map into corrected views
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 2: CREATE CORRECTED VIEWS');
  console.log('═'.repeat(80));

  await executeCommand(`
    CREATE OR REPLACE VIEW vw_trades_canonical_xcn_repaired AS
    SELECT
      coalesce(rm.correct_wallet, t.wallet_address) AS wallet_address_fixed,
      t.*
    FROM pm_trades_canonical_v3 t
    LEFT JOIN tmp_xcn_repair_map rm ON t.transaction_hash = rm.transaction_hash
  `, 'Creating vw_trades_canonical_xcn_repaired (global repair view)');

  await executeCommand(`
    CREATE OR REPLACE VIEW vw_xcn_repaired_only AS
    SELECT *
    FROM vw_trades_canonical_xcn_repaired
    WHERE lower(wallet_address_fixed) = '${XCN_REAL.toLowerCase()}'
  `, 'Creating vw_xcn_repaired_only (real wallet only)');

  // ========================================================================
  // TERMINAL 3: Re-check Xi market and collision count
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 3: VALIDATION QUERIES');
  console.log('═'.repeat(80));

  // A) Xi market check (after repair)
  console.log('\n--- A) XI MARKET CHECK (After Repair) ---\n');

  const xiMarketResult = await clickhouse.query({
    query: `
      SELECT
        sumIf(usd_value, trade_direction = 'BUY') AS cost,
        sumIf(usd_value, trade_direction = 'SELL') AS proceeds,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
        count(*) AS trades
      FROM vw_xcn_repaired_only
      WHERE condition_id_norm_v3 = '${XI_MARKET_CID}'
    `,
    format: 'JSONEachRow'
  });
  const xiMarket = await xiMarketResult.json() as any[];

  if (xiMarket.length > 0 && parseInt(xiMarket[0].trades) > 0) {
    console.log(`✅ Xi Market RECOVERED in Repaired View`);
    console.log(`   Trades:      ${xiMarket[0].trades}`);
    console.log(`   Cost:        $${parseFloat(xiMarket[0].cost || '0').toFixed(2)}`);
    console.log(`   Proceeds:    $${parseFloat(xiMarket[0].proceeds || '0').toFixed(2)}`);
    console.log(`   Net Shares:  ${parseFloat(xiMarket[0].net_shares || '0').toFixed(2)}`);
  } else {
    console.log('❌ Xi Market STILL NOT FOUND after repair');
    console.log('   → Data gap is real, not just attribution collision');
  }

  // B) Collision detector on repaired view (should be 0)
  console.log('\n--- B) COLLISION CHECK (After Repair) ---\n');

  const collisionCheckResult = await clickhouse.query({
    query: `
      SELECT count() AS collided_after_fix
      FROM (
        SELECT transaction_hash, countDistinct(wallet_address_fixed) AS w
        FROM vw_trades_canonical_xcn_repaired
        GROUP BY transaction_hash
        HAVING w > 1
      )
    `,
    format: 'JSONEachRow'
  });
  const collisionCheck = await collisionCheckResult.json() as any[];

  const collidedAfterFix = parseInt(collisionCheck[0]?.collided_after_fix || '0');

  if (collidedAfterFix === 0) {
    console.log('✅ Zero collisions after repair');
    console.log('   All transaction hashes now map to single wallet');
  } else {
    console.log(`⚠️  ${collidedAfterFix} collisions remain after repair`);
    console.log('   Repair logic may need adjustment');
  }

  // C) Repair map statistics
  console.log('\n--- C) REPAIR MAP STATISTICS ---\n');

  const repairStatsResult = await clickhouse.query({
    query: `
      SELECT
        count() AS total_hashes_repaired,
        countDistinct(correct_wallet) AS unique_wallets_assigned
      FROM tmp_xcn_repair_map
    `,
    format: 'JSONEachRow'
  });
  const repairStats = await repairStatsResult.json() as any[];

  console.log(`Hashes Repaired:      ${parseInt(repairStats[0]?.total_hashes_repaired || '0').toLocaleString()}`);
  console.log(`Unique Wallets:       ${parseInt(repairStats[0]?.unique_wallets_assigned || '0')}`);

  // D) Sample repair map entries
  console.log('\n--- D) SAMPLE REPAIR MAP ENTRIES ---\n');

  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        transaction_hash,
        correct_wallet
      FROM tmp_xcn_repair_map
      ORDER BY transaction_hash
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json() as any[];

  console.log('Transaction Hash                                                   Correct Wallet');
  console.log('─'.repeat(100));
  for (const row of samples) {
    console.log(`${row.transaction_hash}  ${row.correct_wallet}`);
  }

  // E) Trade count comparison
  console.log('\n--- E) TRADE COUNT COMPARISON (Real Wallet) ---\n');

  const beforeRepairResult = await clickhouse.query({
    query: `
      SELECT count() AS trades
      FROM vw_xcn_trades_clean
    `,
    format: 'JSONEachRow'
  });
  const beforeRepair = await beforeRepairResult.json() as any[];

  const afterRepairResult = await clickhouse.query({
    query: `
      SELECT count() AS trades
      FROM vw_xcn_repaired_only
    `,
    format: 'JSONEachRow'
  });
  const afterRepair = await afterRepairResult.json() as any[];

  const beforeCount = parseInt(beforeRepair[0]?.trades || '0');
  const afterCount = parseInt(afterRepair[0]?.trades || '0');
  const delta = afterCount - beforeCount;

  console.log(`Before Repair (collision-free):  ${beforeCount.toLocaleString()} trades`);
  console.log(`After Repair (attribution-fixed): ${afterCount.toLocaleString()} trades`);
  console.log(`Delta:                            ${delta >= 0 ? '+' : ''}${delta.toLocaleString()} trades`);

  // ========================================================================
  // FINAL SUMMARY
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('REPAIR COMPLETE');
  console.log('═'.repeat(80));
  console.log('\nArtifacts Created:');
  console.log('- tmp_xcn_repair_map (table)');
  console.log('- vw_trades_canonical_xcn_repaired (view)');
  console.log('- vw_xcn_repaired_only (view)');
  console.log('\nNext Steps:');
  console.log('- Use vw_xcn_repaired_only for C3 PnL reruns');
  console.log('- Share /tmp/xcn_hash_collisions.tsv + tmp_xcn_repair_map as audit trail');
  console.log('- Implement ETL guards to prevent future collisions');
  console.log('');
}

main().catch(console.error);
