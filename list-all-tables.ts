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
  try {
    const tables = await ch.query({
      query: "SELECT name FROM system.tables WHERE database='default' ORDER BY name",
      format: "JSONCompact"
    });

    const text = await tables.text();
    const data = JSON.parse(text).data || [];

    console.log("\n════════════════════════════════════════════════════════════════");
    console.log(`COMPLETE TABLE LIST (${data.length} tables)`);
    console.log("════════════════════════════════════════════════════════════════\n");

    // Group by category
    const pnl = [];
    const wallet = [];
    const trade = [];
    const market = [];
    const other = [];

    for (const row of data) {
      const name = row[0];
      if (name.includes('pnl')) pnl.push(name);
      else if (name.includes('wallet')) wallet.push(name);
      else if (name.includes('trade')) trade.push(name);
      else if (name.includes('market') || name.includes('resolution') || name.includes('outcome')) market.push(name);
      else other.push(name);
    }

    if (pnl.length > 0) {
      console.log("P&L TABLES:");
      pnl.forEach(t => console.log(`  • ${t}`));
      console.log();
    }

    if (wallet.length > 0) {
      console.log("WALLET TABLES:");
      wallet.forEach(t => console.log(`  • ${t}`));
      console.log();
    }

    if (trade.length > 0) {
      console.log("TRADE TABLES:");
      trade.forEach(t => console.log(`  • ${t}`));
      console.log();
    }

    if (market.length > 0) {
      console.log("MARKET/RESOLUTION TABLES:");
      market.forEach(t => console.log(`  • ${t}`));
      console.log();
    }

    if (other.length > 0) {
      console.log("OTHER TABLES:");
      other.forEach(t => console.log(`  • ${t}`));
    }

    console.log("\n════════════════════════════════════════════════════════════════\n");
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main().catch(console.error);
