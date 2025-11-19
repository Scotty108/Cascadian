#!/usr/bin/env tsx
/**
 * XCN Transaction Hash Collision Analysis
 *
 * Investigates transaction hash collisions between xcnstrategy wallets
 * and creates clean views excluding collision hashes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_REAL = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_MARKET_CID = '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function executeQuery(query: string, description: string) {
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
  console.log('XCN TRANSACTION HASH COLLISION ANALYSIS');
  console.log('═'.repeat(80));
  console.log(`\nEOA Address:  ${XCN_EOA}`);
  console.log(`Real Wallet:  ${XCN_REAL}`);
  console.log('');

  // ========================================================================
  // TERMINAL 1: Persist collision evidence and clean views
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 1: CREATE COLLISION DETECTION TABLES');
  console.log('═'.repeat(80));

  // 1) Collided tx hashes between the two wallets
  await executeQuery(`
    CREATE OR REPLACE TABLE tmp_xcn_hash_collisions
    ENGINE = MergeTree
    ORDER BY transaction_hash AS
    SELECT transaction_hash
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = '${XCN_EOA.toLowerCase()}'
    INTERSECT
    SELECT transaction_hash
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = '${XCN_REAL.toLowerCase()}'
  `, 'Creating tmp_xcn_hash_collisions');

  // 2) Which wallets share those hashes (hit count)
  await executeQuery(`
    CREATE OR REPLACE TABLE tmp_xcn_collision_wallets
    ENGINE = MergeTree
    ORDER BY (wallet, hits) AS
    SELECT lower(wallet_address) AS wallet, count(*) AS hits
    FROM pm_trades_canonical_v3
    WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_xcn_hash_collisions)
    GROUP BY wallet
    ORDER BY hits DESC
  `, 'Creating tmp_xcn_collision_wallets');

  // 3) Collision-free + non-empty-CID view
  await executeQuery(`
    CREATE OR REPLACE VIEW vw_trades_clean_local AS
    SELECT *
    FROM pm_trades_canonical_v3
    WHERE transaction_hash NOT IN (SELECT transaction_hash FROM tmp_xcn_hash_collisions)
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
  `, 'Creating vw_trades_clean_local (collision-free + non-empty CID)');

  // 4) XCN-only clean view (real wallet)
  await executeQuery(`
    CREATE OR REPLACE VIEW vw_xcn_trades_clean AS
    SELECT *
    FROM vw_trades_clean_local
    WHERE lower(wallet_address) = '${XCN_REAL.toLowerCase()}'
  `, 'Creating vw_xcn_trades_clean (real wallet only)');

  // ========================================================================
  // TERMINAL 2: Validation queries
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 2: VALIDATION QUERIES');
  console.log('═'.repeat(80));

  // A) Collision counts snapshot
  console.log('\n--- A) COLLISION COUNTS ---\n');

  const collisionCountResult = await clickhouse.query({
    query: 'SELECT count() AS collided_hashes FROM tmp_xcn_hash_collisions',
    format: 'JSONEachRow'
  });
  const collisionCount = await collisionCountResult.json() as any[];
  console.log(`Total Collided Hashes: ${collisionCount[0]?.collided_hashes || 0}`);

  const walletHitsResult = await clickhouse.query({
    query: 'SELECT wallet, hits FROM tmp_xcn_collision_wallets ORDER BY hits DESC LIMIT 10',
    format: 'JSONEachRow'
  });
  const walletHits = await walletHitsResult.json() as any[];
  console.log('\nTop Wallets in Collision Set:');
  console.log('Wallet                                       Hits');
  console.log('─'.repeat(50));
  for (const row of walletHits) {
    console.log(`${row.wallet.padEnd(42)} ${row.hits.toString().padStart(6)}`);
  }

  // B) Xi Jinping market check
  console.log('\n--- B) XI JINPING MARKET CHECK (Real Wallet) ---\n');

  const xiMarketResult = await clickhouse.query({
    query: `
      SELECT
        sumIf(usd_value, trade_direction='BUY') AS cost,
        sumIf(usd_value, trade_direction='SELL') AS proceeds,
        sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
        count(*) AS trades
      FROM vw_xcn_trades_clean
      WHERE condition_id_norm_v3 = '${XI_MARKET_CID}'
    `,
    format: 'JSONEachRow'
  });
  const xiMarket = await xiMarketResult.json() as any[];

  if (xiMarket.length > 0 && xiMarket[0].trades > 0) {
    console.log(`✅ Xi Market Found in Clean View`);
    console.log(`   Trades:      ${xiMarket[0].trades}`);
    console.log(`   Cost:        $${parseFloat(xiMarket[0].cost || '0').toFixed(2)}`);
    console.log(`   Proceeds:    $${parseFloat(xiMarket[0].proceeds || '0').toFixed(2)}`);
    console.log(`   Net Shares:  ${parseFloat(xiMarket[0].net_shares || '0').toFixed(2)}`);
  } else {
    console.log('❌ Xi Market NOT found in clean view');
  }

  // C) Empty CID cohort (for quarantine plan)
  console.log('\n--- C) EMPTY CID COHORT (EOA Address) ---\n');

  const emptyCidResult = await clickhouse.query({
    query: `
      SELECT toYYYYMM(timestamp) AS month, count(*) AS trades, sum(usd_value) AS volume
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = '${XCN_EOA.toLowerCase()}'
        AND (condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '')
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow'
  });
  const emptyCid = await emptyCidResult.json() as any[];

  console.log('Month     Trades    Volume (USD)');
  console.log('─'.repeat(40));
  for (const row of emptyCid) {
    const monthStr = row.month.toString();
    const formattedMonth = `${monthStr.substring(0, 4)}-${monthStr.substring(4, 6)}`;
    console.log(`${formattedMonth}      ${row.trades.toString().padStart(6)}    $${parseFloat(row.volume || '0').toFixed(2)}`);
  }

  // ========================================================================
  // TERMINAL 3: Export artifacts and prep guardrails
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 3: EXPORT ARTIFACTS & COVERAGE CHECK');
  console.log('═'.repeat(80));

  // Export collision tables to /tmp
  console.log('\n--- Exporting Collision Tables ---\n');

  const hashExportResult = await clickhouse.query({
    query: 'SELECT * FROM tmp_xcn_hash_collisions',
    format: 'TSV'
  });
  const hashExport = await hashExportResult.text();
  fs.writeFileSync('/tmp/xcn_hash_collisions.tsv', hashExport, 'utf-8');
  console.log('✅ Exported: /tmp/xcn_hash_collisions.tsv');

  const walletExportResult = await clickhouse.query({
    query: 'SELECT wallet, hits FROM tmp_xcn_collision_wallets ORDER BY hits DESC',
    format: 'TSV'
  });
  const walletExport = await walletExportResult.text();
  fs.writeFileSync('/tmp/xcn_collision_wallets.tsv', walletExport, 'utf-8');
  console.log('✅ Exported: /tmp/xcn_collision_wallets.tsv');

  // Quick coverage check on the clean view
  console.log('\n--- Coverage Check (Clean View) ---\n');

  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        count() AS total,
        countIf(condition_id_norm_v3 != '' AND condition_id_norm_v3 IS NOT NULL) AS non_empty,
        round(non_empty * 100.0 / total, 2) AS pct
      FROM vw_trades_clean_local
    `,
    format: 'JSONEachRow'
  });
  const coverage = await coverageResult.json() as any[];

  console.log(`Total Trades:          ${parseInt(coverage[0]?.total || '0').toLocaleString()}`);
  console.log(`Non-Empty CID:         ${parseInt(coverage[0]?.non_empty || '0').toLocaleString()}`);
  console.log(`Coverage:              ${coverage[0]?.pct || '0'}%`);

  // Create quarantine sink table
  console.log('\n--- Creating Quarantine Table ---\n');

  try {
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS pm_trades_attribution_conflicts
      ENGINE = MergeTree
      ORDER BY transaction_hash AS
      SELECT *
      FROM pm_trades_canonical_v3
      WHERE 1 = 0
    `, 'Creating pm_trades_attribution_conflicts (quarantine table)');
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('✅ Quarantine table already exists');
    } else {
      throw error;
    }
  }

  // ========================================================================
  // FINAL SUMMARY
  // ========================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('═'.repeat(80));
  console.log('\nArtifacts Created:');
  console.log('- tmp_xcn_hash_collisions (table)');
  console.log('- tmp_xcn_collision_wallets (table)');
  console.log('- vw_trades_clean_local (view)');
  console.log('- vw_xcn_trades_clean (view)');
  console.log('- pm_trades_attribution_conflicts (quarantine table)');
  console.log('\nExports:');
  console.log('- /tmp/xcn_hash_collisions.tsv');
  console.log('- /tmp/xcn_collision_wallets.tsv');
  console.log('');
}

main().catch(console.error);
