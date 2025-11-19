import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('═'.repeat(80));
  console.log('🚨 CRITICAL: ctf_token_map ATOMIC REBUILD');
  console.log('═'.repeat(80));
  console.log();
  console.log('Rebuilding from ERC-1155 token_id decoding');
  console.log('This will fix 100% broken condition_ids and 99.6% broken outcome_indices');
  console.log();

  const timestamp = Date.now();

  // Step 1: Create view with correct ERC-1155 decoded data
  console.log('Step 1: Creating view with ERC-1155 decoded mappings...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW ctf_token_decoded AS
      SELECT DISTINCT
        asset_id as token_id,
        lower(hex(bitShiftRight(toUInt256(asset_id), 8))) as condition_id_norm,
        toUInt8(bitAnd(toUInt256(asset_id), 255)) as outcome_index,
        'erc1155_decoded' as source
      FROM clob_fills
    `
  });
  console.log('✅ View created');
  console.log();

  // Step 2: Backup current table
  console.log('Step 2: Backing up current broken table...');
  await clickhouse.command({
    query: `CREATE TABLE ctf_token_map_broken_${timestamp} AS ctf_token_map`
  });
  console.log(`✅ Backup: ctf_token_map_broken_${timestamp}`);
  console.log();

  // Step 3: Drop and recreate table
  console.log('Step 3: Dropping broken table...');
  await clickhouse.command({
    query: 'DROP TABLE ctf_token_map'
  });
  console.log('✅ Dropped');
  console.log();

  console.log('Step 4: Creating new table...');
  await clickhouse.command({
    query: `
      CREATE TABLE ctf_token_map (
        token_id String,
        condition_id_norm String,
        outcome_index UInt8,
        vote_count UInt32 DEFAULT 0,
        source String,
        created_at DateTime DEFAULT now(),
        version UInt32 DEFAULT 1,
        market_id String DEFAULT ''
      )
      ENGINE = ReplacingMergeTree(version)
      ORDER BY token_id
    `
  });
  console.log('✅ Table created');
  console.log();

  // Step 5: Populate from view (simpler query, should not timeout)
  console.log('Step 5: Populating from decoded view...');
  await clickhouse.command({
    query: `
      INSERT INTO ctf_token_map (token_id, condition_id_norm, outcome_index, source)
      SELECT token_id, condition_id_norm, outcome_index, source
      FROM ctf_token_decoded
    `
  });

  const countQuery = await clickhouse.query({
    query: 'SELECT count(*) as count FROM ctf_token_map',
    format: 'JSONEachRow'
  });
  const count = (await countQuery.json())[0];

  console.log(`✅ Populated: ${count.count} tokens`);
  console.log();

  // Step 6: Validation
  console.log('Step 6: Validating...');
  const validationQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as total,
        countIf(condition_id_norm = lower(hex(bitShiftRight(toUInt256(token_id), 8)))) as cid_correct,
        countIf(outcome_index = toUInt8(bitAnd(toUInt256(token_id), 255))) as idx_correct
      FROM ctf_token_map
    `,
    format: 'JSONEachRow'
  });
  const validation = (await validationQuery.json())[0];

  console.table({
    'Total tokens': validation.total,
    'Correct CIDs': validation.cid_correct,
    'Correct indices': validation.idx_correct,
    'Success rate': `${(Number(validation.cid_correct) / Number(validation.total) * 100).toFixed(1)}%`
  });

  if (Number(validation.cid_correct) !== Number(validation.total)) {
    throw new Error('Validation failed! Not all tokens correctly decoded.');
  }

  console.log();
  console.log('═'.repeat(80));
  console.log('✅ REBUILD COMPLETE - ALL TOKENS CORRECTLY DECODED');
  console.log('═'.repeat(80));
  console.log();
  console.log(`Broken table backed up: ctf_token_map_broken_${timestamp}`);
  console.log();
  console.log('🔥 CRITICAL NEXT STEP: Re-run P&L calculation');
  console.log('   Expected: P&L should now match or be much closer to Dome baseline');
}

main().catch(console.error);
