#!/usr/bin/env npx tsx
/**
 * Validate ERC-1155 backfill progress by sampling conditions
 * Check: are we getting ~50-70 transfers per condition?
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('ERC-1155 BACKFILL VALIDATION');
  console.log('═'.repeat(100) + '\n');

  // Current status
  console.log('1️⃣  Current backfill status:');
  try {
    const result = await ch.query({
      query: 'SELECT COUNT(*) as total_rows FROM default.erc1155_transfers',
      format: 'JSONEachRow'
    });
    const data = await result.json<any[]>();
    const totalRows = parseInt(data[0].total_rows);
    console.log(`   Total rows: ${totalRows.toLocaleString()}`);
    console.log(`   Estimated completion: ${totalRows > 10000000 ? '80-90% done' : 'still early'}\n`);

    // Get unique conditions (token_id)
    const result2 = await ch.query({
      query: 'SELECT uniqExact(token_id) as unique_conditions FROM default.erc1155_transfers',
      format: 'JSONEachRow'
    });
    const data2 = await result2.json<any[]>();
    const conditions = parseInt(data2[0].unique_conditions);
    console.log(`   Unique token IDs (conditions): ${conditions.toLocaleString()}`);

    // Average transfers per condition
    const avgPerCondition = Math.round(totalRows / conditions);
    console.log(`   Average transfers/condition: ${avgPerCondition}`);
    console.log(`   ✓ This should be 50-70 for the math to check out\n`);

    // Projection
    const expectedFinal = conditions * avgPerCondition;
    console.log(`2️⃣  Projection if this ratio holds:`);
    console.log(`   ${conditions.toLocaleString()} conditions × ${avgPerCondition} transfers/condition = ${expectedFinal.toLocaleString()} total rows`);

    if (expectedFinal > 13000000) {
      console.log(`   ⚠️  WARNING: Projection exceeds 13M estimate!`);
    } else if (expectedFinal < 10000000) {
      console.log(`   ⚠️  WARNING: Projection below 10M estimate!`);
    } else {
      console.log(`   ✅ Projection within 10-13M range\n`);
    }

    // Sample some conditions to see transfer distribution
    console.log('3️⃣  Sample distribution (first 10 token IDs):');
    const result3 = await ch.query({
      query: `
        SELECT
          token_id,
          COUNT(*) as transfer_count
        FROM default.erc1155_transfers
        GROUP BY token_id
        ORDER BY transfer_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const data3 = await result3.json<any[]>();
    for (const row of data3) {
      console.log(`   ${row.token_id.substring(0, 16)}... : ${row.transfer_count} transfers`);
    }

  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }

  console.log('\n' + '═'.repeat(100));
  console.log('What this tells us:');
  console.log('═'.repeat(100));
  console.log('• If avg transfers/condition ≈ 50-70: Our 10-13M estimate is solid');
  console.log('• If it\'s much higher (>100): Could be more final rows than expected');
  console.log('• If it\'s much lower (<30): Could be fewer final rows than expected');
  console.log('• Sample distribution shows if all conditions have similar structure\n');

  await ch.close();
}

main().catch(console.error);
