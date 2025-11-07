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
  console.log("FINDING PRE-CALCULATED P&L VALUES");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Check existing wallet_pnl_correct (if it exists)
  try {
    console.log("Checking wallet_pnl_correct...\n");
    const result = await ch.query({
      query: `SELECT wallet, realized_pnl FROM wallet_pnl_correct 
               WHERE lower(wallet) = lower('${niggemon}')`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      const pnl = parseFloat(data[0][1]);
      console.log(`✅ Found: $${pnl.toFixed(2)}\n`);
    }
  } catch {
    console.log(`Not found or error\n`);
  }

  // Check other variants
  const variants = [
    "wallet_realized_pnl_correct",
    "wallet_pnl_final",
    "realized_pnl_final",
    "pnl_correct"
  ];

  for (const variant of variants) {
    try {
      const result = await ch.query({
        query: `SELECT COUNT() FROM ${variant} LIMIT 1`,
        format: "JSONCompact"
      });
      console.log(`✅ Table exists: ${variant}`);
    } catch {
      // Table doesn't exist
    }
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

main().catch(console.error);
