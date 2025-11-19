import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function comprehensiveDataAudit() {
  console.log('📊 COMPREHENSIVE DATA AUDIT - FINDING ALL TRADE SOURCES');
  console.log('-'.repeat(65));

  // 1. Complete table discovery scan
  console.log('\n🔎 ALL DATABASES IN SYSTEM:');
  const databases = await clickhouse.query({
    query: `
      SELECT name, engine as db_engine,
             sum(total_rows) as total_rows_all_db,
             count() as tables_count
      FROM system.tables
      GROUP BY database, engine
      ORDER BY total_rows_all_db DESC
    `,
    format: 'JSONEachRow'
  });

  const dbData = await databases.json();
  dbData.forEach((db: any) => {
    console.log(`  ${db.name.padEnd(25)} | ${db.total_rows_all_db.toLocaleString().padStart(12)} rows | ${db.tables_count} tables`);
  });

  // 2. Focus on trade-related tables
  console.log('\n🎯 TRADE-RELATED TABLES SCAN:');
  const tradeTables = await clickhouse.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size,
        (substring(calculateKindCount('stored'), from '\d+')) as cols
      FROM system.tables
      WHERE (name LIKE '%fill%' OR
             name LIKE '%trade%' OR
             name LIKE '%clob%' OR
             name LIKE '%polymarket%' OR
             name LIKE '%erc1155%' OR
             name LIKE '%market%')
        AND total_rows > 0
      ORDER BY total_rows DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const tradeData = await tradeTables.json();

  console.log('  Database       | Table Name                     | Engine      | Rows     | Size     ');
  console.log(''.padEnd(105, '-'));
  tradeData.forEach((table: any) => {
    const showCol = table.cols || '?';
    console.log(`  ${table.database.padEnd(14)} | ${table.name.padEnd(30)} | ${table.engine.padEnd(11)} | ${table.total_rows.toLocaleString().padStart(8)} | ${table.size.padStart(8)}`);
  });

  // 3. Check our current source vs potential alternatives
  console.log('\n🔄 OUR CURRENT vs ALTERNATIVE DATA SOURCES:');

  // Current baseline from clob_fills
  console.log('\n**Our Current Data Source Assessment:**');

  const currentTables = [
    'default.clob_fills',
    'cascadian_clean.token_to_cid_bridge',
    'default.market_key_map',
    'sandbox.fills_norm_fixed_v2'
  ];

  for (const tableSpec of currentTables) {
    const [db, table] = tableSpec.split('.');
    const result = await clickhouse.query({
      query: `SELECT count() as cnt, engine, formatReadableSize(total_bytes) as size FROM system.tables WHERE database='${db}' AND name='${table}'`,
      format: 'JSONEachRow'
    });

    const data = await result.json();
    if (data.length > 0) {
      const row = data[0];
      console.log(`  ${tableSpec.padEnd(45)} | ${row.cnt.toLocaleString().padStart(8)} rows`);
    }
  }

  // 4. Detailed scan for P&L-sensitive entities
  console.log('\n💰 P&L-SENSITIVE DATA SOURCES (transactions, transfers, events):');

  const sensitiveTables = await clickhouse.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows,
        CASE
          WHEN name LIKE '%transfer%' THEN 'transfers'
          WHEN name LIKE '%event%' THEN 'events'
          WHEN name LIKE '%log%' THEN 'logs'
          WHEN name LIKE '%transaction%' THEN 'transactions'
          WHEN name LIKE '%price%' THEN 'pricing'
          WHEN name LIKE '%resolution%' THEN 'resolutions'
          WHEN name LIKE '%balance%' THEN 'balances'
          ELSE 'other'
        END as category
      FROM system.tables
      WHERE (name LIKE '%pusdc%' OR
             name LIKE '%transfer%' OR
             name LIKE '%event%' OR
             name LIKE '%log%' OR
             name LIKE '%price%' OR
             name LIKE '%resolution%' OR
             name LIKE '%balance%')
        AND total_rows > 0
      ORDER BY category, total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const categoryData = await sensitiveTables.json();
  let currentCategory = '';

  categoryData.forEach((table: any) => {
    if (table.category !== currentCategory) {
      console.log(`\n  🏷️  ${table.category.toUpperCase()}:`);
      currentCategory = table.category;
    }
    console.log(`    ${table.database}.${table.name.padEnd(45)} | ${table.total_rows.toLocaleString().padStart(12)} rows`);
  }) ;

  // 5. Check ERC data specifically for our wallet
  console.log('\n🔍 ERC DATA FOR TARGET WALLET:');

  const erc20Base = await clickhouse.query({
    query: `
      SELECT
        'erc20_transfers' as type,
        count() as total_rows,
        sum(CASE WHEN lower(from_address) = '${WALLET}' OR lower(to_address) = '${WALLET}' THEN 1 ELSE 0 END) as wallet_rows
      FROM default.erc20_transfers
    `,
    format: 'JSONEachRow'
  });

  const erc20Data = await erc20Base.json();
  console.log(`  ERC-20 Transfers: ${erc20Data[0].total_rows.toLocaleString()} total, ${erc20Data[0].wallet_rows} relevant to wallet`);

  // USDC specifically
  console.log('\n🎯 USDC S-CURVE VALIDATION DATA:');

  const usdcCheck = await clickhouse.query({
    query: `
      WITH wallet_usdc AS (
        SELECT
          CASE
            WHEN lower(to_address) = '${WALLET}'
              THEN toFloat64(value)/1e6
            WHEN lower(from_address) = '${WALLET}'
              THEN -toFloat64(value)/1e6
            ELSE 0
          END as usdc_flow
        FROM default.erc20_transfers
        WHERE (lower(to_address) = '${WALLET}' OR lower(from_address) = '${WALLET}')
          AND (from_address = '0x2791Bca1f2de4661ED88a30C99A7a9449Aa84174'
               OR to_address = '0x2791Bca1f2de4661ED88a30C99A7a9449Aa84174')
      )
      SELECT
        sum(usdc_flow) as net_usdc,
        max(usdc_flow) as max_inflow,
        min(usdc_flow) as max_outflow,
        count(*) as usdc_transfers
      FROM wallet_usdc
    `,
    format: 'JSONEachRow'
  });

  const usdcData = await usdcCheck.json();
  if (usdcData.length > 0 && usdcData[0].net_usdc != null) {
    console.log(`    Wallet USDC net flow: $${usdcData[0].net_usdc.toFixed(2)}`);
    console.log(`    Max inflow: $${usdcData[0].max_inflow.toFixed(2)}`);
    console.log(`    Max outflow: $${Math.abs(usdcData[0].max_outflow).toFixed(2)}`);
    console.log(`    Total USDC transfers: ${usdcData[0].usdc_transfers}`);

    // Compare this to our calculated P&L
    const ourTotal = await clickhouse.query({
      query: `
        SELECT sum(realized_trade_pnl) as our_pnl
        FROM sandbox.realized_pnl_by_market_v2
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    });
    const ourData = await ourTotal.json();
    const our_pnl = ourData[0]?.our_pnl || 0;

    console.log(`    Our calculated P&L: $${our_pnl.toFixed(2)}`);
    console.log(`    SCALE VERIFICATION: USDC net vs P&L ratio = ${(usdcData[0].net_usdc / our_pnl).toFixed(0)}x`);
  }
}

comprehensiveDataAudit().catch(console.error);