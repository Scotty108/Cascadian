#!/usr/bin/env npx tsx
import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const query = `
    SELECT
      countIf(token_id != '') as with_token_id,
      countIf(token_id = '') as empty_token_id,
      round(100.0 * countIf(token_id = '') / count(*), 2) as pct_empty,
      count(*) as total_missing
    FROM gamma_markets
    WHERE lower(replaceAll(condition_id, '0x', '')) NOT IN (
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
      FROM clob_fills
    )
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  console.log('Token ID Coverage in Missing Markets:');
  console.log('=====================================');
  console.log(JSON.stringify(data[0], null, 2));
}

main();
