import { createClient } from "@clickhouse/client";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: "/Users/scotty/Projects/Cascadian-app/.env.local" });

async function runAudit() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || "default",
  });

  const results = {};
  try {
    // Get all the row counts
    const queries = [
      { key: "trades_raw", query: "SELECT count() as cnt FROM default.trades_raw" },
      { key: "vw_trades_canonical", query: "SELECT count() as cnt FROM default.vw_trades_canonical" },
      { key: "trade_direction_assignments", query: "SELECT count() as cnt FROM default.trade_direction_assignments" },
      { key: "trades_with_direction", query: "SELECT count() as cnt FROM default.trades_with_direction" },
    ];

    console.log("COLLECTING TABLE COUNTS...\n");
    for (const q of queries) {
      const res = await client.query({ query: q.query });
      const data = await res.json();
      results[q.key] = parseInt(data.data[0].cnt);
      console.log(q.key + ": " + results[q.key]);
    }

    // Loss analysis
    const trRaw = results.trades_raw;
    const trDir = results.trade_direction_assignments;
    const trWith = results.trades_with_direction;

    console.log("\nLOSS ANALYSIS:");
    console.log("trades_raw -> direction_assignments: " + trRaw + " -> " + trDir + " (loss: " + (trRaw - trDir) + ")");
    console.log("direction_assignments -> with_direction: " + trDir + " -> " + trWith + " (loss: " + (trDir - trWith) + ")");
    console.log("TOTAL: " + trRaw + " -> " + trWith + " (loss: " + (trRaw - trWith) + ")");

    // Write JSON results
    fs.writeFileSync("/tmp/audit_results.json", JSON.stringify(results, null, 2));
    console.log("\nResults saved to /tmp/audit_results.json");

  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    await client.close();
  }
}

runAudit();
