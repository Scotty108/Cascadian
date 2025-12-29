#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_wallet_market_pnl_resolved',
    format: 'JSONEachRow'
  });
  const schema = await result.json();
  console.log('pm_wallet_market_pnl_resolved schema:');
  console.table(schema);
}

main().catch(console.error);
