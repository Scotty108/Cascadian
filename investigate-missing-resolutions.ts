/**
 * CRITICAL DATABASE FORENSICS: Find Missing Resolution Data
 *
 * Investigation checklist:
 * 1. Get condition_ids for wallets 2-4
 * 2. Search all tables for these condition_ids
 * 3. Test format normalization
 * 4. Check materialized views
 * 5. Examine market_resolutions_final schema
 * 6. Look for import scripts
 */

import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

const WALLETS = {
  wallet2: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  wallet3: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  wallet4: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
};

async function step1_examineConditionIds() {
  console.log('\n=== STEP 1: EXAMINE CONDITION IDs FOR WALLETS 2-4 ===\n');

  const query = `
    SELECT
      condition_id,
      length(condition_id) as len,
      substring(condition_id, 1, 10) as prefix,
      count(*) as trade_count
    FROM trades_raw
    WHERE wallet_address IN (
      '${WALLETS.wallet2}',
      '${WALLETS.wallet3}',
      '${WALLETS.wallet4}'
    )
    GROUP BY condition_id
    ORDER BY trade_count DESC
    LIMIT 20
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json();

  console.log(`Found ${rows.length} unique condition_ids for wallets 2-4:\n`);
  console.table(rows);

  return rows;
}

async function step2_searchAllTables(sampleConditionId: string) {
  console.log('\n=== STEP 2: SEARCH ALL TABLES FOR CONDITION ID ===\n');
  console.log(`Sample condition_id: ${sampleConditionId}\n`);

  // Get all tables
  const tablesQuery = `SHOW TABLES`;
  const tablesResult = await client.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tables = await tablesResult.json<{ name: string }>();

  console.log(`Searching ${tables.length} tables...\n`);

  const matches: any[] = [];

  for (const table of tables) {
    const tableName = table.name;

    try {
      // Get columns first
      const describeQuery = `DESCRIBE TABLE ${tableName}`;
      const describeResult = await client.query({ query: describeQuery, format: 'JSONEachRow' });
      const columns = await describeResult.json<{ name: string; type: string }>();

      // Find condition_id-like columns
      const conditionColumns = columns.filter(c =>
        c.name.includes('condition') ||
        c.name.includes('market_id') ||
        c.name === 'id'
      );

      if (conditionColumns.length === 0) continue;

      // Build WHERE clause
      const condNoPrefix = sampleConditionId.replace('0x', '');
      const whereConditions = conditionColumns.map(col => {
        return `(${col.name} LIKE '%${condNoPrefix}%' OR ${col.name} LIKE '%${sampleConditionId}%')`;
      }).join(' OR ');

      const searchQuery = `
        SELECT '${tableName}' as table_name, count(*) as match_count
        FROM ${tableName}
        WHERE ${whereConditions}
      `;

      const searchResult = await client.query({ query: searchQuery, format: 'JSONEachRow' });
      const searchRows = await searchResult.json<{ table_name: string; match_count: string }>();

      if (searchRows[0] && parseInt(searchRows[0].match_count) > 0) {
        matches.push({
          table: tableName,
          matches: parseInt(searchRows[0].match_count),
          searched_columns: conditionColumns.map(c => c.name).join(', ')
        });
      }
    } catch (err: any) {
      // Skip tables we can't query
      if (!err.message.includes('UNKNOWN_TABLE')) {
        console.log(`  [SKIP] ${tableName}: ${err.message.substring(0, 60)}...`);
      }
    }
  }

  console.log('\n=== TABLES WITH MATCHING CONDITION IDs ===\n');
  console.table(matches);

  return matches;
}

async function step3_testFormatNormalization(sampleConditionId: string) {
  console.log('\n=== STEP 3: TEST FORMAT NORMALIZATION ===\n');
  console.log(`Testing condition_id: ${sampleConditionId}\n`);

  const condNoPrefix = sampleConditionId.replace('0x', '');

  const tests = [
    {
      name: 'Raw (with 0x)',
      query: `SELECT COUNT(*) as matches FROM market_resolutions_final WHERE condition_id_norm = '${sampleConditionId}'`
    },
    {
      name: 'No 0x prefix',
      query: `SELECT COUNT(*) as matches FROM market_resolutions_final WHERE condition_id_norm = '${condNoPrefix}'`
    },
    {
      name: 'Lowercase with 0x',
      query: `SELECT COUNT(*) as matches FROM market_resolutions_final WHERE lower(condition_id_norm) = lower('${sampleConditionId}')`
    },
    {
      name: 'Lowercase no 0x',
      query: `SELECT COUNT(*) as matches FROM market_resolutions_final WHERE lower(condition_id_norm) = lower('${condNoPrefix}')`
    },
    {
      name: 'Full normalization (IDN)',
      query: `SELECT COUNT(*) as matches FROM market_resolutions_final WHERE condition_id_norm = lower(replaceAll('${sampleConditionId}', '0x', ''))`
    }
  ];

  const results = [];

  for (const test of tests) {
    try {
      const result = await client.query({ query: test.query, format: 'JSONEachRow' });
      const rows = await result.json<{ matches: string }>();
      results.push({
        test: test.name,
        matches: parseInt(rows[0].matches)
      });
    } catch (err: any) {
      results.push({
        test: test.name,
        matches: `ERROR: ${err.message.substring(0, 40)}`
      });
    }
  }

  console.table(results);

  return results;
}

async function step4_checkMaterializedViews() {
  console.log('\n=== STEP 4: CHECK MATERIALIZED VIEWS ===\n');

  const query = `
    SELECT
      name,
      engine,
      total_rows
    FROM system.tables
    WHERE database = currentDatabase()
    AND (engine LIKE '%View%' OR name LIKE '%pnl%' OR name LIKE '%portfolio%')
    ORDER BY name
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json();

  console.table(rows);

  return rows;
}

