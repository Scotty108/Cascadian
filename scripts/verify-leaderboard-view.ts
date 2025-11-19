#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({
    query: 'SELECT COUNT(*) as total FROM pm_wallet_leaderboard',
    format: 'JSONEachRow'
  });

  const data = await result.json();
  console.log('✅ pm_wallet_leaderboard exists with', data[0].total, 'rows');
}

main().catch(console.error);
