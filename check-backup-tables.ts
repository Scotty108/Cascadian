#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 30000,
});

async function queryData(query: string, name: string) {
  try {
    console.log(`\n[${name}]`);
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    if (data.length > 0) {
      console.log(`  Sample row: wallet=${data[0][0]?.substring(0,20)}, condition_id_norm=${data[0][1]?.substring(0,30) || '(empty)'}, ...`);
    }
    return data;
  } catch (e: any) {
    console.error(`  ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("🔍 CHECKING BACKUP TABLES\n");
  
  await queryData("SELECT * FROM outcome_positions_v2_backup_20251107T071726 LIMIT 1", "outcome_positions_v2_backup");
  await queryData("SELECT * FROM trade_cashflows_v3_backup_20251107T071726 LIMIT 1", "trade_cashflows_v3_backup");
  
  console.log("\nNOTE: If backups are also empty, the original tables were broken before the swap.");
}

main();
