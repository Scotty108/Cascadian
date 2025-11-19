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
    console.log(`\n[${name}]`);
    if (data.length > 0) {
      console.log(`  Data:`, JSON.stringify(data.slice(0, 3)));
    } else {
      console.log("  (no data)");
    }
    return data;
  } catch (e: any) {
    console.error(`  ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  
  console.log("🔍 INVESTIGATING WINNING_INDEX DATA\n");
  
  // Check winning_index schema and samples
  const schema = await ch.query({
    query: "DESC winning_index",
    format: "JSONCompact"
  });
  const schemaText = await schema.text();
  const schemaData = JSON.parse(schemaText).data || [];
  
  console.log("winning_index schema:");
  for (const row of schemaData) {
    console.log(`  ${row[0]}: ${row[1]}`);
  }
  
  // Sample winning_index rows
  await queryData(`SELECT * FROM winning_index LIMIT 5`, "Sample winning_index rows");
  
  // Check conditions that niggemon has positions in
  await queryData(`
    SELECT DISTINCT condition_id_norm FROM outcome_positions_v2 
    WHERE wallet = lower('${wallet}')
    LIMIT 5
  `, "Niggemon's condition_id_norms (first 5)");
  
  // Check if those conditions exist in winning_index
  await queryData(`
    SELECT 
      p.condition_id_norm,
      w.condition_id_norm,
      w.win_idx
    FROM outcome_positions_v2 p
    LEFT JOIN winning_index w ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE p.wallet = lower('${wallet}')
    LIMIT 10
  `, "Join test: niggemon positions with winning_index");
}

main();
