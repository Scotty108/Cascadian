#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== TIMESTAMP REPAIR INVESTIGATION ===\n');
  
  // 1. Check trades_raw schema for time-related fields
  console.log('--- Step 1: Checking trades_raw schema ---\n');
  
  const schemaResult = await clickhouse.query({
    query: `SELECT * FROM default.trades_raw LIMIT 1`,
    format: 'JSONEachRow'
  });
  const sample = await schemaResult.json<Array<any>>();
  
  if (sample.length > 0) {
    const columns = Object.keys(sample[0]);
    const timeColumns = columns.filter(c => 
      c.toLowerCase().includes('time') || 
      c.toLowerCase().includes('date') || 
      c.toLowerCase().includes('block') ||
      c.toLowerCase().includes('timestamp')
    );
    
    console.log('All columns:', columns.join(', '));
    console.log('\nTime-related columns:', timeColumns.join(', '));
    console.log('\nSample values:');
    timeColumns.forEach(col => {
      console.log(`  ${col}: ${sample[0][col]}`);
    });
    console.log();
  }
  
  // 2. Check if we have block information
  console.log('--- Step 2: Checking for block data ---\n');
  
  const blockCheckResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(block_number IS NOT NULL AND block_number != 0) as has_block_number,
        min(block_number) as min_block,
        max(block_number) as max_block
      FROM default.trades_raw
    `,
    format: 'JSONEachRow'
  });
  const blockData = await blockCheckResult.json<Array<any>>();
  
  console.log(`Block number coverage:`);
  console.log(`  Total rows: ${parseInt(blockData[0].total_rows).toLocaleString()}`);
  console.log(`  Has block_number: ${parseInt(blockData[0].has_block_number).toLocaleString()} (${((blockData[0].has_block_number/blockData[0].total_rows)*100).toFixed(2)}%)`);
  console.log(`  Block range: ${blockData[0].min_block} to ${blockData[0].max_block}\n`);
  
  // 3. Check if we have transaction hash
  console.log('--- Step 3: Checking transaction data ---\n');
  
  const txHashResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(tx_hash != '' AND tx_hash IS NOT NULL) as has_tx_hash,
        count(DISTINCT tx_hash) as unique_tx_hashes
      FROM default.trades_raw
      WHERE tx_hash != ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const txData = await txHashResult.json<Array<any>>();
  
  console.log(`Transaction hash coverage:`);
  console.log(`  Has tx_hash: ${parseInt(txData[0].has_tx_hash || 0).toLocaleString()}`);
  console.log(`  Unique hashes: ${parseInt(txData[0].unique_tx_hashes || 0).toLocaleString()}\n`);
  
  // 4. Check if there's an ERC1155 or blockchain events table with timestamps
  console.log('--- Step 4: Checking for blockchain event tables ---\n');
  
  const tablesResult = await clickhouse.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND (
          name LIKE '%erc1155%'
          OR name LIKE '%transfer%'
          OR name LIKE '%event%'
          OR name LIKE '%block%'
        )
      ORDER BY total_rows DESC NULLS LAST
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json<Array<any>>();
  
  console.log('Potential timestamp source tables:\n');
  tables.forEach(t => {
    console.log(`  ${t.database}.${t.name}`);
    console.log(`    Engine: ${t.engine}`);
    console.log(`    Rows: ${(t.total_rows || 0).toLocaleString()}\n`);
  });
  
  // 5. Check one of these tables for timestamp fields
  if (tables.length > 0) {
    const sampleTable = tables[0];
    console.log(`--- Step 5: Sampling ${sampleTable.database}.${sampleTable.name} ---\n`);
    
    try {
      const sampleEventResult = await clickhouse.query({
        query: `SELECT * FROM ${sampleTable.database}.${sampleTable.name} LIMIT 1`,
        format: 'JSONEachRow'
      });
      const eventSample = await sampleEventResult.json<Array<any>>();
      
      if (eventSample.length > 0) {
        const eventColumns = Object.keys(eventSample[0]);
        const eventTimeColumns = eventColumns.filter(c => 
          c.toLowerCase().includes('time') || 
          c.toLowerCase().includes('date') || 
          c.toLowerCase().includes('block')
        );
        
        console.log('Time-related columns:', eventTimeColumns.join(', '));
        console.log('\nSample values:');
        eventTimeColumns.forEach(col => {
          console.log(`  ${col}: ${eventSample[0][col]}`);
        });
        console.log();
      }
    } catch (e: any) {
      console.log(`Error sampling table: ${e.message}\n`);
    }
  }
  
  // 6. Recommend repair strategy
  console.log('--- Step 6: Repair Strategy Recommendation ---\n');
  
  const hasBlockNumbers = blockData[0].has_block_number > 0;
  const hasTxHashes = (txData[0].has_tx_hash || 0) > 0;
  const hasEventTables = tables.length > 0;
  
  if (hasBlockNumbers) {
    console.log('✅ Recommended: Use block_number to fetch block timestamps from blockchain');
    console.log('   Approach: Join with block metadata or fetch via RPC\n');
  } else if (hasTxHashes && hasEventTables) {
    console.log('✅ Recommended: Join with ERC1155 events table using tx_hash');
    console.log('   Approach: Match trades_raw.tx_hash with events table block_timestamp\n');
  } else {
    console.log('❌ Challenge: Limited timestamp recovery options');
    console.log('   May need to re-fetch from Polymarket API or blockchain\n');
  }
  
  console.log('Options:');
  console.log('1. If block_number exists: Fetch block timestamps from Polygon RPC');
  console.log('2. If tx_hash exists: Join with blockchain events table');
  console.log('3. If neither: Re-import from source (Polymarket CLOB API or blockchain)\n');
}

main().catch(console.error);
