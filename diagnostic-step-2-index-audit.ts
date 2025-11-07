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
  console.log("DIAGNOSTIC STEP 2: INDEX ALIGNMENT AUDIT");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    console.log("🔍 Testing outcome_idx vs win_idx alignment...\n");

    const result = await ch.query({
      query: `
        SELECT
          sum(p.outcome_idx = w.win_idx) AS exact_match,
          sum(p.outcome_idx = w.win_idx + 1) AS off_by_plus1,
          sum(p.outcome_idx + 1 = w.win_idx) AS off_by_minus1
        FROM outcome_positions_v2 p
        JOIN winning_index w USING (condition_id_norm)
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data[0]) {
      const exactMatch = data[0][0];
      const offByPlus1 = data[0][1];
      const offByMinus1 = data[0][2];
      const totalRows = exactMatch + offByPlus1 + offByMinus1;

      const exactPct = (exactMatch / totalRows * 100).toFixed(2);
      const plus1Pct = (offByPlus1 / totalRows * 100).toFixed(2);
      const minus1Pct = (offByMinus1 / totalRows * 100).toFixed(2);

      console.log(`📊 INDEX ALIGNMENT RESULTS:`);
      console.log(`   Total joined rows: ${totalRows}`);
      console.log(`   outcome_idx = win_idx (EXACT MATCH): ${exactMatch} (${exactPct}%)`);
      console.log(`   outcome_idx = win_idx + 1: ${offByPlus1} (${plus1Pct}%)`);
      console.log(`   outcome_idx + 1 = win_idx: ${offByMinus1} (${minus1Pct}%)\n`);

      // Determine dominant convention
      const sorted = [
        { name: "EXACT_MATCH", count: exactMatch, pct: parseFloat(exactPct) },
        { name: "OFF_BY_PLUS1", count: offByPlus1, pct: parseFloat(plus1Pct) },
        { name: "OFF_BY_MINUS1", count: offByMinus1, pct: parseFloat(minus1Pct) }
      ].sort((a, b) => b.count - a.count);

      const dominant = sorted[0];
      if (dominant.pct > 95) {
        console.log(`✅ DOMINANT CONVENTION: ${dominant.name} (${dominant.pct.toFixed(1)}%)`);
        console.log(`   This is the index convention to use in the settlement formula.\n`);
      } else {
        console.log(`⚠️  NO CLEAR DOMINANT CONVENTION`);
        console.log(`   Multiple conventions present. May indicate mixed data or version mismatch.\n`);
      }

      console.log(`🎯 CONCLUSION:`);
      if (dominant.pct < 90) {
        console.log(`   ❌ FAIL: Index mismatch detected. Need to normalize before proceeding.`);
        console.log(`   Fix: Adjust outcome_idx or win_idx to match dominant pattern.\n`);
      } else {
        console.log(`   ✅ PASS: Strong alignment detected.`);
        console.log(`   PROCEED to Step 3: Cashflow Source Sanity\n`);
      }
    }

  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
