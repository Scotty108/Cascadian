#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== INVESTIGATING TOKEN_* ENTRIES ===\n');
  
  // 1. Get statistics
  console.log('--- Step 1: Statistics ---\n');
  
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_token_entries,
        count(DISTINCT condition_id) as unique_token_ids,
        sum(toFloat64(abs(cashflow_usdc))) as total_volume_usd,
        min(block_time) as earliest,
        max(block_time) as latest
      FROM default.trades_raw
      WHERE condition_id LIKE 'token_%'
    `,
    format: 'JSONEachRow'
  });
  const stats = await statsResult.json<Array<any>>();
  
  console.log(`Token_* Entry Statistics:`);
  console.log(`  Total trades:   ${parseInt(stats[0].total_token_entries).toLocaleString()}`);
  console.log(`  Unique tokens:  ${parseInt(stats[0].unique_token_ids).toLocaleString()}`);
  console.log(`  Total volume:   $${parseFloat(stats[0].total_volume_usd).toLocaleString()}`);
  console.log(`  Date range:     ${stats[0].earliest} to ${stats[0].latest}\n`);
  
  // 2. Sample token IDs
  console.log('--- Step 2: Sample Token IDs ---\n');
  
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        count() as trade_count,
        sum(toFloat64(abs(cashflow_usdc))) as volume_usd
      FROM default.trades_raw
      WHERE condition_id LIKE 'token_%'
      GROUP BY condition_id
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json<Array<any>>();
  
  console.log('Top 10 token IDs by trade count:\n');
  samples.forEach((s, i) => {
    console.log(`${i+1}. ${s.condition_id}`);
    console.log(`   Trades: ${s.trade_count.toLocaleString()}, Volume: $${parseFloat(s.volume_usd).toLocaleString()}\n`);
  });
  
  // 3. Check if these tokens exist in any mapping table
  console.log('--- Step 3: Check for Token → CID Mapping ---\n');
  
  // Get a sample token ID
  const sampleToken = samples[0].condition_id;
  console.log(`Sample token: ${sampleToken}\n`);
  
  // Extract numeric part
  const numericPart = sampleToken.replace('token_', '');
  console.log(`Numeric part: ${numericPart}`);
  console.log(`Length: ${numericPart.length} characters\n`);
  
  // Check if this looks like an ERC1155 token ID
  console.log('Hypothesis: This is an ERC1155 token ID (not a condition ID)\n');
  
  // 4. Check ERC1155 tables for mapping
  console.log('--- Step 4: Search ERC1155 Tables ---\n');
  
  const erc1155TablesResult = await clickhouse.query({
    query: `
      SELECT
        database,
        name,
        total_rows
      FROM system.tables
      WHERE (database = 'default' OR database = 'cascadian_clean')
        AND name LIKE '%erc1155%'
      ORDER BY total_rows DESC NULLS LAST
    `,
    format: 'JSONEachRow'
  });
  const erc1155Tables = await erc1155TablesResult.json<Array<any>>();
  
  if (erc1155Tables.length > 0) {
    console.log('Found ERC1155 tables:\n');
    erc1155Tables.forEach(t => {
      console.log(`  ${t.database}.${t.name}: ${(t.total_rows || 0).toLocaleString()} rows`);
    });
    console.log();
    
    // Check first table for token mapping
    const firstTable = erc1155Tables[0];
    console.log(`Checking ${firstTable.database}.${firstTable.name} for token mapping...\n`);
    
    try {
      const tokenCheckResult = await clickhouse.query({
        query: `SELECT * FROM ${firstTable.database}.${firstTable.name} LIMIT 3`,
        format: 'JSONEachRow'
      });
      const tokenSamples = await tokenCheckResult.json<Array<any>>();
      
      if (tokenSamples.length > 0) {
        console.log('Sample columns:', Object.keys(tokenSamples[0]).join(', '));
        console.log('\nSample row:', JSON.stringify(tokenSamples[0], null, 2).substring(0, 500) + '...\n');
      }
    } catch (e: any) {
      console.log(`Error: ${e.message}\n`);
    }
  } else {
    console.log('No ERC1155 tables found\n');
  }
  
  // 5. Recommendation
  console.log('--- Step 5: Recommendation ---\n');
  
  const volumePct = (parseFloat(stats[0].total_volume_usd) / 3500000000) * 100; // Assuming ~$3.5B total
  
  console.log(`Impact Assessment:`);
  console.log(`  ${((244260/80109651)*100).toFixed(2)}% of trades (0.3%)`);
  console.log(`  ~${volumePct.toFixed(2)}% of total volume\n`);
  
  if (volumePct < 1) {
    console.log('✅ Recommended: QUARANTINE (low impact)\n');
    console.log('Strategy:');
    console.log('1. Filter out token_* entries in queries:');
    console.log('   WHERE length(replaceAll(condition_id, "0x", "")) = 64');
    console.log('2. Create separate token_trades table for investigation');
    console.log('3. Attempt token → condition_id mapping later if needed\n');
  } else {
    console.log('⚠️  Recommended: DECODE (significant impact)\n');
    console.log('Strategy:');
    console.log('1. Build ERC1155 token_id → condition_id mapping');
    console.log('2. Backfill condition_id for these trades');
    console.log('3. Re-validate after mapping\n');
  }
}

main().catch(console.error);
