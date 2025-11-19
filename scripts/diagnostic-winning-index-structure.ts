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
  console.log("DIAGNOSTIC: WINNING_INDEX STRUCTURE (Root Cause of Join Explosion)");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    // Check for duplicate condition_id_norm entries
    console.log("1️⃣  CHECKING FOR DUPLICATES IN WINNING_INDEX:\n");

    const dupCheck = await ch.query({
      query: `
        SELECT
          count() as total_rows,
          count(DISTINCT condition_id_norm) as unique_conditions,
          max(rows_per_condition) as max_duplication_factor
        FROM (
          SELECT condition_id_norm, count() as rows_per_condition
          FROM winning_index
          GROUP BY condition_id_norm
        )
      `,
      format: "JSONCompact"
    });

    const dupText = await dupCheck.text();
    const dupData = JSON.parse(dupText).data || [];

    if (dupData[0]) {
      const totalRows = dupData[0][0];
      const uniqueConds = dupData[0][1];
      const maxDups = dupData[0][2];
      const avgDups = (totalRows / uniqueConds).toFixed(2);

      console.log(`   Total rows in winning_index: ${totalRows}`);
      console.log(`   Unique condition_id_norm: ${uniqueConds}`);
      console.log(`   Max rows per condition: ${maxDups}`);
      console.log(`   Avg rows per condition: ${avgDups}\n`);

      if (maxDups > 1) {
        console.log(`🚨 FOUND THE PROBLEM: winning_index has ${maxDups} rows per condition!`);
        console.log(`   This creates ${totalRows * 8.3} million row Cartesian product.\n`);
      }
    }

    // Show examples of duplicated conditions
    console.log("2️⃣  EXAMPLES OF DUPLICATED CONDITIONS:\n");

    const examples = await ch.query({
      query: `
        SELECT condition_id_norm, count() as dup_count
        FROM winning_index
        GROUP BY condition_id_norm
        HAVING count() > 1
        ORDER BY dup_count DESC
        LIMIT 5
      `,
      format: "JSONCompact"
    });

    const exText = await examples.text();
    const exData = JSON.parse(exText).data || [];

    if (exData.length > 0) {
      exData.forEach((row: any) => {
        console.log(`   ${row[0].substring(0, 20)}... : ${row[1]} duplicates`);
      });
      console.log("");
    }

    // Examine one duplicated condition
    if (exData.length > 0) {
      const testCondition = exData[0][0];
      console.log(`3️⃣  EXAMINING DUPLICATION FOR ONE CONDITION:\n`);
      console.log(`   condition_id_norm: ${testCondition}\n`);

      const detailed = await ch.query({
        query: `
          SELECT
            win_idx,
            resolved_at,
            max_price,
            min_price,
            row_number() OVER () as row_num
          FROM winning_index
          WHERE condition_id_norm = '${testCondition}'
          ORDER BY resolved_at
        `,
        format: "JSONCompact"
      });

      const detText = await detailed.text();
      const detData = JSON.parse(detText).data || [];

      detData.forEach((row: any, idx: number) => {
        console.log(`   Row ${idx + 1}: win_idx=${row[0]}, resolved_at=${row[1]}, max_price=${row[2]}, min_price=${row[3]}`);
      });

      console.log(`\n   ⚠️  Multiple rows suggest resolution updates or incremental inserts.`);
      console.log(`   SOLUTION: Use DISTINCT ON (condition_id_norm) or GROUP BY with max(resolved_at)\n`);
    }

  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
