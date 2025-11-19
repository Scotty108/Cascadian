import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function analyzeTableIdFormats(tableName: string) {
  try {
    console.log(`\n=== Analyzing ${tableName} ===`);

    // Get schema
    const { data: schema } = await clickhouse.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: 'JSONEachRow'
    });

    const schemaArray = await schema.json();
    console.log('Schema:', schemaArray);

    // Sample data
    const { data: sample } = await clickhouse.query({
      query: `SELECT * FROM ${tableName} LIMIT 1`,
      format: 'JSONEachRow'
    });

    const sampleArray = await sample.json();
    console.log('Sample:', sampleArray);

    return { schema: schemaArray, sample: sampleArray[0] };

  } catch (error) {
    console.error(`Error analyzing ${tableName}:`, error);
    return null;
  }
}

async function analyzeIdColumnFormats(tableName: string, columnName: string) {
  try {
    console.log(`\n=== Analyzing ${columnName} formats in ${tableName} ===`);

    const query = `
      SELECT
        length(${columnName}) as length,
        startsWith(${columnName}, '0x') as has_prefix,
        substring(${columnName}, 1, 4) as sample_start,
        substring(${columnName}, -4) as sample_end,
        count(*) as frequency
      FROM ${tableName}
      WHERE ${columnName} IS NOT NULL AND ${columnName} != ''
      GROUP BY length, has_prefix, sample_start, sample_end
      ORDER BY frequency DESC
      LIMIT 10
    `;

    const { data } = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    });

    const results = await data.json();
    console.log(`${columnName} format analysis:`, results);

    return results;

  } catch (error) {
    console.error(`Error analyzing ${columnName} formats:`, error);
    return null;
  }
}

async function main() {
  try {
    console.log('Starting ID format analysis...');

    const tables = [
      'clob_fills',
      'ctf_token_map',
      'gamma_markets',
      'market_resolutions_final',
      'erc1155_transfers',
      'pm_user_proxy_wallets_v2'
    ];

    for (const table of tables) {
      await analyzeTableIdFormats(table);
    }

    // Analyze specific ID columns for format variations
    console.log('\n=== FORMAT ANALYSIS ===');

    await analyzeIdColumnFormats('clob_fills', 'asset_id');
    await analyzeIdColumnFormats('clob_fills', 'order_owner');

    await analyzeIdColumnFormats('ctf_token_map', 'token_id');
    await analyzeIdColumnFormats('ctf_token_map', 'condition_id');

    await analyzeIdColumnFormats('gamma_markets', 'condition_id');
    await analyzeIdColumnFormats('gamma_markets', 'token_id');

    await analyzeIdColumnFormats('market_resolutions_final', 'condition_id');

    await analyzeIdColumnFormats('erc1155_transfers', 'token_id');
    await analyzeIdColumnFormats('erc1155_transfers', 'to_address');
    await analyzeIdColumnFormats('erc1155_transfers', 'from_address');

    console.log('\n=== ANALYSIS COMPLETE ===');

  } catch (error) {
    console.error('Error in main:', error);
  }
}

main();