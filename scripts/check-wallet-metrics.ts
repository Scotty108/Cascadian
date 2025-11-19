#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  try {
    // Check raw numbers
    const q1 = `
      SELECT 
        COUNT(*) as total_trades,
        COUNT(DISTINCT wallet_address) as distinct_wallets
      FROM trades_raw
    `;
    const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
    const d1: any[] = await r1.json();
    console.log("Raw totals:");
    console.log(d1[0]);

    // Check wallet distribution correctly
    const q2 = `
      SELECT 
        min(trades_per_wallet) as min_trades,
        max(trades_per_wallet) as max_trades,
        round(avg(trades_per_wallet), 2) as avg_trades,
        round(median(trades_per_wallet), 2) as median_trades
      FROM (
        SELECT wallet_address, COUNT(*) as trades_per_wallet
        FROM trades_raw
        GROUP BY wallet_address
      ) t
    `;
    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const d2: any[] = await r2.json();
    console.log("\nWallet trade distribution:");
    console.log(d2[0]);

    // Count wallets with at least 10+ trades
    const q3 = `
      SELECT 
        COUNT(*) as wallets_with_10plus,
        COUNT(case when trade_count >= 100 then 1 end) as wallets_with_100plus,
        COUNT(case when trade_count >= 1000 then 1 end) as wallets_with_1000plus
      FROM (
        SELECT wallet_address, COUNT(*) as trade_count
        FROM trades_raw
        GROUP BY wallet_address
      )
    `;
    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const d3: any[] = await r3.json();
    console.log("\nWallet tiers:");
    console.log(d3[0]);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
