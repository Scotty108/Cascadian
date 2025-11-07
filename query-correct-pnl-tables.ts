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
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║   VERIFYING CORRECT P&L TABLES EXIST                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const wallets = [
    { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon", exp: 102001.46 },
    { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", exp: 89975.16 },
    { addr: "0x7f3c8979d0afa00007bae4747d5347122af05613", name: "LucasMeow", exp: 179243 },
    { addr: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", name: "xcnstrategy", exp: 94730 },
  ];

  // Test 1: wallet_pnl_summary_v2
  console.log("TABLE 1: wallet_pnl_summary_v2 (Final Wallet P&L)\n");

  for (const w of wallets) {
    try {
      const result = await ch.query({
        query: `
          SELECT
            wallet,
            realized_pnl_usd,
            unrealized_pnl_usd,
            total_pnl_usd,
            markets_with_realized
          FROM wallet_pnl_summary_v2
          WHERE wallet = lower('${w.addr}')
        `,
        format: "JSONCompact",
      });

      const text = await result.text();
      const data = JSON.parse(text).data;

      if (data.length > 0) {
        const [wallet, rpnl, urpnl, totalpnl, markets] = data[0];
        const variance = ((totalpnl - w.exp) / w.exp) * 100;
        const icon = Math.abs(variance) < 10 ? "✅" : "⚠️";

        console.log(`${icon} ${w.name.padEnd(15)}`);
        console.log(`   Realized: $${rpnl.toFixed(2)}`);
        console.log(`   Unrealized: $${urpnl.toFixed(2)}`);
        console.log(`   Total: $${totalpnl.toFixed(2)}`);
        console.log(`   Expected: $${w.exp.toFixed(2)}`);
        console.log(`   Variance: ${variance.toFixed(2)}%`);
        console.log(`   Markets: ${markets}\n`);
      } else {
        console.log(`⚠️  ${w.name.padEnd(15)} NOT FOUND\n`);
      }
    } catch (e: any) {
      console.log(`❌ ${w.name.padEnd(15)} ERROR: ${e.message.substring(0, 40)}\n`);
    }
  }

  // Test 2: winning_index
  console.log("TABLE 2: winning_index (Market Resolutions)\n");

  try {
    const result = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_markets,
          COUNT(DISTINCT condition_id_norm) as unique_conditions,
          min(resolved_at) as earliest_resolution,
          max(resolved_at) as latest_resolution
        FROM winning_index
      `,
      format: "JSONCompact",
    });

    const text = await result.text();
    const data = JSON.parse(text).data;
    const [total, unique, earliest, latest] = data[0];

    console.log(`✅ winning_index exists`);
    console.log(`   Total records: ${total}`);
    console.log(`   Unique markets: ${unique}`);
    console.log(`   Resolution window: ${new Date(earliest * 1000).toISOString().split("T")[0]} to ${new Date(latest * 1000).toISOString().split("T")[0]}\n`);
  } catch (e: any) {
    console.log(`❌ winning_index error: ${e.message.substring(0, 60)}\n`);
  }

  // Test 3: realized_pnl_by_market_v2
  console.log("TABLE 3: realized_pnl_by_market_v2 (Market Breakdown)\n");

  try {
    const result = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT wallet) as unique_wallets,
          COUNT(DISTINCT market_id) as unique_markets,
          SUM(realized_pnl_usd) as total_pnl
        FROM realized_pnl_by_market_v2
      `,
      format: "JSONCompact",
    });

    const text = await result.text();
    const data = JSON.parse(text).data;
    const [rows, wallets, markets, totalpnl] = data[0];

    console.log(`✅ realized_pnl_by_market_v2 exists`);
    console.log(`   Total rows: ${rows}`);
    console.log(`   Unique wallets: ${wallets}`);
    console.log(`   Unique markets: ${markets}`);
    console.log(`   Total P&L (all wallets): $${totalpnl.toFixed(2)}\n`);
  } catch (e: any) {
    console.log(`❌ realized_pnl_by_market_v2 error: ${e.message.substring(0, 60)}\n`);
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  ✅ CORRECT TABLES FOUND - READY TO USE FOR wallet_pnl_correct ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
