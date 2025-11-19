import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!
});

async function main() {
  // Check sample winning outcomes
  const result = await client.query({
    query: `
      SELECT
        condition_id,
        winning_outcome,
        length(winning_outcome) as len,
        hex(winning_outcome) as hex_value,
        resolved_at
      FROM market_resolutions
      WHERE winning_outcome IS NOT NULL
        AND winning_outcome != ''
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  console.log('Sample resolved markets with winning_outcome:');
  console.log(JSON.stringify(await result.json(), null, 2));

  //Check what winning_outcome values exist
  const distinctResult = await client.query({
    query: `
      SELECT
        winning_outcome,
        COUNT(*) as count
      FROM market_resolutions
      GROUP BY winning_outcome
      ORDER BY count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  console.log('\nDistinct winning_outcome values:');
  console.log(JSON.stringify(await distinctResult.json(), null, 2));

  await client.close();
}

main().catch(console.error);
