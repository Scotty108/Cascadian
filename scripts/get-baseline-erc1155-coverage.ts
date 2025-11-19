#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function getBaseline() {
  try {
    console.log('📊 Baseline ERC-1155 Coverage\n');
    
    const result = await clickhouse.query({
      query: `
        SELECT 
          count() as total_rows,
          formatReadableQuantity(count()) as total_formatted,
          min(block_number) as min_block,
          max(block_number) as max_block,
          toDate(min(block_timestamp)) as earliest_date,
          toDate(max(block_timestamp)) as latest_date,
          dateDiff('day', toDate(min(block_timestamp)), toDate(max(block_timestamp))) as days_span
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow',
    });

    const data = await result.json<any>();
    if (data && data[0]) {
      console.log('default.erc1155_transfers:');
      console.log(`  Total rows: ${data[0].total_formatted} (${data[0].total_rows})`);
      console.log(`  Block range: ${data[0].min_block} → ${data[0].max_block}`);
      console.log(`  Date range: ${data[0].earliest_date} → ${data[0].latest_date}`);
      console.log(`  Days covered: ${data[0].days_span}`);
      console.log('');
      
      // Also get monthly breakdown for target period
      console.log('📅 Monthly breakdown (Dec 2022 - May 2024):');
      const monthlyResult = await clickhouse.query({
        query: `
          SELECT 
            toYYYYMM(block_timestamp) as month,
            count() as transfers,
            formatReadableQuantity(count()) as transfers_formatted
          FROM default.erc1155_transfers
          WHERE block_timestamp >= '2022-12-01'
            AND block_timestamp < '2024-06-01'
          GROUP BY month
          ORDER BY month
        `,
        format: 'JSONEachRow',
      });
      
      const monthlyData = await monthlyResult.json<any>();
      if (monthlyData && monthlyData.length > 0) {
        monthlyData.forEach((row: any) => {
          console.log(`  ${row.month}: ${row.transfers_formatted} (${row.transfers})`);
        });
      } else {
        console.log('  ⚠️  No data found in Dec 2022 - May 2024 range');
      }
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

getBaseline();
