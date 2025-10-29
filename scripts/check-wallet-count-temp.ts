import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  const result = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw',
    format: 'JSONEachRow'
  });
  const data = await result.json() as Array<{count: string}>;
  console.log('Unique wallets in trades_raw:', data[0].count);
}

main().catch(console.error);
