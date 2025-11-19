#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== BLOCK_TIME VERIFICATION ===\n');
  
  // Check block_time vs created_at
  console.log('--- Comparing block_time vs created_at ---\n');
  
  const compareResult = await clickhouse.query({
    query: `
      SELECT
        min(block_time) as earliest_block_time,
        max(block_time) as latest_block_time,
        uniqExact(block_time) as unique_block_times,
        min(created_at) as earliest_created_at,
        max(created_at) as latest_created_at,
        uniqExact(created_at) as unique_created_ats,
        count() as total_rows
      FROM default.trades_raw
    `,
    format: 'JSONEachRow'
  });
  const compareData = await compareResult.json<Array<any>>();
  
  console.log(`block_time field:`);
  console.log(`  Earliest: ${compareData[0].earliest_block_time}`);
  console.log(`  Latest:   ${compareData[0].latest_block_time}`);
  console.log(`  Unique:   ${compareData[0].unique_block_times.toLocaleString()}`);
  console.log(`  Total:    ${compareData[0].total_rows.toLocaleString()}\n`);
  
  console.log(`created_at field (CORRUPTED):`);
  console.log(`  Earliest: ${compareData[0].earliest_created_at}`);
  console.log(`  Latest:   ${compareData[0].latest_created_at}`);
  console.log(`  Unique:   ${compareData[0].unique_created_ats.toLocaleString()}`);
  console.log(`  Total:    ${compareData[0].total_rows.toLocaleString()}\n`);
  
  if (compareData[0].unique_block_times > 1) {
    console.log('✅ GOOD NEWS: block_time has diverse timestamps!');
    console.log(`   ${compareData[0].unique_block_times.toLocaleString()} unique timestamps vs 1 corrupt created_at\n`);
    
    // Sample block_time distribution
    console.log('--- Sample block_time distribution ---\n');
    
    const distResult = await clickhouse.query({
      query: `
        SELECT
          toStartOfMonth(block_time) as month,
          count() as trades,
          min(block_time) as earliest,
          max(block_time) as latest
        FROM default.trades_raw
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
      `,
      format: 'JSONEachRow'
    });
    const distribution = await distResult.json<Array<any>>();
    
    distribution.forEach(d => {
      console.log(`${d.month}: ${parseInt(d.trades).toLocaleString()} trades`);
      console.log(`  Range: ${d.earliest} to ${d.latest}`);
    });
    console.log();
    
    // Recommend repair
    console.log('--- REPAIR STRATEGY ---\n');
    console.log('✅ Simple Fix Available!\n');
    console.log('The trades_raw table ALREADY has correct timestamps in block_time field.');
    console.log('created_at is corrupted, but block_time is good.\n');
    console.log('Options:');
    console.log('1. Use block_time directly in queries (no repair needed)');
    console.log('2. Update created_at = block_time (cosmetic fix)');
    console.log('3. Update documentation to always use block_time\n');
    console.log('Recommendation: Use block_time directly. No rebuild required!\n');
    
  } else {
    console.log('❌ Problem: block_time is also corrupted');
    console.log('   Will need blockchain or API re-import\n');
  }
}

main().catch(console.error);
