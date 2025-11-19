#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function main() {
  console.log("\n🔍 INVESTIGATING WALLET DATA ISSUE\n");

  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  
  // Check how many trades for this wallet with different case variations
  const result = await ch.query({
    query: `
      SELECT 
        wallet,
        COUNT(*) as count,
        SUM(cashflow_usdc) as total
      FROM trade_cashflows_v3
      WHERE wallet LIKE '%EB6F0A13EA8C5A7A0514C25495ADBE815C1025F0%'
         OR wallet LIKE '%eb6f0a13ea8c5a7a0514c25495adbe815c1025f0%'
      GROUP BY wallet
    `,
    format: "JSONCompact"
  });
  
  const text = await result.text();
  const data = JSON.parse(text).data;
  
  console.log("Wallets matching niggemon (case variations):");
  for (const row of data) {
    console.log(`  ${row[0]}: ${row[1]} trades, total=$${row[2]}`);
  }
  
  // Check specific wallet
  const result2 = await ch.query({
    query: `
      SELECT COUNT(*), SUM(cashflow_usdc)
      FROM trade_cashflows_v3
      WHERE wallet = lower('${wallet}')
    `,
    format: "JSONCompact"
  });
  
  const text2 = await result2.text();
  const data2 = JSON.parse(text2).data;
  console.log(`\nTrades for wallet (exact lowercase): ${data2[0][0]}, total=$${data2[0][1]}`);
}

main().catch(console.error);
