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
  console.log("\n🔍 INVESTIGATING FORMAT MISMATCH\n");

  // Check if market_resolutions_final has all of niggemon's conditions
  const result = await ch.query({
    query: `
      SELECT COUNT(*) FROM (
        SELECT DISTINCT p.condition_id_norm FROM outcome_positions_v2 p
        WHERE p.wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      ) p
      LEFT JOIN (
        SELECT DISTINCT condition_id_norm FROM market_resolutions_final
      ) m ON toString(m.condition_id_norm) = p.condition_id_norm
      WHERE m.condition_id_norm IS NULL
    `,
    format: "JSONCompact"
  });
  
  const text = await result.text();
  const data = JSON.parse(text).data;
  const missing = data[0][0];
  
  console.log(`Niggemon's conditions missing from market_resolutions_final: ${missing}`);
  
  // Check outcome_positions data types
  const schema = await ch.query({
    query: "SELECT toTypeName(condition_id_norm) FROM outcome_positions_v2 LIMIT 1",
    format: "JSONCompact"
  });
  
  const schemaText = await schema.text();
  const schemaData = JSON.parse(schemaText).data;
  console.log(`\noutcome_positions_v2.condition_id_norm type: ${schemaData[0][0]}`);
  
  const schemaWin = await ch.query({
    query: "SELECT toTypeName(condition_id_norm) FROM winning_index LIMIT 1",
    format: "JSONCompact"
  });
  
  const schemaWinText = await schemaWin.text();
  const schemaWinData = JSON.parse(schemaWinText).data;
  console.log(`winning_index.condition_id_norm type: ${schemaWinData[0][0]}`);
}

main().catch(console.error);
