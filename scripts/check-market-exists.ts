#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const conditionId = 'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058';

async function main() {
  console.log(`Checking condition ID: ${conditionId}\n`);

  const staging = await ch.query({
    query: `SELECT COUNT(*) as count FROM default.api_markets_staging WHERE condition_id = '${conditionId}'`,
    format: 'JSONEachRow'
  });
  const stagingData = await staging.json<any>();

  const trades = await ch.query({
    query: `SELECT COUNT(*) as count FROM cascadian_clean.fact_trades_clean WHERE lower(replaceAll(cid_hex, '0x', '')) = '${conditionId}'`,
    format: 'JSONEachRow'
  });
  const tradesData = await trades.json<any>();

  console.log(`In api_markets_staging: ${stagingData[0].count}`);
  console.log(`In fact_trades_clean: ${tradesData[0].count}`);

  await ch.close();
}

main();
