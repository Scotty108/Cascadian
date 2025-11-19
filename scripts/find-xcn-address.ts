#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address
      FROM pm_wallet_omega_stats
      WHERE external_market_pct > 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const wallets = await result.json();
  console.log('Wallets with external trades:', wallets);
}

main().catch(console.error);
