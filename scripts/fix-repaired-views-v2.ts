#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const XCN_REAL = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function main() {
  console.log('═'.repeat(80));
  console.log('FIX REPAIRED VIEWS V2 - CORRECT COALESCE LOGIC');
  console.log('═'.repeat(80));
  console.log('');

  // ========================================================================
  // FIX: Use if() instead of coalesce() for safer fallback
  // ========================================================================

  console.log('Creating fixed vw_trades_canonical_xcn_repaired...');
  
  const repairViewQuery = `
    CREATE OR REPLACE VIEW vw_trades_canonical_xcn_repaired AS
    SELECT
      t.*,
      rm.correct_wallet,
      if(rm.correct_wallet != '', rm.correct_wallet, t.wallet_address) AS wallet_address_fixed
    FROM pm_trades_canonical_v3 t
    LEFT JOIN tmp_xcn_repair_map rm ON t.transaction_hash = rm.transaction_hash
  `;

  await clickhouse.command({ query: repairViewQuery });
  console.log('✅ Success');

  // Recreate normed view
  console.log('\nCreating vw_trades_canonical_normed...');
  
  const normedViewQuery = `
    CREATE OR REPLACE VIEW vw_trades_canonical_normed AS
    SELECT
      *,
      replaceRegexpAll(lower(condition_id_norm_v3), '^0x', '') AS cid_norm
    FROM vw_trades_canonical_xcn_repaired
  `;

  await clickhouse.command({ query: normedViewQuery });
  console.log('✅ Success');

  // Recreate XCN-only view
  console.log('\nCreating vw_xcn_repaired_only...');
  
  const xcnViewQuery = `
    CREATE OR REPLACE VIEW vw_xcn_repaired_only AS
    SELECT *
    FROM vw_trades_canonical_normed
    WHERE lower(wallet_address_fixed) = '${XCN_REAL.toLowerCase()}'
  `;

  await clickhouse.command({ query: xcnViewQuery });
  console.log('✅ Success');

  // ========================================================================
  // VALIDATION
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('VALIDATION');
  console.log('═'.repeat(80));

  // Check trade counts
  const [originalResult, repairedResult] = await Promise.all([
    clickhouse.query({
      query: `SELECT count() AS cnt FROM pm_trades_canonical_v3 WHERE lower(wallet_address) = '${XCN_REAL.toLowerCase()}'`,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `SELECT count() AS cnt FROM vw_xcn_repaired_only`,
      format: 'JSONEachRow'
    })
  ]);

  const originalData = await originalResult.json() as any[];
  const repairedData = await repairedResult.json() as any[];

  const originalCount = parseInt(originalData[0]?.cnt || '0');
  const repairedCount = parseInt(repairedData[0]?.cnt || '0');

  console.log(`\nOriginal trades: ${originalCount.toLocaleString()}`);
  console.log(`Repaired trades: ${repairedCount.toLocaleString()}`);
  console.log(`Delta: ${repairedCount - originalCount}`);

  if (originalCount === repairedCount) {
    console.log('✅ PERFECT MATCH');
  } else {
    console.log(`⚠️  Delta: ${((Math.abs(repairedCount - originalCount) / originalCount) * 100).toFixed(2)}%`);
  }

  // Check Xi market
  const xiResult = await clickhouse.query({
    query: `
      SELECT count() AS trades
      FROM vw_xcn_repaired_only
      WHERE cid_norm = '${XI_MARKET_CID}'
    `,
    format: 'JSONEachRow'
  });
  const xiData = await xiResult.json() as any[];
  const xiTrades = parseInt(xiData[0]?.trades || '0');

  console.log(`\nXi market trades: ${xiTrades.toLocaleString()} (expected 1,833)`);
  
  if (xiTrades === 1833) {
    console.log('✅ EXACT MATCH');
  } else if (xiTrades > 1800) {
    console.log(`✅ CLOSE MATCH`);
  } else if (xiTrades > 0) {
    console.log(`⚠️  PARTIAL RECOVERY`);
  } else {
    console.log('❌ NOT FOUND');
  }

  // Check collisions
  const collisionResult = await clickhouse.query({
    query: `
      SELECT count() AS cnt
      FROM (
        SELECT transaction_hash, countDistinct(wallet_address_fixed) AS w
        FROM vw_trades_canonical_xcn_repaired
        GROUP BY transaction_hash
        HAVING w > 1
      )
    `,
    format: 'JSONEachRow'
  });
  const collisionData = await collisionResult.json() as any[];
  const collisions = parseInt(collisionData[0]?.cnt || '0');

  console.log(`\nCollisions: ${collisions} (expected 0)`);
  console.log(collisions === 0 ? '✅ ZERO COLLISIONS' : '⚠️  COLLISIONS DETECTED');

  console.log('');
}

main().catch(console.error);
