#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const desc = await clickhouse.query({
    query: 'DESCRIBE trades_raw',
    format: 'JSONEachRow'
  });
  const schema: any[] = await desc.json();
  console.log('trades_raw columns:', schema.map(c => c.name).join(', '));
}

main().catch(console.error);
