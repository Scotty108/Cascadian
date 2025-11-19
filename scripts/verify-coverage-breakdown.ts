#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function verify() {
  try {
    console.log('📊 Coverage Breakdown Analysis\n');
    
    // Overall stats
    const totalResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          countIf(block_timestamp > toDateTime(0)) as with_ts,
          countIf(block_timestamp = toDateTime(0)) as epoch_zero
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    
    const total = await totalResult.json<any>();
    if (total && total[0]) {
      const t = total[0];
      const pct = (parseInt(t.with_ts) / parseInt(t.total) * 100).toFixed(2);
      console.log(`Overall Coverage: ${pct}% (${t.with_ts}/${t.total})`);
      console.log(`  Real timestamps: ${t.with_ts}`);
      console.log(`  Epoch zero: ${t.epoch_zero}\n`);
    }
    
    // Breakdown by timestamp value
    console.log('Timestamp Distribution:\n');
    const distResult = await clickhouse.query({
      query: `
        SELECT 
          CASE 
            WHEN block_timestamp = toDateTime(0) THEN 'Epoch Zero (1970-01-01)'
            WHEN block_timestamp = '2025-10-13 13:20:15' THEN 'Fallback (Latest Known)'
            ELSE 'Real Timestamps'
          END as timestamp_type,
          count() as rows,
          formatReadableNumber(count()) as rows_formatted
        FROM erc1155_transfers
        GROUP BY 
          CASE 
            WHEN block_timestamp = toDateTime(0) THEN 'Epoch Zero (1970-01-01)'
            WHEN block_timestamp = '2025-10-13 13:20:15' THEN 'Fallback (Latest Known)'
            ELSE 'Real Timestamps'
          END
        ORDER BY rows DESC
      `,
      format: 'JSONEachRow',
    });
    
    const dist = await distResult.json<any>();
    dist.forEach((row: any) => {
      const pct = (parseInt(row.rows) / parseInt(total[0].total) * 100).toFixed(1);
      console.log(`  ${row.timestamp_type}: ${row.rows_formatted} (${pct}%)`);
    });
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

verify();
