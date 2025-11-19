import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const CORRECT_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const WRONG_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function checkERC20TransfersStaging() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 INVESTIGATING erc20_transfers_staging');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  try {
    // Step 1: Get schema
    console.log('STEP 1: Getting erc20_transfers_staging schema...\n');

    const schemaQuery = `DESCRIBE TABLE erc20_transfers_staging`;
    const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schema = await schemaResult.json<{ name: string; type: string }[]>();

    console.log('Column Name                | Type');
    console.log('---------------------------|------------------------------------------');
    schema.forEach(col => {
      console.log(`${col.name.padEnd(26)} | ${col.type}`);
    });
    console.log('');

    // Step 2: Sample rows
    console.log('STEP 2: Sampling 5 rows to understand structure...\n');

    const sampleQuery = `SELECT * FROM erc20_transfers_staging LIMIT 5`;
    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleResult.json<any[]>();

    sampleData.forEach((row, i) => {
      console.log(`Row ${i + 1}:`);
      console.log(JSON.stringify(row, null, 2));
      console.log('');
    });

    // Step 3: Check for our wallets
    console.log('STEP 3: Checking for our wallets in erc20_transfers_staging...\n');

    // First, identify wallet-related columns
    const walletColumns = schema.filter(col =>
      col.name.toLowerCase().includes('from') ||
      col.name.toLowerCase().includes('to') ||
      col.name.toLowerCase().includes('address') ||
      col.name.toLowerCase().includes('wallet') ||
      col.name.toLowerCase().includes('sender') ||
      col.name.toLowerCase().includes('receiver')
    );

    console.log('Potential wallet columns:', walletColumns.map(c => c.name).join(', '));
    console.log('');

    // Check the 'data' field structure if it exists
    const hasDataField = schema.some(col => col.name === 'data');
    const hasTopicsField = schema.some(col => col.name === 'topics');

    if (hasDataField || hasTopicsField) {
      console.log('Table has raw event data (data/topics fields)');
      console.log('ERC20 Transfer event signature: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef\n');

      // Decode topics to find from/to addresses
      console.log('STEP 4: Searching for our wallets in topics array...\n');

      // ERC20 Transfer event has:
      // topics[0] = event signature
      // topics[1] = from address (padded to 32 bytes)
      // topics[2] = to address (padded to 32 bytes)

      // Search for wallet A (correct)
      const walletAHex = CORRECT_WALLET.toLowerCase().slice(2); // Remove 0x
      const walletAPadded = walletAHex.padStart(64, '0'); // Pad to 32 bytes

      const walletAQuery = `
        SELECT
          count() AS transfers,
          min(block_number) AS first_block,
          max(block_number) AS last_block
        FROM erc20_transfers_staging
        WHERE (
          topics[2] = '0x${walletAPadded}'
          OR topics[3] = '0x${walletAPadded}'
          OR lower(hex(unhex(substring(topics[2], 27, 20)))) = '${walletAHex}'
          OR lower(hex(unhex(substring(topics[3], 27, 20)))) = '${walletAHex}'
        )
      `;

      console.log('Searching for correct wallet (0xcce2...)...');
      try {
        const walletAResult = await clickhouse.query({ query: walletAQuery, format: 'JSONEachRow' });
        const walletAData = await walletAResult.json<any[]>();
        if (walletAData.length > 0 && Number(walletAData[0].transfers) > 0) {
          console.log(`  ✅ FOUND: ${Number(walletAData[0].transfers).toLocaleString()} transfers`);
          console.log(`  First block: ${walletAData[0].first_block}`);
          console.log(`  Last block: ${walletAData[0].last_block}\n`);
        } else {
          console.log(`  ✓ Not found (0 transfers)\n`);
        }
      } catch (error: any) {
        console.log(`  ⚠️  Query failed: ${error.message}\n`);
      }

      // Search for wallet B (wrong)
      const walletBHex = WRONG_WALLET.toLowerCase().slice(2);
      const walletBPadded = walletBHex.padStart(64, '0');

      const walletBQuery = `
        SELECT
          count() AS transfers,
          min(block_number) AS first_block,
          max(block_number) AS last_block
        FROM erc20_transfers_staging
        WHERE (
          topics[2] = '0x${walletBPadded}'
          OR topics[3] = '0x${walletBPadded}'
          OR lower(hex(unhex(substring(topics[2], 27, 20)))) = '${walletBHex}'
          OR lower(hex(unhex(substring(topics[3], 27, 20)))) = '${walletBHex}'
        )
      `;

      console.log('Searching for wrong wallet (0x4bfb...)...');
      try {
        const walletBResult = await clickhouse.query({ query: walletBQuery, format: 'JSONEachRow' });
        const walletBData = await walletBResult.json<any[]>();
        if (walletBData.length > 0 && Number(walletBData[0].transfers) > 0) {
          console.log(`  ✅ FOUND: ${Number(walletBData[0].transfers).toLocaleString()} transfers`);
          console.log(`  First block: ${walletBData[0].first_block}`);
          console.log(`  Last block: ${walletBData[0].last_block}\n`);
        } else {
          console.log(`  ✓ Not found (0 transfers)\n`);
        }
      } catch (error: any) {
        console.log(`  ⚠️  Query failed: ${error.message}\n`);
      }
    }

    // Step 5: Check if there's a decoded version
    console.log('STEP 5: Checking erc20_transfers_decoded table...\n');

    const decodedExistsQuery = `SELECT count() AS row_count FROM erc20_transfers_decoded LIMIT 1`;
    try {
      const decodedExistsResult = await clickhouse.query({ query: decodedExistsQuery, format: 'JSONEachRow' });
      const decodedExistsData = await decodedExistsResult.json<{ row_count: string }[]>();

      console.log(`erc20_transfers_decoded has ${Number(decodedExistsData[0].row_count).toLocaleString()} rows\n`);

      // Get schema
      const decodedSchemaQuery = `DESCRIBE TABLE erc20_transfers_decoded`;
      const decodedSchemaResult = await clickhouse.query({ query: decodedSchemaQuery, format: 'JSONEachRow' });
      const decodedSchema = await decodedSchemaResult.json<{ name: string; type: string }[]>();

      console.log('erc20_transfers_decoded schema:');
      console.log('Column Name                | Type');
      console.log('---------------------------|------------------------------------------');
      decodedSchema.forEach(col => {
        console.log(`${col.name.padEnd(26)} | ${col.type}`);
      });
      console.log('');

      // Check for our wallets in decoded table
      const decodedWalletCols = decodedSchema.filter(col =>
        col.name.toLowerCase().includes('from') ||
        col.name.toLowerCase().includes('to')
      );

      if (decodedWalletCols.length > 0) {
        console.log('Checking decoded table for our wallets...\n');

        for (const col of decodedWalletCols) {
          console.log(`Checking column: ${col.name}`);

          const checkQuery = `
            SELECT
              count() AS transfers
            FROM erc20_transfers_decoded
            WHERE lower(${col.name}) IN ('${CORRECT_WALLET.toLowerCase()}', '${WRONG_WALLET.toLowerCase()}')
          `;

          try {
            const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
            const checkData = await checkResult.json<{ transfers: string }[]>();
            const transferCount = Number(checkData[0].transfers);

            if (transferCount > 0) {
              console.log(`  ✅ Found ${transferCount.toLocaleString()} transfers\n`);

              // Get breakdown by wallet
              const breakdownQuery = `
                SELECT
                  lower(${col.name}) AS wallet,
                  count() AS transfers
                FROM erc20_transfers_decoded
                WHERE lower(${col.name}) IN ('${CORRECT_WALLET.toLowerCase()}', '${WRONG_WALLET.toLowerCase()}')
                GROUP BY wallet
              `;

              const breakdownResult = await clickhouse.query({ query: breakdownQuery, format: 'JSONEachRow' });
              const breakdownData = await breakdownResult.json<any[]>();

              breakdownData.forEach(row => {
                const marker = row.wallet === CORRECT_WALLET.toLowerCase() ? ' ✅' :
                              row.wallet === WRONG_WALLET.toLowerCase() ? ' ❌' : '';
                console.log(`    ${row.wallet}: ${Number(row.transfers).toLocaleString()} transfers${marker}`);
              });
              console.log('');
            } else {
              console.log(`  ✓ Not found\n`);
            }
          } catch (error: any) {
            console.log(`  ⚠️  Query failed: ${error.message}\n`);
          }
        }
      }

    } catch (error: any) {
      console.log(`⚠️  erc20_transfers_decoded query failed: ${error.message}\n`);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log('Key Findings:');
    console.log('1. erc20_transfers_staging contains raw blockchain event data');
    console.log('2. Wallet addresses are encoded in topics array (32-byte padded hex)');
    console.log('3. erc20_transfers_decoded may have human-readable addresses\n');

    console.log('Next Steps:');
    console.log('1. If wallets are found: Compare transaction hashes with pm_trades_canonical_v3');
    console.log('2. Trace how ERC20 transfers are mapped to trades');
    console.log('3. Find where wallet attribution gets corrupted in ETL pipeline\n');

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    console.error(error);
  }
}

checkERC20TransfersStaging().catch(console.error);
