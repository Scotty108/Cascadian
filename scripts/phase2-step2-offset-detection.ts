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
  console.log("PHASE 2 STEP 2: DETECT INDEX OFFSET");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    const result = await ch.query({
      query: `
        WITH p AS (
          SELECT lower(replaceAll(condition_id_norm,'0x','')) AS cid, toInt16(outcome_idx) AS oidx
          FROM outcome_positions_v2
        ),
        w AS (
          SELECT lower(replaceAll(condition_id_norm,'0x','')) AS cid, toInt16(win_idx) AS widx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        )
        SELECT
          sum(oidx = widx)        AS exact_match,
          sum(oidx = widx + 1)    AS off_by_plus1,
          sum(oidx + 1 = widx)    AS off_by_minus1
        FROM p
        LEFT JOIN w USING (cid)
        WHERE w.cid IS NOT NULL
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      const row = data[0];
      const exact = parseInt(row[0]);
      const plus1 = parseInt(row[1]);
      const minus1 = parseInt(row[2]);

      console.log("Index Offset Analysis:");
      console.log("─".repeat(70));
      console.log(`  Exact match (oidx = widx):     ${exact.toLocaleString()}`);
      console.log(`  Off by +1   (oidx = widx + 1): ${plus1.toLocaleString()}`);
      console.log(`  Off by -1   (oidx + 1 = widx): ${minus1.toLocaleString()}`);

      const total = exact + plus1 + minus1;
      const exactPct = ((exact / total) * 100).toFixed(2);
      const plus1Pct = ((plus1 / total) * 100).toFixed(2);
      const minus1Pct = ((minus1 / total) * 100).toFixed(2);

      console.log("\nPercentages:");
      console.log("─".repeat(70));
      console.log(`  Exact match: ${exactPct}%`);
      console.log(`  Off by +1:   ${plus1Pct}%`);
      console.log(`  Off by -1:   ${minus1Pct}%`);

      console.log("\n" + "═".repeat(70));
      
      let offset = -1;
      if (plus1 > exact && plus1 > minus1) {
        offset = 1;
        console.log(`✅ OFFSET DETECTED: +1 (off_by_plus1 dominates with ${plus1Pct}%)`);
      } else if (exact > plus1 && exact > minus1) {
        offset = 0;
        console.log(`✅ OFFSET DETECTED: 0 (exact_match dominates with ${exactPct}%)`);
      } else if (minus1 > exact && minus1 > plus1) {
        offset = -1;
        console.log(`✅ OFFSET DETECTED: -1 (off_by_minus1 dominates with ${minus1Pct}%)`);
      } else {
        console.log(`⚠️  NO CLEAR DOMINANT PATTERN`);
      }

      console.log(`\nUse OFFSET = ${offset} in remaining steps`);
      console.log("═".repeat(70) + "\n");
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
