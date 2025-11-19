#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const EOA = "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b";

async function main() {
  const client = getClickHouseClient()
  
  console.log(`\n📊 CHECKING KEY TABLE SCHEMAS\n`);

  try {
    // Check pm_trades_canonical_v2
    console.log("pm_trades_canonical_v2 fields:");
    const t1 = await client.query({
      query: `SELECT * FROM pm_trades_canonical_v2 LIMIT 1`,
      format: 'JSONEachRow'
    });
    const d1 = await t1.json<any>();
    console.log(Object.keys(d1[0]).join(", "));

    // Check erc20_transfers_decoded
    console.log("\nerc20_transfers_decoded fields:");
    const t2 = await client.query({
      query: `SELECT * FROM erc20_transfers_decoded LIMIT 1`,
      format: 'JSONEachRow'
    });
    const d2 = await t2.json<any>();
    console.log(Object.keys(d2[0]).join(", "));

    // Now check if wallet has any trades
    console.log(`\n\nChecking trades for wallet (trying different field names):\n`);
    
    const tradesResult = await client.query({
      query: `
        SELECT 
          count() as cnt,
          sum(cast(volume as Float64)) as vol
        FROM pm_trades_canonical_v2
        WHERE lower(wallet_address) = '${EOA.toLowerCase()}'
        OR lower(wallet) = '${EOA.toLowerCase()}'
      `,
      format: 'JSONEachRow'
    });

    const tradesData = await tradesResult.json<any>();
    console.log(`Trades found: ${parseInt(tradesData[0].cnt)}`);
    if (parseInt(tradesData[0].cnt) > 0) {
      console.log(`Volume: $${parseFloat(tradesData[0].vol)}`);
    }

    await client.close();
  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

main()
