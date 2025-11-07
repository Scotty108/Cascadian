#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n🔍 DEBUGGING: Check resolved markets\n");

  // Check how many markets are resolved
  try {
    const resolved = await queryData(`SELECT count() as cnt FROM winning_index`);
    console.log(`Markets with winning_index: ${resolved[0]?.cnt || 0}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check a sample winning market
  try {
    const sample = await queryData(`
      SELECT 
        condition_id_norm,
        win_idx,
        resolved_at
      FROM winning_index
      LIMIT 5
    `);
    console.log("\nSample winning markets:");
    console.log(JSON.stringify(sample, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check if the two wallets have positions in these markets
  try {
    const posCount = await queryData(`
      SELECT count() as cnt
      FROM outcome_positions_v2
      WHERE wallet IN ('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
    `);
    console.log(`\nHolyMoses7 positions: ${posCount[0]?.cnt || 0}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Check intersection of positions and resolved markets
  try {
    const intersection = await queryData(`
      SELECT count() as cnt
      FROM outcome_positions_v2 p
      ANY LEFT JOIN winning_index w ON lower(replaceAll(w.condition_id_norm,'0x','')) = lower(replaceAll(p.condition_id_norm,'0x',''))
      WHERE p.wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
        AND w.win_idx IS NOT NULL
    `);
    console.log(`HolyMoses7 positions in resolved markets: ${intersection[0]?.cnt || 0}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }
}

main().catch(console.error);
