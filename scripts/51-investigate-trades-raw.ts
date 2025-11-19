import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const CORRECT_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const WRONG_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_CID_0X = '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function investigateTradesRaw() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 INVESTIGATING trades_raw TABLE');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  try {
    // Step 1: Check if trades_raw table exists
    console.log('STEP 1: Checking if trades_raw exists...\n');

    const tablesQuery = `
      SELECT name, engine, total_rows, total_bytes
      FROM system.tables
      WHERE database = currentDatabase()
        AND name LIKE '%trade%'
        AND engine NOT LIKE '%View%'
      ORDER BY name
    `;

    const tablesResult = await clickhouse.query({ query: tablesQuery, format: 'JSONEachRow' });
    const tables = await tablesResult.json<any[]>();

    console.log('Trade-related tables:\n');
    console.log('Table Name                              | Engine            | Rows        | Size (MB)');
    console.log('----------------------------------------|-------------------|-------------|----------');
    tables.forEach(t => {
      const name = String(t.name).padEnd(39);
      const engine = String(t.engine).padEnd(17);
      const rows = Number(t.total_rows).toLocaleString().padStart(11);
      const mb = (Number(t.total_bytes) / 1024 / 1024).toFixed(2).padStart(9);
      console.log(`${name} | ${engine} | ${rows} | ${mb}`);
    });
    console.log('');

    const tradesRawTable = tables.find(t => t.name === 'trades_raw');
    if (!tradesRawTable) {
      console.log('❌ trades_raw table NOT FOUND\n');
      console.log('Checking for similar names:\n');
      const similarTables = tables.filter(t =>
        t.name.includes('trade') &&
        (t.name.includes('raw') || t.name.includes('source') || t.name.includes('base'))
      );
      similarTables.forEach(t => console.log(`  - ${t.name}`));
      console.log('');
      return { success: false, error: 'trades_raw not found' };
    }

    console.log(`✅ Found trades_raw: ${Number(tradesRawTable.total_rows).toLocaleString()} rows\n`);

    // Step 2: Get schema
    console.log('STEP 2: Getting trades_raw schema...\n');

    const schemaQuery = `DESCRIBE TABLE trades_raw`;
    const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schema = await schemaResult.json<{ name: string; type: string; default_expression: string }[]>();

    console.log('Column Name                | Type');
    console.log('---------------------------|------------------------------------------');
    schema.forEach(col => {
      console.log(`${col.name.padEnd(26)} | ${col.type}`);
    });
    console.log('');

    // Step 3: Get table definition
    console.log('STEP 3: Getting trades_raw table definition...\n');

    const defQuery = `SHOW CREATE TABLE trades_raw`;
    const defResult = await clickhouse.query({ query: defQuery, format: 'TabSeparated' });
    const defText = await defResult.text();

    console.log('Table Definition (first 50 lines):\n');
    const defLines = defText.split('\n');
    console.log(defLines.slice(0, Math.min(50, defLines.length)).join('\n'));
    if (defLines.length > 50) {
      console.log(`\n... (${defLines.length - 50} more lines) ...\n`);
    }
    console.log('');

    // Step 4: Check Xi market in trades_raw
    console.log('STEP 4: Checking Xi market in trades_raw...\n');

    const xiCountQuery = `
      SELECT
        count() AS total_trades,
        uniq(wallet_address) AS unique_wallets,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade,
        sum(abs(shares)) AS total_shares,
        sum(abs(usd_value)) AS total_volume
      FROM trades_raw
      WHERE condition_id = '${XI_CID_0X}'
    `;

    const xiCountResult = await clickhouse.query({ query: xiCountQuery, format: 'JSONEachRow' });
    const xiCountData = await xiCountResult.json<any[]>();
    const xiStats = xiCountData[0];

    console.log('Xi Market Statistics in trades_raw:');
    console.log(`  Total trades:    ${Number(xiStats.total_trades).toLocaleString()}`);
    console.log(`  Unique wallets:  ${Number(xiStats.unique_wallets).toLocaleString()}`);
    console.log(`  First trade:     ${xiStats.first_trade}`);
    console.log(`  Last trade:      ${xiStats.last_trade}`);
    console.log(`  Total shares:    ${Number(xiStats.total_shares).toLocaleString()}`);
    console.log(`  Total volume:    $${Number(xiStats.total_volume).toLocaleString()}\n`);

    // Step 5: Top wallets in Xi market
    console.log('STEP 5: Top 20 wallets trading Xi in trades_raw...\n');

    const topWalletsQuery = `
      SELECT
        lower(wallet_address) AS wallet,
        count() AS trades,
        sum(abs(usd_value)) AS volume
      FROM trades_raw
      WHERE condition_id = '${XI_CID_0X}'
      GROUP BY wallet
      ORDER BY trades DESC
      LIMIT 20
    `;

    const topWalletsResult = await clickhouse.query({ query: topWalletsQuery, format: 'JSONEachRow' });
    const topWalletsData = await topWalletsResult.json<any[]>();

    console.log('Rank | Wallet                                       | Trades | Volume');
    console.log('-----|----------------------------------------------|--------|-------------');
    topWalletsData.forEach((row, i) => {
      const marker = row.wallet === CORRECT_WALLET.toLowerCase() ? ' ✅' :
                    row.wallet === WRONG_WALLET.toLowerCase() ? ' ❌' : '';
      const rank = (i + 1).toString().padStart(4);
      console.log(`${rank} | ${row.wallet} | ${Number(row.trades).toLocaleString().padStart(6)} | $${Number(row.volume).toLocaleString().padStart(11)}${marker}`);
    });
    console.log('');

    // Step 6: Sample Xi trades for wrong wallet
    console.log('STEP 6: Sampling Xi trades for WRONG wallet (0x4bfb...)...\n');

    const sampleQuery = `
      SELECT *
      FROM trades_raw
      WHERE condition_id = '${XI_CID_0X}'
        AND lower(wallet_address) = '${WRONG_WALLET.toLowerCase()}'
      ORDER BY timestamp
      LIMIT 5
    `;

    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleResult.json<any[]>();

    if (sampleData.length > 0) {
      console.log(`Found ${sampleData.length} sample trades:\n`);
      sampleData.forEach((trade, i) => {
        console.log(`Trade ${i + 1}:`);
        console.log(JSON.stringify(trade, null, 2));
        console.log('');
      });
    } else {
      console.log('⚠️  No trades found for wrong wallet in trades_raw\n');
    }

    // Step 7: Check for correct wallet
    console.log('STEP 7: Checking for CORRECT wallet (0xcce2...) in trades_raw Xi trades...\n');

    const correctWalletQuery = `
      SELECT count() AS trades
      FROM trades_raw
      WHERE condition_id = '${XI_CID_0X}'
        AND lower(wallet_address) = '${CORRECT_WALLET.toLowerCase()}'
    `;

    const correctWalletResult = await clickhouse.query({ query: correctWalletQuery, format: 'JSONEachRow' });
    const correctWalletData = await correctWalletResult.json<{ trades: string }[]>();
    const correctWalletTrades = Number(correctWalletData[0].trades);

    if (correctWalletTrades === 0) {
      console.log('❌ CORRECT wallet has ZERO Xi trades in trades_raw\n');
      console.log('This confirms the misattribution exists at the trades_raw level.\n');
    } else {
      console.log(`✅ CORRECT wallet has ${correctWalletTrades} Xi trades in trades_raw\n`);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log('Key Findings:');
    console.log(`1. trades_raw contains ${Number(xiStats.total_trades).toLocaleString()} Xi trades from ${Number(xiStats.unique_wallets).toLocaleString()} wallets`);
    console.log(`2. Top wallet by trade count: ${topWalletsData[0]?.wallet || 'N/A'} with ${Number(topWalletsData[0]?.trades || 0).toLocaleString()} trades`);
    console.log(`3. Correct wallet (0xcce2...) has ${correctWalletTrades} Xi trades in trades_raw`);
    console.log(`4. Wrong wallet (0x4bfb...) is ${topWalletsData.findIndex(w => w.wallet === WRONG_WALLET.toLowerCase()) + 1} in ranking\n`);

    console.log('Next Steps:');
    console.log('1. Examine table definition to find data source');
    console.log('2. Check backfill scripts for trades_raw population');
    console.log('3. Compare transaction hashes between API and trades_raw\n');

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    console.error(error);
    return { success: false, error: error.message };
  }
}

investigateTradesRaw().catch(console.error);
