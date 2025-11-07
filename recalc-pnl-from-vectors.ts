#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 120000,
});

async function main() {
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║   RECALCULATE P&L DIRECTLY FROM PAYOUT VECTORS                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Step 1: Check what markets exist and are resolved
  console.log("STEP 1: Sample of markets and their resolution status\n");

  const markets = await ch.query({
    query: `
      SELECT 
        DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm,
        COUNT(*) as trade_count,
        SUM(CAST(shares AS Float64)) as total_shares
      FROM trades_raw
      WHERE wallet_address = lower('${wallet}')
      GROUP BY cid_norm
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: "JSONCompact"
  });

  const marketsText = await markets.text();
  const marketsData = JSON.parse(marketsText).data;
  
  console.log("Top 10 markets by trade count:");
  for (const [cid, count, shares] of marketsData) {
    console.log(`  CID: ${cid?.substring(0, 16)}... | Trades: ${count} | Shares: ${shares?.toFixed(4)}`);
  }

  // Step 2: Try to find winning_index data
  console.log("\n\nSTEP 2: Check if winning_index table exists\n");

  try {
    const wi = await ch.query({
      query: `
        SELECT count() as cnt FROM (SELECT DISTINCT condition_id_norm FROM trades_raw)
      `,
      format: "JSONCompact"
    });

    const wiText = await wi.text();
    const wiData = JSON.parse(wiText).data;
    console.log(`  Total unique conditions in trades_raw: ${wiData[0][0]}`);
  } catch (e: any) {
    console.log(`  Error: ${e.message.substring(0, 60)}`);
  }

  // Step 3: Show any table that might have resolution data
  console.log("\n\nSTEP 3: Looking for market resolution data\n");

  const tableList = await ch.query({
    query: "SHOW TABLES LIKE '%resolv%'",
    format: "JSONCompact"
  });

  const tableListText = await tableList.text();
  const tableListData = JSON.parse(tableListText).data;
  
  console.log("Tables with 'resolv' in name:");
  for (const [tableName] of tableListData) {
    console.log(`  - ${tableName}`);
  }

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║              DIAGNOSIS COMPLETE                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
