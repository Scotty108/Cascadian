#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function analyze() {
  try {
    console.log('=== UNDERSTANDING THE 71x TRADE RATIO ===\n');

    // Overall counts
    console.log('1️⃣ BASIC COUNTS:\n');
    
    const overall = await client.query({
      query: `
        SELECT
          'trades_with_direction' as table_name,
          count() as total_rows,
          count(DISTINCT tx_hash) as unique_txs,
          count(DISTINCT wallet_address) as unique_wallets,
          count(DISTINCT condition_id_norm) as unique_markets,
          count(DISTINCT concat(wallet_address, condition_id_norm)) as unique_wallet_market_combos
        FROM trades_with_direction
      `,
      format: 'JSONEachRow',
    });

    const overallData = await overall.json<any>();
    const row = overallData[0];
    console.log(`trades_with_direction table:`);
    console.log(`  Total rows: ${row.total_rows.toLocaleString()}`);
    console.log(`  Unique txs: ${row.unique_txs.toLocaleString()}`);
    console.log(`  Unique wallets: ${row.unique_wallets.toLocaleString()}`);
    console.log(`  Unique markets: ${row.unique_markets.toLocaleString()}`);
    console.log(`  Unique wallet-market combos: ${row.unique_wallet_market_combos.toLocaleString()}`);
    console.log(`\n  ⚠️ Rows vs unique txs: ${(row.total_rows / row.unique_txs).toFixed(2)}x`);
    console.log(`  ⚠️ Rows vs wallet-market combos: ${(row.total_rows / row.unique_wallet_market_combos).toFixed(2)}x`);

    // Check sources
    console.log('\n2️⃣ TRADES BY DATA SOURCE:\n');
    
    const sources = await client.query({
      query: `
        SELECT 
          data_source,
          count() as count,
          count(DISTINCT tx_hash) as unique_txs,
          count(DISTINCT wallet_address) as unique_wallets,
          count(DISTINCT condition_id_norm) as unique_conditions,
          ROUND(count() / count(DISTINCT tx_hash), 2) as rows_per_tx
        FROM trades_with_direction
        GROUP BY data_source
        ORDER BY count DESC
      `,
      format: 'JSONEachRow',
    });

    const sourceData = await sources.json<any>();
    sourceData.forEach((row: any) => {
      console.log(`${row.data_source}:`);
      console.log(`  Total rows: ${row.count.toLocaleString()}`);
      console.log(`  Unique txs: ${row.unique_txs.toLocaleString()}`);
      console.log(`  Ratio (rows/txs): ${row.rows_per_tx}x`);
    });

    // Check if we're counting both buyer and seller
    console.log('\n3️⃣ ARE WE COUNTING BOTH SIDES OF TRADES?\n');
    
    const bothSides = await client.query({
      query: `
        SELECT
          tx_hash,
          count(*) as entries_per_tx,
          count(DISTINCT wallet_address) as unique_wallets_per_tx,
          count(DISTINCT direction_from_transfers) as directions,
          arrayJoin(groupArray(DISTINCT direction_from_transfers)) as direction
        FROM trades_with_direction
        GROUP BY tx_hash
        HAVING count(*) > 1
        LIMIT 100
      `,
      format: 'JSONEachRow',
    });

    const bothData = await bothSides.json<any>();
    console.log(`Found ${bothData.length} transactions with multiple entries`);
    console.log(`Sample entries:\n`);
    
    // Group by tx_hash for readability
    const txMap: any = {};
    bothData.forEach((row: any) => {
      if (!txMap[row.tx_hash]) {
        txMap[row.tx_hash] = {
          entries: row.entries_per_tx,
          wallets: row.unique_wallets_per_tx,
          directions: []
        };
      }
      txMap[row.tx_hash].directions.push(row.direction);
    });
    
    let count = 0;
    Object.entries(txMap).slice(0, 5).forEach(([tx, data]: any) => {
      console.log(`  ${tx.substring(0,16)}... : ${data.entries} rows, ${data.wallets} wallets, directions: [${data.directions.join(', ')}]`);
    });

    // Check direction distribution
    console.log('\n4️⃣ DIRECTION DISTRIBUTION:\n');
    
    const directions = await client.query({
      query: `
        SELECT 
          direction_from_transfers as direction,
          count() as count,
          count(DISTINCT tx_hash) as unique_txs,
          ROUND(count() / count(DISTINCT tx_hash), 2) as avg_per_tx
        FROM trades_with_direction
        GROUP BY direction_from_transfers
        ORDER BY count DESC
      `,
      format: 'JSONEachRow',
    });

    const dirData = await directions.json<any>();
    dirData.forEach((row: any) => {
      console.log(`${row.direction}: ${row.count.toLocaleString()} rows (${row.unique_txs.toLocaleString()} unique txs, ${row.avg_per_tx}x per tx)`);
    });

  } catch (error: any) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

analyze().catch(console.error);
