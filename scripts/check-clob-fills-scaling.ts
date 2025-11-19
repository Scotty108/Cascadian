#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

config({ path: resolve(__dirname, '../.env.local') });

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  // Check raw clob_fills data
  const result = await clickhouse.query({
    query: `
      SELECT 
        asset_id,
        size,
        price,
        side,
        fee_rate_bps,
        toFloat64(size) as size_float,
        toFloat64(price) as price_float,
        toFloat64(size) * toFloat64(price) as notional_raw,
        toFloat64(size)/1e6 as size_scaled,
        toFloat64(price)/1e6 as price_scaled,
        toFloat64(size)/1e6 * toFloat64(price)/1e6 as notional_scaled
      FROM clob_fills
      WHERE lower(coalesce(user_eoa, proxy_wallet)) = lower('${TARGET_WALLET}')
        AND asset_id NOT IN ('asset','')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json();
  console.log('Raw clob_fills data:');
  console.log(JSON.stringify(data, null, 2));

  await clickhouse.close();
}

main();
