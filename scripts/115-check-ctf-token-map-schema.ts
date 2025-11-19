#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({ query: 'DESCRIBE TABLE ctf_token_map' });
  const data = await result.json();
  console.log(JSON.stringify(data, null, 2));
}

main();
