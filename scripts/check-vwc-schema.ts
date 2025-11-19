#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client.js';

config({ path: '.env.local' });

async function checkSchema() {
  const query = `DESCRIBE TABLE vw_trades_canonical`;
  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await res.json();
  console.log('vw_trades_canonical schema:');
  console.log(JSON.stringify(data, null, 2));
}

checkSchema().catch(console.error);
