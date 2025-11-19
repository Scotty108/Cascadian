#!/usr/bin/env npx tsx
/**
 * Quick verification that inserts are actually landing
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  // Get current row count
  const count = await ch.query({
    query: 'SELECT COUNT(*) as count FROM default.erc1155_transfers',
    format: 'JSONEachRow'
  });
  const countData = (await count.json())[0];
  const total = parseInt(countData.count);

  console.log('\n📊 Current state:');
  console.log(`  Total rows: ${total.toLocaleString()}`);

  // Get recent blocks to see if new data is landing
  const recent = await ch.query({
    query: `
      SELECT
        MAX(block_number) as max_block,
        MIN(block_number) as min_block,
        COUNT(*) as recent_count
      FROM default.erc1155_transfers
      WHERE block_number > 50000000
    `,
    format: 'JSONEachRow'
  });
  const recentData = (await recent.json())[0];

  console.log(`\n  Recent blocks (>50M):`);
  console.log(`    Rows: ${parseInt(recentData.recent_count).toLocaleString()}`);
  console.log(`    Block range: ${parseInt(recentData.min_block).toLocaleString()} → ${parseInt(recentData.max_block).toLocaleString()}`);

  // Check very recent inserts (last 5 minutes)
  const veryRecent = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM system.query_log
      WHERE
        query LIKE '%INSERT INTO default.erc1155_transfers%'
        AND event_time > now() - INTERVAL 5 MINUTE
        AND written_rows > 0
    `,
    format: 'JSONEachRow'
  });
  const veryRecentData = (await veryRecent.json())[0];

  console.log(`\n  Recent successful inserts (last 5 min): ${parseInt(veryRecentData.count)}`);

  if (total > 291113) {
    console.log(`\n✅ INSERTS ARE WORKING! Database has grown by ${(total - 291113).toLocaleString()} rows\n`);
  } else {
    console.log(`\n⚠️  Row count unchanged at 291,113 - checking if inserts are pending...\n`);
  }

  await ch.close();
}

main().catch(console.error);
