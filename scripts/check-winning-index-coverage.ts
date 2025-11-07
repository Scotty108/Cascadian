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
  const wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';

  console.log("\n🔍 CHECK WINNING_INDEX COVERAGE\n");

  // Count distinct conditions in positions
  try {
    const posConditions = await queryData(`
      SELECT count(DISTINCT condition_id_norm) as cnt
      FROM outcome_positions_v2
      WHERE wallet = lower('${wallet}')
    `);
    console.log(`Conditions in wallet positions: ${posConditions[0]?.cnt}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Count how many of those have winning_index entries
  try {
    const withWinning = await queryData(`
      SELECT count(DISTINCT p.condition_id_norm) as cnt
      FROM outcome_positions_v2 p
      LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      WHERE p.wallet = lower('${wallet}')
        AND w.condition_id_norm IS NOT NULL
    `);
    console.log(`Conditions with winning_index: ${withWinning[0]?.cnt}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }

  // Show conditions that DON'T have winning index entries
  try {
    const missing = await queryData(`
      SELECT DISTINCT p.condition_id_norm
      FROM outcome_positions_v2 p
      LEFT JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
      WHERE p.wallet = lower('${wallet}')
        AND w.condition_id_norm IS NULL
      LIMIT 10
    `);
    console.log(`\nSample conditions without winning_index:\n${missing.map((m: any) => m.condition_id_norm).join('\n')}`);
  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 100));
  }
}

main().catch(console.error);
