#!/usr/bin/env npx tsx
/**
 * Rebuild pm_token_to_condition_map_v5 from pm_market_metadata
 *
 * SAFE: Uses atomic rebuild pattern (CREATE NEW → RENAME)
 *
 * This unrolls the token_ids array from metadata to create:
 *   token_id_dec → condition_id + outcome_index
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('='.repeat(80));
  console.log('REBUILD pm_token_to_condition_map_v5');
  console.log('='.repeat(80));

  // Step 1: Check source data
  const metaQ = await clickhouse.query({
    query: `
      SELECT
        count() as total_markets,
        countIf(length(token_ids) > 0) as markets_with_tokens,
        sum(length(token_ids)) as total_tokens
      FROM pm_market_metadata FINAL
    `,
    format: 'JSONEachRow',
  });
  const metaRows = (await metaQ.json()) as any[];
  console.log('\nSource pm_market_metadata:');
  console.log(JSON.stringify(metaRows[0], null, 2));

  const expectedTokens = parseInt(metaRows[0]?.total_tokens || '0');
  if (expectedTokens < 100000) {
    console.error('\n❌ ERROR: Too few tokens in metadata. Aborting to prevent data loss.');
    console.error(`   Expected 400k+, found ${expectedTokens}`);
    process.exit(1);
  }

  // Step 2: Check current V5 state
  const v5Q = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
    format: 'JSONEachRow',
  });
  const v5Rows = (await v5Q.json()) as any[];
  const currentV5 = parseInt(v5Rows[0]?.cnt || '0');
  console.log(`\nCurrent V5: ${currentV5.toLocaleString()} tokens`);
  console.log(`Expected new: ${expectedTokens.toLocaleString()} tokens`);

  // Step 3: Create new table with fresh data (atomic pattern)
  console.log('\nCreating pm_token_to_condition_map_v5_new...');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_new' });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_token_to_condition_map_v5_new
      ENGINE = ReplacingMergeTree()
      ORDER BY (token_id_dec)
      SETTINGS index_granularity = 8192
      AS
      SELECT
        token_id_dec,
        condition_id,
        outcome_index,
        question,
        category
      FROM (
        SELECT
          arrayJoin(arrayEnumerate(token_ids)) AS idx,
          token_ids[idx] AS token_id_dec,
          condition_id,
          toInt64(idx - 1) AS outcome_index,
          question,
          category
        FROM pm_market_metadata FINAL
        WHERE length(token_ids) > 0
      )
    `,
  });

  // Step 4: Verify new table
  const newQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5_new',
    format: 'JSONEachRow',
  });
  const newRows = (await newQ.json()) as any[];
  const newCount = parseInt(newRows[0]?.cnt || '0');
  console.log(`New table has ${newCount.toLocaleString()} tokens`);

  if (newCount < currentV5 * 0.9) {
    console.error('\n❌ ERROR: New table has significantly fewer tokens. Aborting.');
    console.error('   Not renaming to prevent data loss. New table left as _new.');
    process.exit(1);
  }

  // Step 5: Atomic swap
  console.log('\nPerforming atomic swap...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_old' });
  await clickhouse.command({ query: 'RENAME TABLE pm_token_to_condition_map_v5 TO pm_token_to_condition_map_v5_old' });
  await clickhouse.command({ query: 'RENAME TABLE pm_token_to_condition_map_v5_new TO pm_token_to_condition_map_v5' });

  console.log('Swap complete!');

  // Step 6: Cleanup old table
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_old' });
  console.log('Cleaned up old table.');

  // Step 7: Final verification
  const finalQ = await clickhouse.query({
    query: `
      SELECT
        count() as total_tokens,
        uniqExact(condition_id) as unique_conditions
      FROM pm_token_to_condition_map_v5
    `,
    format: 'JSONEachRow',
  });
  const finalRows = (await finalQ.json()) as any[];
  console.log('\n✅ Final V5 state:');
  console.log(JSON.stringify(finalRows[0], null, 2));

  // Step 8: Coverage check for recent trades
  console.log('\nChecking coverage for last 14 days of trades...');
  const coverageQ = await clickhouse.query({
    query: `
      WITH recent_tokens AS (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
      )
      SELECT
        count() as total_recent_tokens,
        countIf(m.token_id_dec IS NOT NULL) as mapped,
        countIf(m.token_id_dec IS NULL) as unmapped,
        round(100.0 * countIf(m.token_id_dec IS NOT NULL) / count(*), 1) as coverage_pct
      FROM recent_tokens r
      LEFT JOIN pm_token_to_condition_map_v5 m ON r.token_id = m.token_id_dec
    `,
    format: 'JSONEachRow',
  });
  const coverageRows = (await coverageQ.json()) as any[];
  console.log(JSON.stringify(coverageRows[0], null, 2));

  console.log('\n✅ Rebuild complete!');
}

main().catch(console.error);
