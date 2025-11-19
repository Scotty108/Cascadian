#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function comprehensiveAudit() {
  console.log('='.repeat(120));
  console.log('COMPREHENSIVE DATABASE AUDIT - POLYMARKET DATA COVERAGE');
  console.log('='.repeat(120));

  // Part 1: ERC1155 (THE CRITICAL GAP)
  console.log('\n1. ERC1155 TRANSFERS (CRITICAL - SHOULD BE 10M+)');
  console.log('-'.repeat(120));
  try {
    const erc1155 = await client.query({
      query: `
        SELECT 
          count(*) AS row_count,
          min(block_number) AS min_block,
          max(block_number) AS max_block,
          toDateTime(min(block_timestamp)) AS min_time,
          toDateTime(max(block_timestamp)) AS max_time,
          countDistinct(tx_hash) AS unique_txs,
          countDistinct(token_id) AS unique_tokens,
          countDistinct(from) AS unique_from,
          countDistinct(to) AS unique_to
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    const data = await erc1155.json<any[]>();
    console.log('default.erc1155_transfers:', JSON.stringify(data[0], null, 2));
  } catch (e: any) {
    console.log('ERROR:', e.message);
  }

  // Part 2: ERC20 USDC Transfers
  console.log('\n2. ERC20 TRANSFERS (USDC - SHOULD BE COMPLETE ~388M)');
  console.log('-'.repeat(120));
  try {
    const erc20 = await client.query({
      query: `
        SELECT 
          count(*) AS row_count,
          min(block_number) AS min_block,
          max(block_number) AS max_block,
          toDateTime(min(block_timestamp)) AS min_time,
          toDateTime(max(block_timestamp)) AS max_time,
          countDistinct(tx_hash) AS unique_txs,
          countDistinct(from) AS unique_from,
          countDistinct(to) AS unique_to
        FROM default.erc20_transfers_staging
      `,
      format: 'JSONEachRow',
    });
    const data = await erc20.json<any[]>();
    console.log('default.erc20_transfers_staging:', JSON.stringify(data[0], null, 2));
  } catch (e: any) {
    console.log('ERROR:', e.message);
  }

  // Part 3: Trade Tables
  console.log('\n3. TRADE TABLES COMPARISON');
  console.log('-'.repeat(120));
  
  const tradeTables = [
    'default.vw_trades_canonical',
    'default.trades_with_direction',
    'default.fact_trades_clean',
    'cascadian_clean.fact_trades_clean',
    'cascadian_clean.fact_trades_BROKEN_CIDS',
    'cascadian_clean.fact_trades_backup',
  ];

  for (const table of tradeTables) {
    try {
      const result = await client.query({
        query: `
          SELECT 
            '${table}' AS table_name,
            count(*) AS row_count,
            countDistinct(tx_hash) AS unique_txs,
            countDistinct(wallet) AS unique_wallets,
            countDistinct(token_id) AS unique_tokens
          FROM ${table}
        `,
        format: 'JSONEachRow',
      });
      const data = await result.json<any[]>();
      console.log(JSON.stringify(data[0], null, 2));
    } catch (e: any) {
      console.log(`${table}: ERROR - ${e.message}`);
    }
  }

  // Part 4: Condition ID Coverage in Trade Tables
  console.log('\n4. CONDITION_ID COVERAGE IN TRADE TABLES');
  console.log('-'.repeat(120));
  
  const cidTables = [
    'default.fact_trades_clean',
    'cascadian_clean.fact_trades_clean',
    'cascadian_clean.fact_trades_BROKEN_CIDS',
  ];

  for (const table of cidTables) {
    try {
      const result = await client.query({
        query: `
          SELECT 
            '${table}' AS table_name,
            count(*) AS total_trades,
            countIf(condition_id != '') AS trades_with_cid,
            countIf(condition_id = '') AS trades_without_cid,
            round(countIf(condition_id != '') * 100.0 / count(*), 2) AS pct_with_cid
          FROM ${table}
        `,
        format: 'JSONEachRow',
      });
      const data = await result.json<any[]>();
      console.log(JSON.stringify(data[0], null, 2));
    } catch (e: any) {
      console.log(`${table}: ERROR - ${e.message}`);
    }
  }

  // Part 5: Mapping Tables
  console.log('\n5. MAPPING TABLES');
  console.log('-'.repeat(120));
  
  const mappingQueries = [
    {
      name: 'cascadian_clean.token_condition_market_map',
      query: `
        SELECT 
          count(*) AS row_count,
          countDistinct(token_id) AS unique_tokens,
          countDistinct(condition_id) AS unique_conditions,
          countDistinct(market_slug) AS unique_markets
        FROM cascadian_clean.token_condition_market_map
      `,
    },
    {
      name: 'default.condition_market_map',
      query: `
        SELECT 
          count(*) AS row_count,
          countDistinct(token_id) AS unique_tokens,
          countDistinct(condition_id) AS unique_conditions
        FROM default.condition_market_map
      `,
    },
    {
      name: 'default.market_id_mapping',
      query: `
        SELECT 
          count(*) AS row_count,
          countDistinct(market_id) AS unique_market_ids,
          countDistinct(condition_id) AS unique_conditions
        FROM default.market_id_mapping
      `,
    },
  ];

  for (const { name, query } of mappingQueries) {
    try {
      const result = await client.query({ query, format: 'JSONEachRow' });
      const data = await result.json<any[]>();
      console.log(`${name}:`, JSON.stringify(data[0], null, 2));
    } catch (e: any) {
      console.log(`${name}: ERROR - ${e.message}`);
    }
  }

  // Part 6: Resolution Data
  console.log('\n6. RESOLUTION DATA');
  console.log('-'.repeat(120));
  
  const resolutionQueries = [
    {
      name: 'default.market_resolutions_final',
      query: `
        SELECT 
          count(*) AS row_count,
          countDistinct(condition_id) AS unique_conditions,
          countIf(resolved = 1) AS resolved_count,
          countIf(resolved = 0) AS unresolved_count,
          round(countIf(resolved = 1) * 100.0 / count(*), 2) AS pct_resolved
        FROM default.market_resolutions_final
      `,
    },
    {
      name: 'cascadian_clean.resolutions_by_cid',
      query: `
        SELECT 
          count(*) AS row_count,
          countDistinct(condition_id) AS unique_conditions
        FROM cascadian_clean.resolutions_by_cid
      `,
    },
    {
      name: 'default.gamma_resolved',
      query: `
        SELECT 
          count(*) AS row_count,
          countDistinct(condition_id) AS unique_conditions
        FROM default.gamma_resolved
      `,
    },
    {
      name: 'cascadian_clean.resolutions_src_api',
      query: `
        SELECT 
          count(*) AS row_count,
          countDistinct(condition_id) AS unique_conditions
        FROM cascadian_clean.resolutions_src_api
      `,
    },
  ];

  for (const { name, query } of resolutionQueries) {
    try {
      const result = await client.query({ query, format: 'JSONEachRow' });
      const data = await result.json<any[]>();
      console.log(`${name}:`, JSON.stringify(data[0], null, 2));
    } catch (e: any) {
      console.log(`${name}: ERROR - ${e.message}`);
    }
  }

  // Part 7: Test Wallet Analysis
  console.log('\n7. TEST WALLET 0x4ce73141dbfce41e65db3723e31059a730f0abad');
  console.log('-'.repeat(120));
  console.log('Expected from Polymarket UI: 2,816 trades');
  console.log('Actual in database:');
  
  const walletTables = [
    'default.fact_trades_clean',
    'cascadian_clean.fact_trades_clean',
    'default.vw_trades_canonical',
    'default.trades_with_direction',
  ];

  for (const table of walletTables) {
    try {
      const result = await client.query({
        query: `
          SELECT 
            '${table}' AS table_name,
            count(*) AS row_count,
            countDistinct(tx_hash) AS unique_txs
          FROM ${table}
          WHERE lower(wallet) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
        `,
        format: 'JSONEachRow',
      });
      const data = await result.json<any[]>();
      console.log(JSON.stringify(data[0], null, 2));
    } catch (e: any) {
      console.log(`${table}: ERROR - ${e.message}`);
    }
  }

  // Part 8: Empty Tables (CANDIDATES FOR DELETION)
  console.log('\n8. EMPTY TABLES (DELETE CANDIDATES)');
  console.log('-'.repeat(120));
  
  const emptyCheck = await client.query({
    query: `
      SELECT
        database || '.' || name AS full_table_name,
        engine,
        total_rows
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND engine NOT LIKE '%View%'
        AND total_rows = 0
      ORDER BY database, name
    `,
    format: 'JSONEachRow',
  });
  const emptyTables = await emptyCheck.json<any[]>();
  console.log('Empty tables:', emptyTables.length);
  emptyTables.forEach(t => console.log(`  - ${t.full_table_name} (${t.engine})`));

  // Part 9: Backup/Duplicate Tables
  console.log('\n9. BACKUP/DUPLICATE TABLES (DELETE CANDIDATES)');
  console.log('-'.repeat(120));
  
  const backupCheck = await client.query({
    query: `
      SELECT
        database || '.' || name AS full_table_name,
        engine,
        formatReadableSize(total_bytes) AS size,
        total_rows
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND (
          name LIKE '%backup%' OR
          name LIKE '%_old%' OR
          name LIKE '%_v1%' OR
          name LIKE '%_v2%' OR
          name LIKE '%BROKEN%'
        )
      ORDER BY database, total_bytes DESC
    `,
    format: 'JSONEachRow',
  });
  const backupTables = await backupCheck.json<any[]>();
  console.log('Backup/old tables:', backupTables.length);
  backupTables.forEach(t => console.log(`  - ${t.full_table_name} (${t.size}, ${t.total_rows} rows)`));

  console.log('\n' + '='.repeat(120));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(120));
  
  await client.close();
}

comprehensiveAudit().catch(console.error);
