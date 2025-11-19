#!/usr/bin/env tsx
/**
 * Find Real ERC-1155 Hex Token Bridge
 *
 * Search for tables that bridge 64-char hex ERC-1155 tokens to condition_ids
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔍 Searching for Real ERC-1155 Hex Token Bridge');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Find all tables with token_id or similar columns
  console.log('Step 1: Finding tables with token-related columns...');
  console.log('');

  const tablesQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT table
      FROM system.columns
      WHERE database = currentDatabase()
        AND (
          name LIKE '%token%'
          OR name LIKE '%condition%'
          OR name LIKE '%asset%'
        )
      ORDER BY table
    `,
    format: 'JSONEachRow'
  });
  const tables = await tablesQuery.json<{table: string}>();
  console.log(`Found ${tables.length} tables with token/condition/asset columns`);
  console.log('');

  // Step 2: For each table, check if it has 64-char hex token_ids
  console.log('Step 2: Checking for 64-char hex token IDs...');
  console.log('');

  const candidates: Array<{
    table: string;
    column: string;
    hex64_count: number;
    total_count: number;
    sample: string;
  }> = [];

  for (const {table} of tables) {
    // Get columns for this table
    const colsQuery = await clickhouse.query({
      query: `
        SELECT name
        FROM system.columns
        WHERE database = currentDatabase()
          AND table = '${table}'
          AND (
            name LIKE '%token%'
            OR name = 'id'
            OR name = 'asset_id'
          )
      `,
      format: 'JSONEachRow'
    });
    const cols = await colsQuery.json<{name: string}>();

    for (const {name: colName} of cols) {
      try {
        // Check if this column has 64-char hex values
        const checkQuery = await clickhouse.query({
          query: `
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN length(lower(replaceAll(${colName}, '0x', ''))) = 64 THEN 1 ELSE 0 END) as hex64_count,
              any(${colName}) as sample
            FROM ${table}
            WHERE ${colName} != ''
              AND ${colName} != '0x0'
            LIMIT 1
          `,
          format: 'JSONEachRow'
        });
        const result = await checkQuery.json<{
          total: string;
          hex64_count: string;
          sample: string;
        }>();

        const hex64Count = parseInt(result[0].hex64_count);
        const totalCount = parseInt(result[0].total);

        if (hex64Count > 0) {
          candidates.push({
            table,
            column: colName,
            hex64_count: hex64Count,
            total_count: totalCount,
            sample: result[0].sample
          });
        }
      } catch (err) {
        // Skip tables/columns that error
        continue;
      }
    }
  }

  console.log('Tables with 64-char hex token IDs:');
  console.table(candidates.map(c => ({
    table: c.table,
    column: c.column,
    hex64_count: c.hex64_count.toLocaleString(),
    total_count: c.total_count.toLocaleString(),
    pct: ((c.hex64_count / c.total_count) * 100).toFixed(2) + '%',
    sample: c.sample.substring(0, 20) + '...'
  })));
  console.log('');

  // Step 3: For promising candidates, check if they also have condition_id
  console.log('Step 3: Checking for condition_id columns in candidates...');
  console.log('');

  const bridgeCandidates: Array<{
    table: string;
    token_column: string;
    has_condition_id: boolean;
    sample_token: string;
    sample_condition?: string;
  }> = [];

  for (const candidate of candidates.filter(c => c.hex64_count > 1000)) {
    // Check if table has condition_id column
    const hasConditionQuery = await clickhouse.query({
      query: `
        SELECT name
        FROM system.columns
        WHERE database = currentDatabase()
          AND table = '${candidate.table}'
          AND (
            name LIKE '%condition%'
            OR name = 'market_id'
            OR name = 'market_slug'
          )
      `,
      format: 'JSONEachRow'
    });
    const condCols = await hasConditionQuery.json<{name: string}>();

    if (condCols.length > 0) {
      // Get sample
      const sampleQuery = await clickhouse.query({
        query: `
          SELECT
            ${candidate.column} as token,
            ${condCols[0].name} as condition
          FROM ${candidate.table}
          WHERE length(lower(replaceAll(${candidate.column}, '0x', ''))) = 64
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });
      const sample = await sampleQuery.json<{token: string; condition: string}>();

      if (sample.length > 0) {
        bridgeCandidates.push({
          table: candidate.table,
          token_column: candidate.column,
          has_condition_id: true,
          sample_token: sample[0].token,
          sample_condition: sample[0].condition
        });
      }
    }
  }

  if (bridgeCandidates.length > 0) {
    console.log('✅ POTENTIAL BRIDGES FOUND:');
    console.table(bridgeCandidates.map(b => ({
      table: b.table,
      token_col: b.token_column,
      token_sample: b.sample_token?.substring(0, 20) + '...',
      condition_sample: b.sample_condition?.substring(0, 20) + '...'
    })));
  } else {
    console.log('❌ NO BRIDGE TABLES FOUND with both hex64 tokens and condition_id');
  }
  console.log('');

  // Step 4: Sample erc1155_transfers to see what we're trying to map
  console.log('Step 4: Sample ERC-1155 transfer tokens to map...');
  console.log('');

  const transferSampleQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        lower(replaceAll(token_id, '0x', '')) as token_norm,
        COUNT(*) as transfer_count
      FROM erc1155_transfers
      WHERE length(lower(replaceAll(token_id, '0x', ''))) = 64
      GROUP BY token_norm
      ORDER BY transfer_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const transferSample = await transferSampleQuery.json<{
    token_norm: string;
    transfer_count: string;
  }>();

  console.log('Top 10 ERC-1155 tokens by transfer count:');
  console.table(transferSample.map(t => ({
    token_id: t.token_norm.substring(0, 16) + '...',
    transfers: parseInt(t.transfer_count).toLocaleString()
  })));
  console.log('');

  // Final recommendation
  console.log('='.repeat(60));
  console.log('📋 RECOMMENDATION');
  console.log('='.repeat(60));
  console.log('');

  if (bridgeCandidates.length > 0) {
    console.log('✅ Found potential bridge tables with hex tokens + condition_id.');
    console.log('   Next steps:');
    console.log('   1. Validate bridge quality (join success rate)');
    console.log('   2. Build pm_erc1155_token_map v2 using these sources');
    console.log('   3. Test coverage against erc1155_transfers');
  } else {
    console.log('❌ No ready-made bridge found.');
    console.log('   Options:');
    console.log('   1. Build bridge from transfer + settlement patterns');
    console.log('   2. Reverse-engineer token → condition encoding');
    console.log('   3. Use decimal asset bridge (rename to pm_asset_id_map)');
  }
  console.log('');
  console.log('✅ Search complete!');
}

main().catch((error) => {
  console.error('❌ Search failed:', error);
  process.exit(1);
});
