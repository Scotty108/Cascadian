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
  console.log("DIAGNOSTIC: OUTCOME_POSITIONS_V2 STRUCTURE");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    // First get overall stats
    console.log("1️⃣  OVERALL STATS:\n");

    const statsResult = await ch.query({
      query: `
        SELECT
          count() as total_rows,
          count(DISTINCT condition_id_norm) as unique_conditions,
          count(DISTINCT wallet) as unique_wallets,
          count(DISTINCT outcome_idx) as unique_outcome_idx
        FROM outcome_positions_v2
      `,
      format: "JSONCompact"
    });

    const statsText = await statsResult.text();
    const statsData = JSON.parse(statsText).data || [];

    if (statsData[0]) {
      console.log(`   Total rows: ${statsData[0][0]}`);
      console.log(`   Unique conditions: ${statsData[0][1]}`);
      console.log(`   Unique wallets: ${statsData[0][2]}`);
      console.log(`   Unique outcome_idx values: ${statsData[0][3]}\n`);
    }

    // Check aggregation level
    console.log("2️⃣  CHECKING AGGREGATION LEVEL:\n");

    const aggResult = await ch.query({
      query: `
        SELECT
          max(rows_per_combo) as max_rows,
          min(rows_per_combo) as min_rows,
          round(avg(rows_per_combo), 2) as avg_rows
        FROM (
          SELECT count() as rows_per_combo
          FROM outcome_positions_v2
          GROUP BY condition_id_norm, wallet, outcome_idx
        )
      `,
      format: "JSONCompact"
    });

    const aggText = await aggResult.text();
    const aggData = JSON.parse(aggText).data || [];

    if (aggData[0]) {
      console.log(`   Max rows per (condition, wallet, outcome_idx): ${aggData[0][0]}`);
      console.log(`   Min rows per (condition, wallet, outcome_idx): ${aggData[0][1]}`);
      console.log(`   Avg rows per (condition, wallet, outcome_idx): ${aggData[0][2]}\n`);
    }

    // Estimate join size
    console.log("3️⃣  JOIN SIZE ESTIMATE:\n");

    const estResult = await ch.query({
      query: `
        SELECT
          count(DISTINCT condition_id_norm, wallet, outcome_idx) as grouped_rows
        FROM outcome_positions_v2
      `,
      format: "JSONCompact"
    });

    const estText = await estResult.text();
    const estData = JSON.parse(estText).data || [];

    if (estData[0]) {
      const groupedRows = estData[0][0];
      console.log(`   When grouped by (condition, wallet, outcome_idx): ${groupedRows}`);
      console.log(`   Expected join size with winning_index: ${groupedRows} (137K unique conditions)`);
      console.log(`   Actual join result: 3.6T rows\n`);
      console.log(`   ⚠️  This suggests multiple outcome_positions per combination.\n`);
    }

    // Show sample of raw data
    console.log("4️⃣  SAMPLE 10 ROWS:\n");

    const sampleResult = await ch.query({
      query: `
        SELECT
          condition_id_norm,
          wallet,
          outcome_idx,
          shares_at_resolution
        FROM outcome_positions_v2
        LIMIT 10
      `,
      format: "JSONCompact"
    });

    const sampleText = await sampleResult.text();
    const sampleData = JSON.parse(sampleText).data || [];

    console.log(`   condition_id | wallet | outcome_idx | shares`);
    sampleData.forEach((row: any) => {
      const cond = row[0].substring(0, 8);
      const wal = row[1].substring(0, 6);
      console.log(`   ${cond}... | ${wal}... | ${row[2]} | ${row[3]}`);
    });

  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
