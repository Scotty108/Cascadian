#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function queryData(query: string, name: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    const data = JSON.parse(text).data || [];
    console.log(`\n[${name}] Rows: ${data.length}`);
    if (data.length > 0) {
      console.log(`  Sample:`, JSON.stringify(data.slice(0, 2)));
    }
    return data;
  } catch (e: any) {
    console.error(`  ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  
  console.log("🔍 DEBUGGING REBUILT winning_index\n");
  
  // Check niggemon positions
  await queryData(`
    SELECT condition_id_norm FROM outcome_positions_v2 
    WHERE wallet = lower('${wallet}')
    LIMIT 5
  `, "Niggemon's condition_id_norms");
  
  // Check if those conditions exist in new winning_index
  await queryData(`
    SELECT 
      p.condition_id_norm as p_cid,
      w.condition_id_norm as w_cid,
      w.win_idx
    FROM outcome_positions_v2 p
    LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
    WHERE p.wallet = lower('${wallet}')
    LIMIT 10
  `, "Join test with new winning_index (direct match)");
  
  // Check if they match after trimming/conversion
  await queryData(`
    SELECT COUNT(*) FROM outcome_positions_v2 p
    WHERE p.wallet = lower('${wallet}')
    AND p.condition_id_norm IN (SELECT condition_id_norm FROM winning_index)
  `, "Direct IN check");
}

main();
