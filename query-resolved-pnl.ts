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
  const wallets = [
    { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon", exp: 102001.46 },
    { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", exp: 89975.16 }
  ];

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  QUERYING RESOLVED_TRADES_V2 FOR P&L                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  for (const w of wallets) {
    const result = await ch.query({
      query: `
        SELECT
          count() as trade_count,
          sum(realized_pnl_usd) as total_pnl,
          count(DISTINCT cid) as unique_markets
        FROM resolved_trades_v2
        WHERE wallet_address = lower('${w.addr}')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data;
    const [count, pnl, markets] = data[0];

    const variance = ((pnl - w.exp) / w.exp * 100).toFixed(2);
    const isGood = Math.abs(variance) < 10;
    const icon = isGood ? "✅" : "❌";

    console.log(`${icon} ${w.name.padEnd(15)}`);
    console.log(`   Trades: ${count} | Markets: ${markets}`);
    console.log(`   Actual P&L: $${pnl?.toFixed(2) || '0.00'}`);
    console.log(`   Target P&L: $${w.exp.toFixed(2)}`);
    console.log(`   Variance: ${variance}%\n`);
  }

  // Also check trades_raw with is_resolved = 1
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  COMPARING WITH trades_raw (is_resolved=1)                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  for (const w of wallets) {
    const result = await ch.query({
      query: `
        SELECT
          count() as trade_count,
          sum(toFloat64(realized_pnl_usd)) as total_pnl,
          count(DISTINCT condition_id) as unique_markets
        FROM trades_raw
        WHERE wallet_address = lower('${w.addr}')
          AND is_resolved = 1
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data;
    const [count, pnl, markets] = data[0];

    const variance = ((pnl - w.exp) / w.exp * 100).toFixed(2);
    const isGood = Math.abs(variance) < 10;
    const icon = isGood ? "✅" : "❌";

    console.log(`${icon} ${w.name.padEnd(15)}`);
    console.log(`   Trades: ${count} | Markets: ${markets}`);
    console.log(`   Actual P&L: $${pnl?.toFixed(2) || '0.00'}`);
    console.log(`   Target P&L: $${w.exp.toFixed(2)}`);
    console.log(`   Variance: ${variance}%\n`);
  }
}

main().catch(console.error);
