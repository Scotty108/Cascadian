/**
 * STEP 1-6: Complete database search for resolved condition data
 * Find where wallets 2-4 resolution data actually lives
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

const wallets = [
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
];

async function main() {
  console.log('='.repeat(80));
  console.log('STEP 1: INVENTORY ALL TABLES');
  console.log('='.repeat(80));

  const tablesResult = await client.query({
    query: `
      SELECT
        name as table_name,
        engine,
        total_rows
      FROM system.tables
      WHERE database = 'polymarket'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const tables = await tablesResult.json<any>();
  console.log('\n📊 ALL TABLES IN DATABASE:');
  console.log(JSON.stringify(tables, null, 2));

  // Filter for resolution-related tables
  const resolutionTables = tables.filter((t: any) =>
    t.table_name.match(/market|condition|resolution|outcome|settlement|payout|trade/i)
  );

  console.log('\n🎯 RESOLUTION-RELATED TABLES:');
  console.log(JSON.stringify(resolutionTables, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('STEP 2: SAMPLE CONDITION IDs FROM WALLETS 2-4');
  console.log('='.repeat(80));

  const walletsStr = wallets.map(w => `'${w}'`).join(',');

  const conditionsResult = await client.query({
    query: `
      SELECT DISTINCT
        condition_id,
        substring(condition_id, 1, 30) as format_sample,
        length(condition_id) as id_length,
        position(condition_id, '0x') as has_prefix
      FROM trades_raw
      WHERE wallet_address IN (${walletsStr})
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });

  const sampleConditions = await conditionsResult.json<any>();
  console.log('\n🔍 SAMPLE CONDITION IDs:');
  console.log(JSON.stringify(sampleConditions, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('STEP 3: CROSS-TABLE SEARCH FOR CONDITION IDs');
  console.log('='.repeat(80));

  // Get a few sample condition IDs to search for
  const testConditions = sampleConditions.slice(0, 3).map((c: any) => c.condition_id);

  for (const table of resolutionTables) {
    const tableName = table.table_name;

    try {
      // Get schema first
      const schemaResult = await client.query({
        query: `DESCRIBE TABLE ${tableName}`,
        format: 'JSONEachRow'
      });
      const schema = await schemaResult.json<any>();

      console.log(`\n📋 TABLE: ${tableName}`);
      console.log('Schema:', JSON.stringify(schema, null, 2));

      // Look for condition-like columns
      const conditionCols = schema.filter((col: any) =>
        col.name.match(/condition|market|token/i)
      );

      if (conditionCols.length > 0) {
        console.log('Condition-like columns:', conditionCols.map((c: any) => c.name));

        // Try to search for our test conditions
        for (const condCol of conditionCols) {
          const colName = condCol.name;

          // Try different normalization formats
          const formats = [
            `${colName}`, // raw
            `lower(${colName})`, // lowercase
            `replaceAll(lower(${colName}), '0x', '')`, // normalized
          ];

          for (const format of formats) {
            for (const testCond of testConditions) {
              try {
                const searchResult = await client.query({
                  query: `
                    SELECT COUNT(*) as match_count
                    FROM ${tableName}
                    WHERE ${format} = '${testCond}'
                       OR ${format} = lower('${testCond}')
                       OR ${format} = replaceAll(lower('${testCond}'), '0x', '')
                    LIMIT 1
                  `,
                  format: 'JSONEachRow'
                });

                const matches = await searchResult.json<any>();
                const count = matches[0]?.match_count || 0;

                if (count > 0) {
                  console.log(`✅ MATCH FOUND in ${tableName}.${colName} with format ${format}`);
                  console.log(`   Test condition: ${testCond} → ${count} matches`);
                }
              } catch (err: any) {
                // Skip if query fails
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.log(`⚠️ Error examining ${tableName}:`, err.message);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('STEP 4: FORMAT ANALYSIS');
  console.log('='.repeat(80));

  console.log('\n📐 trades_raw condition_id format:');
  const tradesFormatResult = await client.query({
    query: `
      SELECT
        condition_id,
        length(condition_id) as len,
        substring(condition_id, 1, 2) as prefix,
        CASE
          WHEN condition_id = lower(condition_id) THEN 'lowercase'
          WHEN condition_id = upper(condition_id) THEN 'uppercase'
          ELSE 'mixed'
        END as case_type
      FROM trades_raw
      WHERE wallet_address = '${wallets[0]}'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await tradesFormatResult.json(), null, 2));

  console.log('\n📐 market_resolutions_final condition_id_norm format:');
  const mrfFormatResult = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as len,
        substring(condition_id_norm, 1, 2) as prefix,
        CASE
          WHEN condition_id_norm = lower(condition_id_norm) THEN 'lowercase'
          WHEN condition_id_norm = upper(condition_id_norm) THEN 'uppercase'
          ELSE 'mixed'
        END as case_type
      FROM market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await mrfFormatResult.json(), null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('STEP 5: SEARCH ALL RESOLUTION-LIKE DATA');
  console.log('='.repeat(80));

  // Check each table for resolution-related columns
  for (const table of tables) {
    const tableName = table.table_name;

    try {
      const schemaResult = await client.query({
        query: `DESCRIBE TABLE ${tableName}`,
        format: 'JSONEachRow'
      });
      const schema = await schemaResult.json<any>();

      const resolutionCols = schema.filter((col: any) =>
        col.name.match(/condition|market|resolution|outcome|settlement|winner|payout/i)
      );

      if (resolutionCols.length > 0) {
        console.log(`\n🔍 ${tableName} has resolution columns:`, resolutionCols.map((c: any) => c.name));

        // Sample data from this table
        const sampleResult = await client.query({
          query: `SELECT * FROM ${tableName} LIMIT 3`,
          format: 'JSONEachRow'
        });
        const sampleData = await sampleResult.json();
        console.log('Sample data:', JSON.stringify(sampleData, null, 2));
      }
    } catch (err) {
      // Skip tables we can't read
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('STEP 6: SPECIFIC SEARCH FOR WALLET 2-4 CONDITIONS');
  console.log('='.repeat(80));

  // Get ALL unique conditions from wallets 2-4
  const allConditionsResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM trades_raw
      WHERE wallet_address IN (${walletsStr})
    `,
    format: 'JSONEachRow'
  });

  const allConditions = await allConditionsResult.json<any>();
  console.log(`\n📊 Found ${allConditions.length} unique conditions from wallets 2-4`);

  // Search for these in market_resolutions_final with different formats
  console.log('\n🔍 Searching market_resolutions_final with normalization...');

  const matchResult = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as condition_norm
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
      )
      SELECT
        wc.condition_id,
        wc.condition_norm,
        mrf.condition_id_norm,
        mrf.winning_index,
        mrf.market_slug
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON wc.condition_norm = mrf.condition_id_norm
      WHERE mrf.condition_id_norm IS NOT NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const matches = await matchResult.json<any>();
  console.log(`✅ Found ${matches.length} matches with normalization`);
  console.log(JSON.stringify(matches, null, 2));

  // Check coverage
  const coverageResult = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_norm
        FROM trades_raw
        WHERE wallet_address IN (${walletsStr})
      )
      SELECT
        COUNT(DISTINCT wc.condition_norm) as total_conditions,
        COUNT(DISTINCT mrf.condition_id_norm) as matched_conditions,
        round(COUNT(DISTINCT mrf.condition_id_norm) * 100.0 / COUNT(DISTINCT wc.condition_norm), 2) as match_pct
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final mrf
        ON wc.condition_norm = mrf.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const coverage = await coverageResult.json<any>();
  console.log('\n📊 COVERAGE ANALYSIS:');
  console.log(JSON.stringify(coverage, null, 2));

  await client.close();
}

main().catch(console.error);
