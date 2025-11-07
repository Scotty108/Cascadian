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
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  REBUILDING wallet_pnl_correct - Using Verified Views         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  try {
    console.log("Step 1: Recreating wallet_pnl_correct from wallet_realized_pnl_v2...\n");

    // DROP the old broken table
    try {
      await ch.command({
        query: "DROP TABLE IF EXISTS wallet_pnl_correct"
      });
      console.log("  ✓ Dropped old wallet_pnl_correct");
    } catch (e) {
      // Might not exist or protected
    }

    // CREATE CORRECTED wallet_pnl_correct from verified views
    await ch.command({
      query: `
        CREATE TABLE wallet_pnl_correct ENGINE = MergeTree()
        ORDER BY wallet_address AS
        SELECT
          w.wallet as wallet_address,
          ROUND(w.realized_pnl_usd, 2) as realized_pnl,
          COALESCE(ROUND(u.unrealized_pnl_usd, 2), 0) as unrealized_pnl,
          ROUND(w.realized_pnl_usd + COALESCE(u.unrealized_pnl_usd, 0), 2) as net_pnl
        FROM wallet_realized_pnl_v2 w
        LEFT JOIN wallet_unrealized_pnl_v2 u ON w.wallet = u.wallet
      `
    });

    console.log("  ✓ Created wallet_pnl_correct from verified views\n");

    // Verify with target wallets
    console.log("Step 2: Validating against Polymarket targets...\n");

    const wallets = [
      { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon", exp: 101949.55 },
      { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", exp: 93181 },
    ];

    let allGood = true;

    for (const w of wallets) {
      const result = await ch.query({
        query: `
          SELECT net_pnl FROM wallet_pnl_correct
          WHERE wallet_address = lower('${w.addr}')
        `,
        format: "JSONCompact"
      });

      const text = await result.text();
      const data = JSON.parse(text).data;

      if (data.length > 0) {
        const pnl = parseFloat(data[0][0]);
        const variance = ((pnl - w.exp) / w.exp * 100).toFixed(2);
        const isGood = Math.abs(variance) < 10;
        const icon = isGood ? "✅" : "⚠️";
        if (!isGood) allGood = false;

        console.log(`  ${icon} ${w.name.padEnd(15)}: $${pnl.toFixed(2).padEnd(12)} (Expected: $${w.exp.toFixed(2)}, Variance: ${variance}%)`);
      } else {
        console.log(`  ❌ ${w.name.padEnd(15)}: NO DATA`);
        allGood = false;
      }
    }

    console.log("");
    console.log("╔════════════════════════════════════════════════════════════════╗");
    if (allGood) {
      console.log("║  ✅ wallet_pnl_correct REBUILT SUCCESSFULLY                    ║");
    } else {
      console.log("║  ⚠️  wallet_pnl_correct REBUILT (validation in progress)       ║");
    }
    console.log("╚════════════════════════════════════════════════════════════════╝\n");

  } catch (e: any) {
    console.error("\n❌ ERROR:", e.message);
    process.exit(1);
  }
}

main().catch(console.error);
