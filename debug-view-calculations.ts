#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSONCompact' });
    const text = await result.text();
    const data = JSON.parse(text).data;
    return data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return [];
  }
}

async function main() {
  const wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'; // niggemon
  
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("DEBUGGING VIEW CALCULATIONS FOR NIGGEMON");
  console.log("════════════════════════════════════════════════════════════════\n");
  
  // Check trade_flows_v2 data
  console.log("1️⃣ TRADE FLOWS (sample 5 trades):");
  const flows = await queryData(`
    SELECT 
      wallet,
      substring(market_id, 1, 20) as market_short,
      trade_idx,
      cashflow_usdc,
      delta_shares
    FROM trade_flows_v2
    WHERE wallet = lower('${wallet}')
    LIMIT 5
  `);
  
  if (flows.length > 0) {
    console.log("   wallet | market | idx | cashflow | delta_shares");
    flows.forEach((row: any) => {
      console.log(`   ${row[0].substring(0, 6)}... | ${row[1]} | ${row[2]} | $${row[3]} | ${row[4]}`);
    });
  }
  
  // Count total trades and cashflows
  console.log("\n2️⃣ CASHFLOWS AGGREGATION:");
  const cashflows = await queryData(`
    SELECT 
      count() as total_trades,
      sum(cashflow_usdc) as total_cashflow,
      count(DISTINCT market_id) as unique_markets
    FROM trade_flows_v2
    WHERE wallet = lower('${wallet}')
  `);
  
  if (cashflows.length > 0) {
    console.log(`   Total trades: ${cashflows[0][0]}`);
    console.log(`   Total cashflow: $${cashflows[0][1]}`);
    console.log(`   Unique markets: ${cashflows[0][2]}`);
  }
  
  // Check winning_index
  console.log("\n3️⃣ WINNING INDEX (sample 5 resolved markets):");
  const winning = await queryData(`
    SELECT 
      substring(condition_id_norm, 1, 16) as condition_short,
      win_idx
    FROM winning_index
    LIMIT 5
  `);
  
  if (winning.length > 0) {
    winning.forEach((row: any) => {
      console.log(`   ${row[0]} | win_idx=${row[1]}`);
    });
  }
  
  // Check realized_pnl_by_market_v2 structure
  console.log("\n4️⃣ REALIZED PNL BY MARKET (sample 10 results):");
  const pnlByMarket = await queryData(`
    SELECT 
      substring(market_id, 1, 20) as market_short,
      realized_pnl_usd,
      fill_count
    FROM realized_pnl_by_market_v2
    WHERE wallet = lower('${wallet}')
    ORDER BY realized_pnl_usd DESC
    LIMIT 10
  `);
  
  if (pnlByMarket.length > 0) {
    console.log("   market | P&L | fills");
    let totalPnL = 0;
    pnlByMarket.forEach((row: any) => {
      const pnl = parseFloat(row[1]);
      totalPnL += pnl;
      console.log(`   ${row[0]} | $${pnl.toFixed(2)} | ${row[2]}`);
    });
    console.log(`\n   Subtotal from top 10: $${totalPnL.toFixed(2)}`);
  }
  
  // Check total via query
  console.log("\n5️⃣ TOTAL P&L AGGREGATION:");
  const totalPnL = await queryData(`
    SELECT 
      count() as market_count,
      sum(realized_pnl_usd) as total_pnl,
      sum(fill_count) as total_fills
    FROM realized_pnl_by_market_v2
    WHERE wallet = lower('${wallet}')
  `);
  
  if (totalPnL.length > 0) {
    console.log(`   Markets traded: ${totalPnL[0][0]}`);
    console.log(`   Total P&L: $${parseFloat(totalPnL[0][1]).toFixed(2)}`);
    console.log(`   Total fills: ${totalPnL[0][2]}`);
  }
  
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("EXPECTED: ~$100K | ACTUAL: $3.6M (35x inflation)\n");
}

main().catch(console.error);
