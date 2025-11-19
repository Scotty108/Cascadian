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
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CHECKING: realized_pnl_by_market_v2 VIEW");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  // First, get the view definition
  console.log("VIEW DEFINITION:");
  console.log("─".repeat(70));
  
  try {
    const result = await ch.query({
      query: `
        SELECT create_table_query
        FROM system.tables
        WHERE database = 'default' AND name = 'realized_pnl_by_market_v2'
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      const query = data[0][0];
      console.log(query);
      console.log();
    } else {
      console.log("❌ View not found\n");
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message}\n`);
  }

  // Now query the view for our wallets
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("QUERYING: realized_pnl_by_market_v2 FOR TARGET WALLETS");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          count() as market_count,
          sum(CAST(realized_pnl_usd AS Float64)) as total_pnl,
          sum(fill_count) as total_fills,
          min(resolved_at) as earliest_resolve,
          max(resolved_at) as latest_resolve
        FROM realized_pnl_by_market_v2
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log("✅ Data found in realized_pnl_by_market_v2\n");
      for (const row of data) {
        const wallet = row[0];
        const markets = row[1];
        const pnl = parseFloat(row[2] || "0");
        const fills = row[3];
        console.log(`  Wallet: ${wallet.substring(0, 12)}...`);
        console.log(`    Markets: ${markets}`);
        console.log(`    Total P&L: $${pnl.toFixed(2)}`);
        console.log(`    Total fills: ${fills}\n`);
      }
    } else {
      console.log("❌ No data found in realized_pnl_by_market_v2\n");
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message}\n`);
  }

  // Check wallet_realized_pnl_v2
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("QUERYING: wallet_realized_pnl_v2");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          market_count,
          fill_count
        FROM wallet_realized_pnl_v2
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log("✅ Data found in wallet_realized_pnl_v2\n");
      for (const row of data) {
        const wallet = row[0];
        const pnl = parseFloat(row[1] || "0");
        const markets = row[2];
        const fills = row[3];
        console.log(`  Wallet: ${wallet.substring(0, 12)}...`);
        console.log(`    P&L: $${pnl.toFixed(2)}`);
        console.log(`    Markets: ${markets}`);
        console.log(`    Fills: ${fills}\n`);
      }
    } else {
      console.log("❌ No data found in wallet_realized_pnl_v2\n");
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message}\n`);
  }

  // Check wallet_pnl_summary_v2
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("QUERYING: wallet_pnl_summary_v2");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          unrealized_pnl_usd,
          total_pnl_usd
        FROM wallet_pnl_summary_v2
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log("✅ Data found in wallet_pnl_summary_v2\n");
      for (const row of data) {
        const wallet = row[0];
        const realized = parseFloat(row[1] || "0");
        const unrealized = parseFloat(row[2] || "0");
        const total = parseFloat(row[3] || "0");
        console.log(`  Wallet: ${wallet.substring(0, 12)}...`);
        console.log(`    Realized: $${realized.toFixed(2)}`);
        console.log(`    Unrealized: $${unrealized.toFixed(2)}`);
        console.log(`    TOTAL: $${total.toFixed(2)}\n`);
      }
    } else {
      console.log("❌ No data found in wallet_pnl_summary_v2\n");
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message}\n`);
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("COMPARISON WITH EXPECTED VALUES");
  console.log("════════════════════════════════════════════════════════════════\n");
  console.log("niggemon (0xeb6f...):  Expected $102,001.46");
  console.log("HolyMoses7 (0xa4b3...): Expected $89,975.16\n");
}

main().catch(console.error);
