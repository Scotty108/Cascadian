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

async function audit() {
  console.log('='.repeat(140));
  console.log('COMPREHENSIVE DATABASE AUDIT - POLYMARKET DATA COVERAGE');
  console.log('='.repeat(140));

  // 1. ERC1155 TRANSFERS - THE CRITICAL GAP
  console.log('\n1. ERC1155 TRANSFERS (CRITICAL GAP - Expected: 10M+, Actual: ???)');
  console.log('-'.repeat(140));
  const erc1155 = await client.query({
    query: `
      SELECT 
        count(*) AS total_transfers,
        min(block_number) AS min_block,
        max(block_number) AS max_block,
        min(block_timestamp) AS earliest_transfer,
        max(block_timestamp) AS latest_transfer,
        countDistinct(tx_hash) AS unique_txs,
        countDistinct(token_id) AS unique_tokens,
        countDistinct(from_address) AS unique_senders,
        countDistinct(to_address) AS unique_receivers
      FROM default.erc1155_transfers
    `,
    format: 'JSONEachRow',
  });
  const erc1155Data = await erc1155.json<any>();
  console.log(JSON.stringify(erc1155Data[0], null, 2));

  // 2. ERC20 TRANSFERS (USDC)
  console.log('\n2. ERC20 TRANSFERS (USDC - Expected: ~388M)');
  console.log('-'.repeat(140));
  const erc20 = await client.query({
    query: `
      SELECT 
        count(*) AS total_transfers,
        min(block_number) AS min_block,
        max(block_number) AS max_block,
        countDistinct(tx_hash) AS unique_txs
      FROM default.erc20_transfers_staging
    `,
    format: 'JSONEachRow',
  });
  const erc20Data = await erc20.json<any>();
  console.log(JSON.stringify(erc20Data[0], null, 2));

  // 3. TRADE TABLES COMPARISON
  console.log('\n3. TRADE TABLES COMPARISON');
  console.log('-'.repeat(140));
  console.log('Table'.padEnd(50) + 'Rows'.padEnd(15) + 'Unique TXs'.padEnd(15) + 'Unique Wallets');
  console.log('-'.repeat(140));
  
  // vw_trades_canonical
  const canonical = await client.query({
    query: `SELECT count(*) as cnt, countDistinct(transaction_hash) as txs, countDistinct(wallet_address_norm) as wallets FROM default.vw_trades_canonical`,
    format: 'JSONEachRow',
  });
  const canonicalData = await canonical.json<any>();
  console.log('default.vw_trades_canonical'.padEnd(50) + 
    canonicalData[0].cnt.padEnd(15) + 
    canonicalData[0].txs.padEnd(15) + 
    canonicalData[0].wallets);

  // trades_with_direction
  const twd = await client.query({
    query: `SELECT count(*) as cnt, countDistinct(tx_hash) as txs FROM default.trades_with_direction`,
    format: 'JSONEachRow',
  });
  const twdData = await twd.json<any>();
  console.log('default.trades_with_direction'.padEnd(50) + twdData[0].cnt.padEnd(15) + twdData[0].txs.padEnd(15) + 'N/A');

  // fact_trades_clean (default)
  const ftc1 = await client.query({
    query: `SELECT count(*) as cnt, countDistinct(tx_hash) as txs, countDistinct(wallet_address) as wallets FROM default.fact_trades_clean`,
    format: 'JSONEachRow',
  });
  const ftc1Data = await ftc1.json<any>();
  console.log('default.fact_trades_clean'.padEnd(50) + ftc1Data[0].cnt.padEnd(15) + ftc1Data[0].txs.padEnd(15) + ftc1Data[0].wallets);

  // fact_trades_clean (cascadian)
  const ftc2 = await client.query({
    query: `SELECT count(*) as cnt, countDistinct(tx_hash) as txs, countDistinct(wallet_address) as wallets FROM cascadian_clean.fact_trades_clean`,
    format: 'JSONEachRow',
  });
  const ftc2Data = await ftc2.json<any>();
  console.log('cascadian_clean.fact_trades_clean'.padEnd(50) + ftc2Data[0].cnt.padEnd(15) + ftc2Data[0].txs.padEnd(15) + ftc2Data[0].wallets);

  // 4. CONDITION ID COVERAGE
  console.log('\n4. CONDITION_ID COVERAGE IN TRADE TABLES');
  console.log('-'.repeat(140));
  console.log('Table'.padEnd(50) + 'Total Trades'.padEnd(15) + 'With CID'.padEnd(15) + 'Without CID'.padEnd(15) + '% Coverage');
  console.log('-'.repeat(140));

  // default.fact_trades_clean
  const ftcCid1 = await client.query({
    query: `
      SELECT 
        count(*) as total,
        countIf(cid != '') as with_cid,
        countIf(cid = '') as without_cid,
        round(countIf(cid != '') * 100.0 / count(*), 2) as pct
      FROM default.fact_trades_clean
    `,
    format: 'JSONEachRow',
  });
  const ftcCid1Data = await ftcCid1.json<any>();
  console.log('default.fact_trades_clean'.padEnd(50) + 
    ftcCid1Data[0].total.padEnd(15) + 
    ftcCid1Data[0].with_cid.padEnd(15) + 
    ftcCid1Data[0].without_cid.padEnd(15) + 
    ftcCid1Data[0].pct + '%');

  // cascadian_clean.fact_trades_clean
  const ftcCid2 = await client.query({
    query: `
      SELECT 
        count(*) as total,
        countIf(cid_hex != '') as with_cid,
        countIf(cid_hex = '') as without_cid,
        round(countIf(cid_hex != '') * 100.0 / count(*), 2) as pct
      FROM cascadian_clean.fact_trades_clean
    `,
    format: 'JSONEachRow',
  });
  const ftcCid2Data = await ftcCid2.json<any>();
  console.log('cascadian_clean.fact_trades_clean'.padEnd(50) + 
    ftcCid2Data[0].total.padEnd(15) + 
    ftcCid2Data[0].with_cid.padEnd(15) + 
    ftcCid2Data[0].without_cid.padEnd(15) + 
    ftcCid2Data[0].pct + '%');

  // vw_trades_canonical
  const canonicalCid = await client.query({
    query: `
      SELECT 
        count(*) as total,
        countIf(condition_id_norm != '') as with_cid,
        countIf(condition_id_norm = '') as without_cid,
        round(countIf(condition_id_norm != '') * 100.0 / count(*), 2) as pct
      FROM default.vw_trades_canonical
    `,
    format: 'JSONEachRow',
  });
  const canonicalCidData = await canonicalCid.json<any>();
  console.log('default.vw_trades_canonical'.padEnd(50) + 
    canonicalCidData[0].total.padEnd(15) + 
    canonicalCidData[0].with_cid.padEnd(15) + 
    canonicalCidData[0].without_cid.padEnd(15) + 
    canonicalCidData[0].pct + '%');

  // 5. MAPPING TABLES
  console.log('\n5. MAPPING TABLES');
  console.log('-'.repeat(140));

  const mappings = [
    {
      name: 'cascadian_clean.token_condition_market_map',
      query: 'SELECT count(*) as cnt FROM cascadian_clean.token_condition_market_map',
    },
    {
      name: 'default.condition_market_map',
      query: 'SELECT count(*) as cnt FROM default.condition_market_map',
    },
    {
      name: 'default.market_id_mapping',
      query: 'SELECT count(*) as cnt FROM default.market_id_mapping',
    },
    {
      name: 'default.erc1155_condition_map',
      query: 'SELECT count(*) as cnt FROM default.erc1155_condition_map',
    },
    {
      name: 'default.legacy_token_condition_map',
      query: 'SELECT count(*) as cnt FROM default.legacy_token_condition_map',
    },
  ];

  for (const m of mappings) {
    try {
      const result = await client.query({ query: m.query, format: 'JSONEachRow' });
      const data = await result.json<any>();
      console.log(`${m.name}: ${data[0].cnt} rows`);
    } catch (e: any) {
      console.log(`${m.name}: ERROR - ${e.message}`);
    }
  }

  // 6. RESOLUTION DATA
  console.log('\n6. RESOLUTION DATA');
  console.log('-'.repeat(140));

  const resolutions = [
    'default.market_resolutions_final',
    'default.gamma_resolved',
    'cascadian_clean.resolutions_by_cid',
    'cascadian_clean.resolutions_src_api',
    'default.resolutions_external_ingest',
    'default.staging_resolutions_union',
  ];

  for (const table of resolutions) {
    try {
      const result = await client.query({
        query: `SELECT count(*) as cnt FROM ${table}`,
        format: 'JSONEachRow',
      });
      const data = await result.json<any>();
      console.log(`${table}: ${data[0].cnt} rows`);
    } catch (e: any) {
      console.log(`${table}: ERROR - ${e.message}`);
    }
  }

  // 7. TEST WALLET
  console.log('\n7. TEST WALLET 0x4ce73141dbfce41e65db3723e31059a730f0abad');
  console.log('-'.repeat(140));
  console.log('Expected from Polymarket UI: 2,816 trades');
  console.log('Actual in database:');

  const walletQueries = [
    { table: 'default.fact_trades_clean', col: 'wallet_address' },
    { table: 'cascadian_clean.fact_trades_clean', col: 'wallet_address' },
    { table: 'default.vw_trades_canonical', col: 'wallet_address_norm' },
  ];

  for (const q of walletQueries) {
    const result = await client.query({
      query: `SELECT count(*) as cnt FROM ${q.table} WHERE lower(${q.col}) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'`,
      format: 'JSONEachRow',
    });
    const data = await result.json<any>();
    console.log(`  ${q.table}: ${data[0].cnt} trades`);
  }

  // 8. EMPTY TABLES
  console.log('\n8. EMPTY TABLES (DELETE CANDIDATES)');
  console.log('-'.repeat(140));
  const empty = await client.query({
    query: `
      SELECT database || '.' || name as full_name
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND engine NOT LIKE '%View%'
        AND total_rows = 0
      ORDER BY database, name
    `,
    format: 'JSONEachRow',
  });
  const emptyData = await empty.json<any>();
  emptyData.forEach((t: any) => console.log(`  - ${t.full_name}`));

  // 9. BACKUP/DUPLICATE TABLES
  console.log('\n9. BACKUP/DUPLICATE/OLD TABLES (DELETE CANDIDATES)');
  console.log('-'.repeat(140));
  const backups = await client.query({
    query: `
      SELECT 
        database || '.' || name as full_name,
        formatReadableSize(total_bytes) as size,
        total_rows
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND (
          name LIKE '%backup%' OR
          name LIKE '%_old%' OR
          name LIKE '%_v2%' OR
          name LIKE '%BROKEN%'
        )
      ORDER BY total_bytes DESC
    `,
    format: 'JSONEachRow',
  });
  const backupData = await backups.json<any>();
  backupData.forEach((t: any) => console.log(`  - ${t.full_name} (${t.size}, ${t.total_rows} rows)`));

  // 10. WALLET AND MARKET DIMENSIONS
  console.log('\n10. DIMENSION TABLES (MARKETS, WALLETS, EVENTS)');
  console.log('-'.repeat(140));
  const dims = [
    'default.markets_dim',
    'default.wallets_dim',
    'default.events_dim',
    'default.wallet_metrics',
    'default.gamma_markets',
    'default.api_markets_staging',
  ];

  for (const table of dims) {
    const result = await client.query({
      query: `SELECT count(*) as cnt FROM ${table}`,
      format: 'JSONEachRow',
    });
    const data = await result.json<any>();
    console.log(`${table}: ${data[0].cnt} rows`);
  }

  // 11. PNL AND POSITION TABLES
  console.log('\n11. PNL AND POSITION TABLES');
  console.log('-'.repeat(140));
  const pnl = [
    'default.realized_pnl_by_market_final',
    'default.wallet_pnl_summary_final',
    'cascadian_clean.position_lifecycle',
    'default.outcome_positions_v2',
  ];

  for (const table of pnl) {
    try {
      const result = await client.query({
        query: `SELECT count(*) as cnt FROM ${table}`,
        format: 'JSONEachRow',
      });
      const data = await result.json<any>();
      console.log(`${table}: ${data[0].cnt} rows`);
    } catch (e: any) {
      console.log(`${table}: ERROR - ${e.message}`);
    }
  }

  // 12. VIEWS COUNT
  console.log('\n12. VIEWS (44 total in cascadian_clean, need to assess which to keep)');
  console.log('-'.repeat(140));
  const views = await client.query({
    query: `
      SELECT database, count(*) as view_count
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND engine = 'View'
      GROUP BY database
    `,
    format: 'JSONEachRow',
  });
  const viewData = await views.json<any>();
  viewData.forEach((v: any) => console.log(`${v.database}: ${v.view_count} views`));

  console.log('\n' + '='.repeat(140));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(140));
  
  await client.close();
}

audit().catch(console.error);
