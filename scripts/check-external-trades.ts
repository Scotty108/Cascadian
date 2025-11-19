#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({
    query: `
      SELECT
        source,
        COUNT(*) as cnt,
        SUM(shares) as total_shares,
        SUM(cash_value) as total_value,
        COUNT(DISTINCT condition_id) as unique_markets
      FROM external_trades_raw
      GROUP BY source
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json();
  console.log('external_trades_raw contents:');
  console.table(rows);

  const totalResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as total FROM external_trades_raw',
    format: 'JSONEachRow'
  });
  const total = (await totalResult.json())[0].total;
  console.log(`\nTotal rows: ${total}`);
}

main().catch(console.error);