async function step5_examineMarketResolutionsFinal() {
  console.log('\n=== STEP 5: EXAMINE market_resolutions_final SCHEMA & DATA ===\n');

  // Schema
  const schemaQuery = `DESCRIBE TABLE market_resolutions_final`;
  const schemaResult = await client.query({ query: schemaQuery, format: 'JSONEachRow' });
  const schema = await schemaResult.json();

  console.log('Schema:');
  console.table(schema);

  // Row count
  const countQuery = `SELECT COUNT(*) as total_rows FROM market_resolutions_final`;
  const countResult = await client.query({ query: countQuery, format: 'JSONEachRow' });
  const countRows = await countResult.json<{ total_rows: string }>();

  console.log(`\nTotal rows: ${countRows[0].total_rows}`);

  // Sample data
  const sampleQuery = `
    SELECT
      condition_id_norm,
      length(condition_id_norm) as len,
      winning_index,
      arrayStringConcat(payout_numerators, ',') as payout_nums,
      payout_denominator
    FROM market_resolutions_final
    LIMIT 10
  `;

  const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleRows = await sampleResult.json();

  console.log('\nSample rows:');
  console.table(sampleRows);

  return { schema, totalRows: countRows[0].total_rows, sample: sampleRows };
}

async function step6_checkConditionIdCoverage() {
  console.log('\n=== STEP 6: CONDITION ID COVERAGE ANALYSIS ===\n');

  // Get distinct condition_ids from trades_raw for wallets 2-4
  const tradesQuery = `
    SELECT DISTINCT condition_id
    FROM trades_raw
    WHERE wallet_address IN (
      '${WALLETS.wallet2}',
      '${WALLETS.wallet3}',
      '${WALLETS.wallet4}'
    )
  `;

  const tradesResult = await client.query({ query: tradesQuery, format: 'JSONEachRow' });
  const tradeConditions = await tradesResult.json<{ condition_id: string }>();

  console.log(`Total unique condition_ids in trades_raw for wallets 2-4: ${tradeConditions.length}`);

  // Check how many exist in market_resolutions_final with various normalizations
  let matchesNormalized = 0;

  const testSample = tradeConditions.slice(0, 10); // Test first 10 for speed

  for (const tc of testSample) {
    const condId = tc.condition_id;

    // Try normalized
    const normQuery = `
      SELECT COUNT(*) as matches
      FROM market_resolutions_final
      WHERE condition_id_norm = lower(replaceAll('${condId}', '0x', ''))
    `;

    const normResult = await client.query({ query: normQuery, format: 'JSONEachRow' });
    const normRows = await normResult.json<{ matches: string }>();

    if (parseInt(normRows[0].matches) > 0) {
      matchesNormalized++;
    }
  }

  console.log(`\nOut of first 10 condition_ids:`);
  console.log(`  - Matches with normalization: ${matchesNormalized}/10`);

  return {
    totalConditions: tradeConditions.length,
    sampleSize: 10,
    matchesNormalized
  };
}

async function main() {
  try {
    console.log('\n====================================================');
    console.log('CRITICAL DATABASE FORENSICS: MISSING RESOLUTION DATA');
    console.log('====================================================\n');

    // Step 1: Get condition IDs
    const conditionIds = await step1_examineConditionIds();

    if (conditionIds.length === 0) {
      console.error('\n❌ ERROR: No condition_ids found for wallets 2-4!');
      await client.close();
      return;
    }

    const sampleConditionId = conditionIds[0].condition_id;

    // Step 2: Search all tables
    const matchingTables = await step2_searchAllTables(sampleConditionId);

    // Step 3: Test format normalization
    const normalizationResults = await step3_testFormatNormalization(sampleConditionId);

    // Step 4: Check views
    await step4_checkMaterializedViews();

    // Step 5: Examine market_resolutions_final
    await step5_examineMarketResolutionsFinal();

    // Step 6: Coverage analysis
    await step6_checkConditionIdCoverage();

    console.log('\n\n====================================================');
    console.log('FORENSIC INVESTIGATION COMPLETE');
    console.log('====================================================\n');

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
