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
  console.log("COMPARING P&L VALUES ACROSS ALL TABLES");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  console.log("From wallet_pnl_correct:\n");
  try {
    const result = await ch.query({
      query: `
        SELECT
          lower(wallet_address) as wallet,
          round(realized_pnl, 2) as realized_pnl,
          round(unrealized_pnl, 2) as unrealized_pnl,
          round(net_pnl, 2) as net_pnl
        FROM wallet_pnl_correct
        WHERE lower(wallet_address) IN (lower('${niggemon}'), lower('${holymoses}'))
      `,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const wallet = row[0].substring(0, 12) + "...";
      const realized = parseFloat(row[1]);
      const unrealized = parseFloat(row[2]);
      const net = parseFloat(row[3]);

      console.log(`${wallet}: Realized=$${realized.toFixed(2)}, Unrealized=$${unrealized.toFixed(2)}, Net=$${net.toFixed(2)}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message.split('\n')[0]}`);
  }

  console.log("\nFrom wallet_pnl_summary_final:\n");
  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          round(realized_pnl_usd, 2) as realized_pnl,
          round(unrealized_pnl_usd, 2) as unrealized_pnl,
          round(total_pnl_usd, 2) as net_pnl
        FROM wallet_pnl_summary_final
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
      `,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const wallet = row[0].substring(0, 12) + "...";
      const realized = parseFloat(row[1]);
      const unrealized = parseFloat(row[2]);
      const net = parseFloat(row[3]);

      console.log(`${wallet}: Realized=$${realized.toFixed(2)}, Unrealized=$${unrealized.toFixed(2)}, Net=$${net.toFixed(2)}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message.split('\n')[0]}`);
  }

  console.log("\nFrom trades_raw (direct sum of realized_pnl_usd field):\n");
  try {
    const result = await ch.query({
      query: `
        SELECT
          lower(wallet_address) as wallet,
          round(sum(toFloat64(realized_pnl_usd)), 2) as total_pnl,
          countIf(was_win = true) as win_count,
          countIf(was_win = false) as loss_count,
          count() as total_trades
        FROM trades_raw
        WHERE is_resolved = 1 AND lower(wallet_address) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY wallet
      `,
      format: "JSONCompact"
    });
    
    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const wallet = row[0].substring(0, 12) + "...";
      const pnl = parseFloat(row[1]);
      const wins = parseInt(row[2]);
      const losses = parseInt(row[3]);
      const total = parseInt(row[4]);

      console.log(`${wallet}: P&L=$${pnl.toFixed(2)}, Wins=${wins}, Losses=${losses}, Total=${total}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message.split('\n')[0]}`);
  }

  console.log("\n" + "═".repeat(70));
  console.log("Expected: niggemon ≈ $102,001, HolyMoses7 ≈ $89,975");
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
