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
  console.log("DIAGNOSTIC STEP 1: KEY NORMALIZATION AUDIT");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    console.log("🔍 Checking if outcome_positions_v2 and winning_index join correctly...\n");

    const result = await ch.query({
      query: `
        SELECT
          count() AS pos_rows,
          countIf(w.condition_id_norm IS NULL) AS pos_without_winner
        FROM outcome_positions_v2 AS p
        LEFT JOIN winning_index AS w
          ON p.condition_id_norm = w.condition_id_norm
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data[0]) {
      const posRows = data[0][0];
      const posWithoutWinner = data[0][1];
      const unMatchedRatio = (posWithoutWinner / posRows * 100).toFixed(2);

      console.log(`📊 RESULTS:`);
      console.log(`   Total outcome_positions_v2 rows: ${posRows}`);
      console.log(`   Rows without matching winning_index: ${posWithoutWinner}`);
      console.log(`   Unmatched ratio: ${unMatchedRatio}%\n`);

      if (parseFloat(unMatchedRatio) > 2) {
        console.log(`❌ FAIL: Unmatched ratio ${unMatchedRatio}% > 2%`);
        console.log(`   This indicates a key normalization problem.`);
        console.log(`   STOP HERE. Need to fix condition_id_norm normalization.\n`);
      } else {
        console.log(`✅ PASS: Unmatched ratio ${unMatchedRatio}% <= 2%`);
        console.log(`   Key normalization is working correctly.`);
        console.log(`   PROCEED to Step 2: Index Alignment Audit\n`);
      }
    }

  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
