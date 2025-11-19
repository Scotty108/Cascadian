import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();
  const rangeQuery = `
    SELECT
      toDate(min(block_time)) AS min_block_time,
      toDate(max(block_time)) AS max_block_time,
      min(block_time) AS min_block_time_ts,
      max(block_time) AS max_block_time_ts,
      count() AS total_trades,
      uniqExact(wallet) AS unique_wallets,
      uniqExact(condition_id) AS unique_markets
    FROM default.trades_raw
  `;
  const result = await ch.query({ query: rangeQuery, format: 'JSONEachRow' });
  const rows = await result.json();
  console.log(rows);
}

main();
