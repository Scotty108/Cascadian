import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function showTables() {
  try {
    console.log('=== SHOWING AVAILABLE TABLES ===');

    const result = await clickhouse.query({
      query: 'SHOW TABLES',
      format: 'JSONEachRow'
    });

    const tables = await result.json();
    console.log('Available tables:', tables);

    return tables;
  } catch (error) {
    console.error('Error showing tables:', error);
    return null;
  }
}

async function analyzeTableSchema(tableName: string) {
  try {
    console.log(`\n=== SCHEMA: ${tableName} ===`);

    const result = await clickhouse.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: 'JSONEachRow'
    });

    const schema = await result.json();
    console.log(`${tableName} schema:`, schema);
    return schema;
  } catch (error) {
    console.error(`Error describing ${tableName}:`, error);
    return null;
  }
}

async function getSampleData(tableName: string, limit = 2) {
  try {
    console.log(`\n=== SAMPLE DATA: ${tableName} ===`);

    const result = await clickhouse.query({
      query: `SELECT * FROM ${tableName} LIMIT ${limit}`,
      format: 'JSONEachRow'
    });

    const data = await result.json();
    console.log(`${tableName} sample:`, data);
    return data;
  } catch (error) {
    console.error(`Error sampling ${tableName}:`, error);
    return null;
  }
}

async function analyzeColumnFormats(tableName: string, columnName: string) {
  try {
    console.log(`\n=== FORMAT ANALYSIS: ${tableName}.${columnName} ===`);

    // Check if column exists first
    const result = await clickhouse.query({
      query: `
        SELECT COUNT(DISTINCT ${columnName}) as unique_values
        FROM ${tableName}
        WHERE ${columnName} IS NOT NULL AND ${columnName} != ''
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const countCheck = await result.json();
    const count = countCheck[0]?.unique_values || 0;

    console.log(`${columnName}: ${count} unique values`);

    if (count === 0) {
      console.log('No data to analyze');
      return null;
    }

    // Get format breakdown
    const formatResult = await clickhouse.query({
      query: `
        SELECT
          length(${columnName}) as length,
          count(*) as frequency,
          substr(${columnName}, 1, 8) as sample_start,
          substr(${columnName}, -8) as sample_end
        FROM ${tableName}
        WHERE ${columnName} IS NOT NULL AND ${columnName} != ''
        GROUP BY length
        ORDER BY frequency DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const formats = await formatResult.json();
    console.log(`${columnName} format distribution:`, formats);

    // Get prefix analysis
    const prefixResult = await clickhouse.query({
      query: `
        SELECT
          substr(${columnName}, 1, 2) as prefix,
          count(*) as frequency
        FROM ${tableName}
        WHERE ${columnName} IS NOT NULL AND ${columnName} != ''
        GROUP BY prefix
        ORDER BY frequency DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const prefixes = await prefixResult.json();
    console.log(`${columnName} prefix analysis:`, prefixes);

    return { formats, prefixes };
  } catch (error) {
    console.error(`Error analyzing ${columnName} formats:`, error);
    return null;
  }
}

async function analyzeXcnstrategySpecifically() {
  try {
    console.log('\n=== XCNSTRATEGY SPECIFIC ANALYSIS ===');

    const walletAddress = '0x6b486174c5a8cf5c6917e1b8b2c64b08425f1a80';

    // Get recent xcnstrategy activity
    const recentActivity = await clickhouse.query({
      query: `
        SELECT
          asset_id,
          position_type,
          price,
          size,
          timestamp,
          condition_id
        FROM clob_fills
        WHERE order_owner = '${walletAddress}'
        ORDER BY timestamp DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const activity = await recentActivity.json();
    console.log('Xcnstrategy recent clob_fills activity:', activity);

    // Check asset_id formats for this wallet
    const assetFormats = await clickhouse.query({
      query: `
        SELECT
          asset_id,
          length(asset_id) as len,
          count(*) as freq
        FROM clob_fills
        WHERE order_owner = '${walletAddress}'
        GROUP BY asset_id, len
        ORDER BY freq DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const formats = await assetFormats.json();
    console.log('Xcnstrategy asset_id formats:', formats);

    // Try to join with ctf_token_map and gamma_markets
    const joinTest = await clickhouse.query({
      query: `
        SELECT
          cf.asset_id,
          ctf.token_id,
          gm.condition_id,
          ctf.condition_id as ctf_condition_id
        FROM clob_fills cf
        LEFT JOIN ctf_token_map ctf ON
          lower(replaceAll(cf.asset_id, '0x', '')) = lower(replaceAll(ctf.token_id, '0x', ''))
        LEFT JOIN gamma_markets gm ON
          lower(replaceAll(ctf.condition_id, '0x', '')) = lower(replaceAll(gm.condition_id, '0x', ''))
        WHERE cf.order_owner = '${walletAddress}'
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const joinResults = await joinTest.json();
    console.log('Join test results:', joinResults);

  } catch (error) {
    console.error('Error analyzing xcnstrategy:', error);
  }
}

async function main() {
  try {
    console.log('🚀 Starting ID format normalization analysis...');

    // Get all tables first
    const tables = await showTables();

    if (!tables) {
      console.log('No tables found. Exiting.');
      return;
    }

    // Check which critical tables exist
    const criticalTables = [
      'clob_fills',
      'ctf_token_map',
      'gamma_markets',
      'market_resolutions_final',
      'erc1155_transfers',
      'pm_user_proxy_wallets_v2'
    ];

    const existingTables = tables.filter((table: any) =>
      criticalTables.includes(table.name)
    );

    console.log('Found critical tables:', existingTables);

    // Analyze each table
    for (const table of existingTables) {
      const schema = await analyzeTableSchema(table.name);
      if (schema) {
        // Get ID-related columns
        const idColumns = schema
          .filter((col: any) =>
            col.name.includes('id') ||
            col.name.includes('asset') ||
            col.name.includes('address') ||
            col.name.includes('condition') ||
            col.name.includes('token')
          )
          .map((col: any) => col.name);

        console.log(`ID columns found: ${idColumns.join(', ')}`);

        // Sample data
        await getSampleData(table.name);

        // Analyze formats for ID columns
        for (const column of idColumns) {
          await analyzeColumnFormats(table.name, column);
        }
      }
    }

    // Xcnstrategy specific analysis
    if (existingTables.some((table: any) => table.name === 'clob_fills')) {
      await analyzeXcnstrategySpecifically();
    }

    console.log('\n✅ Analysis complete!');

  } catch (error) {
    console.error('😭 Error in main:', error);
  }
}

main();