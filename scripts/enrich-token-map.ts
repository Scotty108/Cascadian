#!/usr/bin/env npx tsx

/**
 * =====================================================================
 * ENRICH CTF_TOKEN_MAP WITH MARKET DATA
 * =====================================================================
 *
 * This script updates ctf_token_map by joining with gamma_markets
 * to add market_id, outcome, and question fields.
 *
 * It handles the mapping of condition_id -> market_id -> outcomes array
 * and updates each token with its corresponding outcome label.
 *
 * Run with: npx tsx scripts/enrich-token-map.ts
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
  compression: { response: true },
});

async function main() {
  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`Enriching ctf_token_map with Market Data`);
  console.log(`════════════════════════════════════════════════════════════════════\n`);

  try {
    // ========================================================================
    // STEP 1: Verify tables exist
    // ========================================================================
    console.log("Verifying required tables...");

    const checkTables = async (tableName: string) => {
      const rs = await ch.query({
        query: `SELECT 1 FROM system.tables WHERE database = currentDatabase() AND name = {table:String} FORMAT JSONEachRow`,
        query_params: { table: tableName },
      });
      const text = await rs.text();
      return text.trim().length > 0;
    };

    const tokenMapExists = await checkTables("ctf_token_map");
    const gammaMarketsExists = await checkTables("gamma_markets");

    if (!tokenMapExists) {
      console.log("❌ ctf_token_map table not found. Exiting.");
      process.exit(1);
    }

    if (!gammaMarketsExists) {
      console.log("❌ gamma_markets table not found. Exiting.");
      process.exit(1);
    }

    console.log("✅ Both tables exist\n");

    // ========================================================================
    // STEP 2: Check current state of ctf_token_map
    // ========================================================================
    console.log("Checking current state of ctf_token_map...");

    const countRs = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM ctf_token_map FORMAT JSONEachRow`,
    });
    const countText = await countRs.text();
    const countRow = JSON.parse(countText.trim());

    console.log(`  Total tokens: ${countRow.cnt.toLocaleString()}`);

    const enrichedRs = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM ctf_token_map WHERE market_id != '' FORMAT JSONEachRow`,
    });
    const enrichedText = await enrichedRs.text();
    const enrichedRow = JSON.parse(enrichedText.trim());

    console.log(`  Already enriched: ${enrichedRow.cnt.toLocaleString()}`);
    console.log(
      `  Need enrichment: ${(countRow.cnt - enrichedRow.cnt).toLocaleString()}\n`
    );

    // ========================================================================
    // STEP 3: Check gamma_markets structure
    // ========================================================================
    console.log("Checking gamma_markets structure...");

    const gammaCountRs = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM gamma_markets FORMAT JSONEachRow`,
    });
    const gammaCountText = await gammaCountRs.text();
    const gammaCountRow = JSON.parse(gammaCountText.trim());

    console.log(`  Total markets: ${gammaCountRow.cnt.toLocaleString()}`);

    const sampleRs = await ch.query({
      query: `
        SELECT
          market_id,
          condition_id,
          question,
          outcomes,
          arraySize(outcomes) as outcome_count
        FROM gamma_markets
        LIMIT 3
        FORMAT JSONEachRow
      `,
    });
    const sampleText = await sampleRs.text();
    const sampleLines = sampleText.trim().split("\n");

    console.log(`\nSample markets:`);
    sampleLines.forEach((line, i) => {
      const row = JSON.parse(line);
      console.log(`\n${i + 1}. Market: ${row.market_id}`);
      console.log(`   Condition: ${row.condition_id}`);
      console.log(`   Question: ${row.question.slice(0, 60)}...`);
      console.log(`   Outcomes: [${row.outcomes.join(", ")}]`);
    });

    // ========================================================================
    // STEP 4: Method 1 - Direct UPDATE (if supported)
    // ========================================================================
    console.log(`\n${"─".repeat(60)}`);
    console.log("Attempting direct UPDATE using ALTER TABLE UPDATE...");
    console.log("─".repeat(60)\n");

    try {
      // ClickHouse UPDATE syntax requires ALTER TABLE
      // This updates market_id, outcome, and question in one pass
      await ch.exec({
        query: `
          ALTER TABLE ctf_token_map
          UPDATE
            market_id = m.market_id,
            outcome = arrayElement(m.outcomes, outcome_index + 1),
            outcome_index = outcome_index,
            question = m.question
          FROM (
            SELECT
              condition_id,
              market_id,
              question,
              outcomes
            FROM gamma_markets
          ) AS m
          WHERE ctf_token_map.condition_id_norm = m.condition_id
            AND ctf_token_map.market_id = ''
        `,
      });

      console.log("✅ UPDATE command submitted\n");
      console.log("⏳ Waiting for mutations to complete...");

      // Poll for mutation completion
      let mutationsComplete = false;
      let attempts = 0;
      const maxAttempts = 60;

      while (!mutationsComplete && attempts < maxAttempts) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const mutRs = await ch.query({
          query: `
            SELECT
              COUNT(*) as pending
            FROM system.mutations
            WHERE database = currentDatabase()
              AND table = 'ctf_token_map'
              AND is_done = 0
            FORMAT JSONEachRow
          `,
        });
        const mutText = await mutRs.text();
        const mutRow = JSON.parse(mutText.trim() || "{}");

        if (!mutRow.pending || mutRow.pending === 0) {
          mutationsComplete = true;
          console.log("✅ Mutations complete!\n");
        } else {
          process.stdout.write(`\r⏳ Pending mutations: ${mutRow.pending} (${attempts}/${maxAttempts})`);
        }
      }

      if (!mutationsComplete) {
        console.log("\n⚠️  Mutations taking longer than expected. Check manually.");
      }
    } catch (e) {
      console.log("⚠️  Direct UPDATE failed:", (e as Error).message.slice(0, 100));
      console.log("   This is expected on some ClickHouse versions.\n");

      // ====================================================================
      // STEP 5: Method 2 - Create new table and swap
      // ====================================================================
      console.log(`\n${"─".repeat(60)}`);
      console.log("Attempting Method 2: Create enriched table and swap...");
      console.log("─".repeat(60)\n");

      console.log("Creating enriched table...");
      await ch.exec({
        query: `
          CREATE TABLE IF NOT EXISTS ctf_token_map_enriched
          ENGINE = MergeTree
          ORDER BY (token_id, condition_id_norm)
          AS
          SELECT
            t.token_id,
            t.condition_id_norm,
            COALESCE(m.market_id, '') AS market_id,
            COALESCE(arrayElement(m.outcomes, t.outcome_index + 1), '') AS outcome,
            t.outcome_index,
            COALESCE(m.question, '') AS question
          FROM ctf_token_map t
          LEFT JOIN gamma_markets m
            ON t.condition_id_norm = m.condition_id
        `,
      });

      console.log("✅ Enriched table created\n");

      console.log("Verifying enriched table...");
      const verifyRs = await ch.query({
        query: `
          SELECT
            COUNT(*) as total,
            countIf(market_id != '') as enriched
          FROM ctf_token_map_enriched
          FORMAT JSONEachRow
        `,
      });
      const verifyText = await verifyRs.text();
      const verifyRow = JSON.parse(verifyText.trim());

      console.log(`  Total rows: ${verifyRow.total.toLocaleString()}`);
      console.log(`  Enriched rows: ${verifyRow.enriched.toLocaleString()}`);
      console.log(
        `  Coverage: ${((verifyRow.enriched / verifyRow.total) * 100).toFixed(1)}%\n`
      );

      console.log("⚠️  To complete the swap, run these commands manually:");
      console.log("");
      console.log("  RENAME TABLE ctf_token_map TO ctf_token_map_backup;");
      console.log("  RENAME TABLE ctf_token_map_enriched TO ctf_token_map;");
      console.log("");
      console.log("Then verify and drop backup:");
      console.log("  DROP TABLE ctf_token_map_backup;");
      console.log("");
    }

    // ========================================================================
    // STEP 6: Verify final state
    // ========================================================================
    console.log(`\n${"═".repeat(60)}`);
    console.log("Final verification");
    console.log("═".repeat(60)\n");

    const finalRs = await ch.query({
      query: `
        SELECT
          COUNT(*) as total,
          countIf(market_id != '') as with_market_id,
          countIf(outcome != '') as with_outcome,
          countIf(question != '') as with_question
        FROM ctf_token_map
        FORMAT JSONEachRow
      `,
    });
    const finalText = await finalRs.text();
    const finalRow = JSON.parse(finalText.trim());

    console.log("ctf_token_map status:");
    console.log(`  Total tokens: ${finalRow.total.toLocaleString()}`);
    console.log(`  With market_id: ${finalRow.with_market_id.toLocaleString()} (${((finalRow.with_market_id / finalRow.total) * 100).toFixed(1)}%)`);
    console.log(`  With outcome: ${finalRow.with_outcome.toLocaleString()} (${((finalRow.with_outcome / finalRow.total) * 100).toFixed(1)}%)`);
    console.log(`  With question: ${finalRow.with_question.toLocaleString()} (${((finalRow.with_question / finalRow.total) * 100).toFixed(1)}%)`);

    // Show sample enriched data
    console.log("\nSample enriched tokens:");
    const sampleEnrichedRs = await ch.query({
      query: `
        SELECT
          token_id,
          market_id,
          outcome,
          outcome_index,
          substring(question, 1, 50) as question_preview
        FROM ctf_token_map
        WHERE market_id != ''
        LIMIT 5
        FORMAT JSONEachRow
      `,
    });
    const sampleEnrichedText = await sampleEnrichedRs.text();
    const sampleEnrichedLines = sampleEnrichedText.trim().split("\n");

    sampleEnrichedLines.forEach((line, i) => {
      const row = JSON.parse(line);
      console.log(`\n${i + 1}. Token: ${row.token_id.slice(0, 20)}...`);
      console.log(`   Market: ${row.market_id}`);
      console.log(`   Outcome [${row.outcome_index}]: ${row.outcome}`);
      console.log(`   Question: ${row.question_preview}...`);
    });

    console.log(`\n${"═".repeat(60)}`);
    console.log("✅ Token map enrichment complete!");
    console.log("═".repeat(60)\n`);
  } catch (e) {
    console.error("❌ Error:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
