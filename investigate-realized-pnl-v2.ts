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
  console.log("INVESTIGATING wallet_realized_pnl_v2 DATA SOURCE");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Get view definition
  try {
    const result = await ch.query({
      query: `SELECT create_table_query FROM system.tables 
               WHERE name = 'wallet_realized_pnl_v2' AND database = 'default'`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      console.log("View Definition:\n");
      console.log(data[0][0]);
      console.log("\n");
    }
  } catch (e: any) {
    console.log(`Could not get view definition: ${e.message}\n`);
  }

  // Check actual resolved markets count
  console.log("════════════════════════════════════════════════════════════════\n");
  console.log("Checking resolved markets for niggemon:\n");

  try {
    const result = await ch.query({
      query: `
        SELECT 
          count(DISTINCT p.condition_id_norm) as total_positions,
          countIf(w.win_idx IS NOT NULL) as resolved_positions,
          round(countIf(w.win_idx IS NOT NULL) * 100.0 / count(DISTINCT p.condition_id_norm), 2) as pct_resolved
        FROM outcome_positions_v2 AS p
        LEFT JOIN winning_index AS w ON w.condition_id_norm = p.condition_id_norm
        WHERE lower(p.wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      console.log(`  Total Positions: ${row[0]}`);
      console.log(`  Resolved Positions: ${row[1]}`);
      console.log(`  % Resolved: ${row[2]}%`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
