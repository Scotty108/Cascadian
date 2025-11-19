#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({ query: 'DESCRIBE TABLE clob_fills' });
  const data = await result.json();
  console.log(JSON.stringify(data.data.slice(0, 15), null, 2));
}

main();
