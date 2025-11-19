#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function main() {
  console.log('Checking payout vector data...\n');

  const query = `
    SELECT
      condition_id_norm,
      winning_index,
      payout_numerators,
      payout_denominator
    FROM market_resolutions_final
    WHERE condition_id_norm IN (
      '00000000000000000000000000000000000000000000000000000000000000',
      '3eb16c3138377017c61d7cffe94f439c5ec07dd83c07fac088ce1f742111d537'
    )
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  console.log('Payout data for top positions:');
  console.log(JSON.stringify(data, null, 2));

  await client.close();
}

main().catch(console.error);
