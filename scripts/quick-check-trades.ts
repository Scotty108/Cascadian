import { createClient } from '@clickhouse/client';

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
  });

  const result = await client.query({
    query: `
      SELECT COUNT(*) as total_trades
      FROM external_trades_raw
      WHERE source = 'polymarket_data_api'
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();
  console.log('Trades saved so far:', data[0].total_trades);

  await client.close();
}

main();
