#!/usr/bin/env npx tsx
/**
 * Step 5: Outcome Mapping Sanity Check
 * Verifies that resolved outcomes correctly map to indices
 * Spot-checks 10 random conditions to ensure alignment
 */
import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

async function main() {
  console.log("════════════════════════════════════════════════════════");
  console.log("STEP 5: OUTCOME MAPPING SANITY CHECK");
  console.log("════════════════════════════════════════════════════════\n");

  try {
    // Get 10 random resolved conditions from the canonical resolution table
    const sample_result = await ch.query({
      query: `
        SELECT
          condition_id_norm,
          winning_outcome,
          winning_index,
          resolved_at
        FROM market_resolutions_final
        WHERE winning_outcome IS NOT NULL
        ORDER BY rand()
        LIMIT 10
      `,
      format: "TabSeparated"
    });
    const sample_text = await sample_result.text();
    const conditions = sample_text.trim().split("\n");

    console.log(`Found ${conditions.length} resolved conditions. Testing mapping...\n`);

    let passed = 0;
    let failed = 0;

    for (const line of conditions) {
      if (!line.trim()) continue; // skip empty lines

      const [condition_id_norm, winning_outcome, winning_index_str, resolved_at] = line.split("\t");
      const winning_index_num = parseInt(winning_index_str, 10);

      console.log(`Condition: ${condition_id_norm.substring(0, 16)}...`);
      console.log(`  Winning Outcome (text): "${winning_outcome}"`);
      console.log(`  Winning Index (num): ${winning_index_num}`);
      console.log(`  Resolved: ${resolved_at}`);

      // Now look up the outcome text at that index from market_outcomes
      const lookup_result = await ch.query({
        query: `
          SELECT
            arrayElement(outcomes, ${winning_index_num + 1}) AS outcome_at_index
          FROM market_outcomes
          WHERE condition_id_norm = '${condition_id_norm}'
          LIMIT 1
        `,
        format: "TabSeparated"
      });
      const lookup_text = await lookup_result.text().catch(() => "");
      const outcome_at_index = lookup_text.trim() || "[NOT FOUND]";

      console.log(`  Outcome at index ${winning_index_num}: "${outcome_at_index}"`);

      // Check if they match (case-insensitive)
      const match = outcome_at_index.toLowerCase() === winning_outcome.toLowerCase();
      console.log(`  ${match ? "✅ MATCH" : "❌ MISMATCH"}\n`);

      if (match) {
        passed++;
      } else {
        failed++;
      }
    }

    console.log("════════════════════════════════════════════════════════");
    console.log(`Spot checks: ${passed} passed, ${failed} failed`);

    if (failed === 0) {
      console.log("✅ All outcome mappings correct!");
      console.log("Ready for Step 6: Fanout control guardrails");
    } else {
      console.log("❌ Outcome mapping errors detected. Review before proceeding.");
    }
  } catch (error: any) {
    console.error("❌ Error:", error.message);
  }

  process.exit(0);
}

main();
