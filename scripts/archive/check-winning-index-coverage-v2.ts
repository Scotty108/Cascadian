#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n📊 WINNING_INDEX COVERAGE ANALYSIS\n");
  
  // Total unique conditions in positions vs winning_index
  const posCount = await queryData(`SELECT COUNT(DISTINCT condition_id_norm) FROM outcome_positions_v2`);
  const winCount = await queryData(`SELECT COUNT(*) FROM winning_index`);
  const winDistinct = await queryData(`SELECT COUNT(DISTINCT condition_id_norm) FROM winning_index`);
  
  console.log("Coverage:");
  console.log(`  outcome_positions_v2: ${posCount[0][0]} unique conditions`);
  console.log(`  winning_index: ${winCount[0][0]} rows (${winDistinct[0][0]} unique conditions)`);
  
  // Check overlap
  const overlap = await queryData(`
    SELECT COUNT(*) FROM (
      SELECT DISTINCT p.condition_id_norm FROM outcome_positions_v2 p
      INNER JOIN winning_index w ON p.condition_id_norm = w.condition_id_norm
    )
  `);
  
  const coverage = (overlap[0][0] / posCount[0][0] * 100).toFixed(1);
  console.log(`  Overlap (exact match): ${overlap[0][0]} conditions (${coverage}%)`);
  
  // Check if niggemon's conditions are in winning_index
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const niggemonInWin = await queryData(`
    SELECT COUNT(*) FROM outcome_positions_v2 p
    WHERE p.wallet = lower('${wallet}')
    AND p.condition_id_norm IN (SELECT condition_id_norm FROM winning_index)
  `);
  
  const niggemonTotal = await queryData(`
    SELECT COUNT(*) FROM outcome_positions_v2 p
    WHERE p.wallet = lower('${wallet}')
  `);
  
  const niggemonCoverage = (niggemonInWin[0][0] / niggemonTotal[0][0] * 100).toFixed(1);
  console.log(`  Niggemon coverage: ${niggemonInWin[0][0]}/${niggemonTotal[0][0]} conditions (${niggemonCoverage}%)`);
  
  console.log("\n❌ CRITICAL ISSUE: winning_index is missing data for many conditions!");
  console.log("   This prevents P&L calculation for unresolved conditions.");
}

main();
