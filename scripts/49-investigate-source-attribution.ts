import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const CORRECT_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const WRONG_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_CID_NORM = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
const XI_CID_0X = '0x' + XI_CID_NORM;

async function investigateSourceAttribution() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 SOURCE ATTRIBUTION INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Target: Xi Jinping 2025 market trades');
  console.log(`Condition ID: ${XI_CID_0X}\n`);
  console.log(`Correct wallet: ${CORRECT_WALLET}`);
  console.log(`Wrong wallet:   ${WRONG_WALLET}\n`);

  try {
    // Step 1: Check CLOB fills source
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('STEP 1: Checking CLOB fills source tables');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    // Find CLOB fills tables
    const tablesQuery = `
      SELECT name
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%clob%fill%' OR name LIKE '%fill%')
        AND engine NOT LIKE '%View%'
      ORDER BY name
    `;

    const tablesResult = await clickhouse.query({ query: tablesQuery, format: 'JSONEachRow' });
    const tables = await tablesResult.json<{ name: string }[]>();

    console.log(`Found ${tables.length} fill tables:\n`);
    tables.forEach((t, i) => console.log(`${(i+1).toString().padStart(2)}. ${t.name}`));
    console.log('');

    // Check each CLOB table for Xi market
    for (const table of tables) {
      console.log(`Checking ${table.name}...`);

      // First, get schema
      const schemaQuery = `DESCRIBE TABLE ${table.name}`;
      let schemaResult;
      try {
        schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      } catch (error: any) {
        console.log(`  ⚠️  Cannot access: ${error.message}\n`);
        continue;
      }

      const schema = await schemaResult.json<{ name: string; type: string }[]>();
      const hasConditionId = schema.some(col =>
        col.name.toLowerCase().includes('condition') && col.name.toLowerCase().includes('id')
      );
      const walletColumns = schema.filter(col =>
        col.name.toLowerCase().includes('wallet') ||
        col.name.toLowerCase().includes('maker') ||
        col.name.toLowerCase().includes('taker') ||
        col.name.toLowerCase().includes('user')
      );

      if (!hasConditionId) {
        console.log(`  ⏭️  No condition_id column, skipping\n`);
        continue;
      }

      console.log(`  Wallet-like columns: ${walletColumns.map(c => c.name).join(', ')}`);

      // Search for Xi market in this table
      const conditionCol = schema.find(col =>
        col.name.toLowerCase().includes('condition') && col.name.toLowerCase().includes('id')
      )?.name || 'condition_id';

      const searchQuery = `
        SELECT count() AS trades
        FROM ${table.name}
        WHERE lower(${conditionCol}) IN ('${XI_CID_NORM}', '${XI_CID_0X}')
      `;

      try {
        const searchResult = await clickhouse.query({ query: searchQuery, format: 'JSONEachRow' });
        const searchData = await searchResult.json<{ trades: string }[]>();
        const tradeCount = Number(searchData[0].trades);

        if (tradeCount === 0) {
          console.log(`  ✓ No Xi trades\n`);
          continue;
        }

        console.log(`  ✅ FOUND ${tradeCount} Xi trades!`);

        // Check wallet attribution
        if (walletColumns.length > 0) {
          for (const walletCol of walletColumns) {
            const walletQuery = `
              SELECT
                lower(${walletCol.name}) AS wallet,
                count() AS trades
              FROM ${table.name}
              WHERE lower(${conditionCol}) IN ('${XI_CID_NORM}', '${XI_CID_0X}')
              GROUP BY wallet
              ORDER BY trades DESC
              LIMIT 10
            `;

            const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
            const walletData = await walletResult.json<{ wallet: string; trades: string }[]>();

            console.log(`\n  Column: ${walletCol.name}`);
            console.log('  Wallet                                       | Trades');
            console.log('  ---------------------------------------------|--------');
            walletData.forEach(row => {
              const marker = row.wallet === CORRECT_WALLET.toLowerCase() ? ' ✅' :
                            row.wallet === WRONG_WALLET.toLowerCase() ? ' ❌' : '';
              console.log(`  ${row.wallet} | ${Number(row.trades).toLocaleString().padStart(6)}${marker}`);
            });
          }
        }
        console.log('');
      } catch (error: any) {
        console.log(`  ⚠️  Query failed: ${error.message}\n`);
      }
    }

    // Step 2: Check ERC1155 transfer tables
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('STEP 2: Checking ERC1155 transfer tables');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const erc1155Query = `
      SELECT name
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%erc1155%' OR name LIKE '%transfer%')
        AND engine NOT LIKE '%View%'
      ORDER BY name
    `;

    const erc1155Result = await clickhouse.query({ query: erc1155Query, format: 'JSONEachRow' });
    const erc1155Tables = await erc1155Result.json<{ name: string }[]>();

    console.log(`Found ${erc1155Tables.length} ERC1155/transfer tables:\n`);
    erc1155Tables.forEach((t, i) => console.log(`${(i+1).toString().padStart(2)}. ${t.name}`));
    console.log('');

    // Check each ERC1155 table
    for (const table of erc1155Tables) {
      console.log(`Checking ${table.name}...`);

      const schemaQuery = `DESCRIBE TABLE ${table.name}`;
      let schemaResult;
      try {
        schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      } catch (error: any) {
        console.log(`  ⚠️  Cannot access: ${error.message}\n`);
        continue;
      }

      const schema = await schemaResult.json<{ name: string; type: string }[]>();

      // Look for token_id or condition-related columns
      const hasTokenId = schema.some(col => col.name.toLowerCase().includes('token'));
      const walletColumns = schema.filter(col =>
        col.name.toLowerCase().includes('from') ||
        col.name.toLowerCase().includes('to') ||
        col.name.toLowerCase().includes('wallet') ||
        col.name.toLowerCase().includes('address')
      );

      if (!hasTokenId) {
        console.log(`  ⏭️  No token_id column, skipping\n`);
        continue;
      }

      console.log(`  Address-like columns: ${walletColumns.map(c => c.name).join(', ')}`);

      // Sample a few rows to see structure
      const sampleQuery = `SELECT * FROM ${table.name} LIMIT 1`;
      try {
        const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
        const sampleData = await sampleResult.json<any[]>();
        if (sampleData.length > 0) {
          console.log(`  Sample columns: ${Object.keys(sampleData[0]).join(', ')}`);
        }
      } catch (error: any) {
        console.log(`  ⚠️  Sample failed: ${error.message}`);
      }
      console.log('');
    }

    // Step 3: Check for wallet identity mapping tables
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('STEP 3: Checking for wallet identity mapping tables');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const mappingQuery = `
      SELECT name
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%wallet%' OR name LIKE '%identity%' OR name LIKE '%mapping%' OR name LIKE '%proxy%')
        AND engine NOT LIKE '%View%'
      ORDER BY name
    `;

    const mappingResult = await clickhouse.query({ query: mappingQuery, format: 'JSONEachRow' });
    const mappingTables = await mappingResult.json<{ name: string }[]>();

    console.log(`Found ${mappingTables.length} potential mapping tables:\n`);
    mappingTables.forEach((t, i) => console.log(`${(i+1).toString().padStart(2)}. ${t.name}`));
    console.log('');

    // Check if our wallets are in any mapping tables
    for (const table of mappingTables) {
      console.log(`Checking ${table.name}...`);

      const schemaQuery = `DESCRIBE TABLE ${table.name}`;
      let schemaResult;
      try {
        schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
      } catch (error: any) {
        console.log(`  ⚠️  Cannot access: ${error.message}\n`);
        continue;
      }

      const schema = await schemaResult.json<{ name: string; type: string }[]>();
      console.log(`  Columns: ${schema.map(c => c.name).join(', ')}`);

      // Search for our wallets
      const walletCol = schema.find(col =>
        col.name.toLowerCase().includes('wallet') ||
        col.name.toLowerCase().includes('address')
      )?.name;

      if (walletCol) {
        const searchQuery = `
          SELECT *
          FROM ${table.name}
          WHERE lower(${walletCol}) IN ('${CORRECT_WALLET.toLowerCase()}', '${WRONG_WALLET.toLowerCase()}')
        `;

        try {
          const searchResult = await clickhouse.query({ query: searchQuery, format: 'JSONEachRow' });
          const searchData = await searchResult.json<any[]>();

          if (searchData.length > 0) {
            console.log(`  ✅ FOUND ${searchData.length} rows with our wallets!`);
            searchData.forEach(row => {
              console.log(`  ${JSON.stringify(row, null, 2)}`);
            });
          } else {
            console.log(`  ✓ No matches`);
          }
        } catch (error: any) {
          console.log(`  ⚠️  Search failed: ${error.message}`);
        }
      }
      console.log('');
    }

    // Step 4: Check pm_trades_canonical_v3 source
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('STEP 4: Investigating pm_trades_canonical_v3 creation logic');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const viewDefQuery = `SHOW CREATE TABLE pm_trades_canonical_v3`;
    try {
      const viewDefResult = await clickhouse.query({ query: viewDefQuery, format: 'TabSeparated' });
      const viewDef = await viewDefResult.text();
      console.log('View definition:\n');
      console.log(viewDef);
      console.log('');
    } catch (error: any) {
      console.log(`⚠️  Cannot get view definition: ${error.message}\n`);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log('Next: Analyze findings to determine:');
    console.log('1. Which source table(s) contain Xi market trades');
    console.log('2. What wallet addresses they show');
    console.log('3. Whether mapping tables are swapping addresses');
    console.log('4. How pm_trades_canonical_v3 derives wallet_address\n');

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    console.error(error);
  }
}

investigateSourceAttribution().catch(console.error);
