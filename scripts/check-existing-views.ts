#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 30000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CHECKING EXISTING VIEWS AND TABLE DEFINITIONS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  // Check if wallet_realized_pnl_final exists
  try {
    console.log("1. Checking wallet_realized_pnl_final view...");
    const result = await ch.query({
      query: `SELECT wallet, realized_pnl_usd FROM wallet_realized_pnl_final 
               WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))`,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log("   ✅ View exists with data:");
      for (const row of data) {
        console.log(`      ${row[0].substring(0, 12)}...: $${parseFloat(row[1]).toFixed(2)}`);
      }
    } else {
      console.log("   ⚠️  View exists but no data for target wallets");
    }
  } catch (e: any) {
    console.log(`   ❌ View does not exist: ${e.message.split('\n')[0]}`);
  }

  // Check if wallet_unrealized_pnl_v2 exists
  try {
    console.log("\n2. Checking wallet_unrealized_pnl_v2 view...");
    const result = await ch.query({
      query: `SELECT wallet, unrealized_pnl_usd FROM wallet_unrealized_pnl_v2 
               WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))`,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log("   ✅ View exists with data:");
      for (const row of data) {
        console.log(`      ${row[0].substring(0, 12)}...: $${parseFloat(row[1]).toFixed(2)}`);
      }
    } else {
      console.log("   ⚠️  View exists but no data for target wallets");
    }
  } catch (e: any) {
    console.log(`   ❌ View does not exist: ${e.message.split('\n')[0]}`);
  }

  // Check if wallet_pnl_summary_final exists
  try {
    console.log("\n3. Checking wallet_pnl_summary_final view...");
    const result = await ch.query({
      query: `SELECT wallet, realized_pnl_usd, unrealized_pnl_usd, total_pnl_usd 
               FROM wallet_pnl_summary_final 
               WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))`,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    
    if (data.length > 0) {
      console.log("   ✅ View exists with data:");
      for (const row of data) {
        const w = row[0];
        const r = parseFloat(row[1]);
        const u = parseFloat(row[2]);
        const t = parseFloat(row[3]);
        console.log(`      ${w.substring(0, 12)}...: Realized=$${r.toFixed(2)}, Unrealized=$${u.toFixed(2)}, Total=$${t.toFixed(2)}`);
      }
    } else {
      console.log("   ⚠️  View exists but no data for target wallets");
    }
  } catch (e: any) {
    console.log(`   ❌ View does not exist: ${e.message.split('\n')[0]}`);
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

main().catch(console.error);
