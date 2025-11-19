#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  try {
    console.log("Running wallet count queries...\n");

    // 1. Total distinct wallets
    const q1 = `SELECT COUNT(DISTINCT wallet_address) as wallet_count FROM trades_raw`;
    const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
    const d1: any[] = await r1.json();
    console.log("1. Total distinct wallets:");
    console.log(d1[0]);

    // 2. Wallets per resolved vs unresolved
    const q2 = `
      SELECT 
        COALESCE(m.is_resolved, false) as is_resolved,
        COUNT(DISTINCT t.wallet_address) as wallet_count,
        COUNT(*) as trade_count
      FROM trades_raw t
      LEFT JOIN markets m ON t.market_id = m.id
      GROUP BY is_resolved
      ORDER BY is_resolved DESC
    `;
    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const d2: any[] = await r2.json();
    console.log("\n2. Wallets by market resolution status:");
    d2.forEach(row => console.log(row));

    // 3. Wallets with at least 1 resolved trade
    const q3 = `
      SELECT COUNT(DISTINCT t.wallet_address) as wallets_with_resolved_trades
      FROM trades_raw t
      WHERE EXISTS (
        SELECT 1 FROM markets m 
        WHERE m.id = t.market_id AND m.is_resolved = true
      )
    `;
    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const d3: any[] = await r3.json();
    console.log("\n3. Wallets with at least 1 resolved trade:");
    console.log(d3[0]);

    // 4. Additional metrics
    const q4 = `
      SELECT 
        COUNT(DISTINCT wallet_address) as total_wallets,
        COUNT(*) as total_trades,
        round(AVG(trades_per_wallet), 2) as avg_trades_per_wallet,
        MAX(trades_per_wallet) as max_trades_per_wallet,
        MIN(trades_per_wallet) as min_trades_per_wallet
      FROM (
        SELECT wallet_address, COUNT(*) as trades_per_wallet
        FROM trades_raw
        GROUP BY wallet_address
      )
    `;
    const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
    const d4: any[] = await r4.json();
    console.log("\n4. Additional wallet metrics:");
    console.log(d4[0]);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
