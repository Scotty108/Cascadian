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
    // 2. Wallets per resolved vs unresolved - use market_id as key
    const q2 = `
      SELECT 
        COUNT(DISTINCT t.wallet_address) as wallet_count,
        COUNT(*) as trade_count
      FROM trades_raw t
    `;
    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const d2: any[] = await r2.json();
    console.log("2. Overall wallet and trade count (no market join):");
    console.log(d2[0]);

    // 3. Wallets with trades on markets that exist
    const q3 = `
      SELECT COUNT(DISTINCT t.wallet_address) as wallets_in_trades_raw
      FROM trades_raw t
      WHERE market_id IS NOT NULL AND market_id != ''
    `;
    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const d3: any[] = await r3.json();
    console.log("\n3. Wallets with non-empty market_id:");
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
    console.log("\n4. Trade distribution per wallet:");
    console.log(d4[0]);

    // 5. Top wallets by trade count
    const q5 = `
      SELECT 
        wallet_address,
        COUNT(*) as trade_count
      FROM trades_raw
      GROUP BY wallet_address
      ORDER BY trade_count DESC
      LIMIT 10
    `;
    const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
    const d5: any[] = await r5.json();
    console.log("\n5. Top 10 wallets by trade count:");
    d5.forEach((row, i) => console.log(`  ${i+1}. ${row.wallet_address}: ${row.trade_count} trades`));

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
