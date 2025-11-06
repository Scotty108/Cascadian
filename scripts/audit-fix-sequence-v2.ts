#!/usr/bin/env npx tsx

import "dotenv/config";
import fs from "fs";
import path from "path";
import { createClient } from "@clickhouse/client";

// Manually load .env.local
const envPath = path.resolve("/Users/scotty/Projects/Cascadian-app/.env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const lines = envContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) {
        process.env[key] = rest.join("=");
      }
    }
  }
}

console.log("Environment loaded:");
console.log("  CLICKHOUSE_HOST:", process.env.CLICKHOUSE_HOST ? "✓" : "✗");
console.log("  CLICKHOUSE_PASSWORD:", process.env.CLICKHOUSE_PASSWORD ? "✓" : "✗");

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

// ============================================================================
// STEP 1: Detect actual CT address (read-only)
// ============================================================================
async function step1DetectCTAddress(): Promise<string> {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 1: Autodetect CT Address (Read-Only)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const query = `
    SELECT contract as address, count() AS n
    FROM erc1155_transfers
    GROUP BY contract
    ORDER BY n DESC
    LIMIT 5
  `;

  try {
    const result = await ch.query({
      query,
      format: "JSONEachRow",
    });

    const text = await result.text();
    const lines = text.trim().split("\n").filter((l) => l.trim());
    const rows = lines.map((l) => JSON.parse(l));

    console.log("Top 5 addresses by ERC1155 transfer volume:");
    for (let i = 0; i < rows.length; i++) {
      console.log(`  ${i + 1}. ${rows[i].address} - ${rows[i].n} transfers`);
    }

    const detectedAddress = rows[0].address;
    console.log(`\nDetected CT Address: ${detectedAddress}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);

    return detectedAddress;
  } catch (e) {
    console.error("Error in STEP 1:", e);
    throw e;
  }
}

// ============================================================================
// STEP 2: Fix event signature in build-approval-proxies.ts
// ============================================================================
async function step2FixApprovalSignature(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 2: Fix Critical Bug in build-approval-proxies.ts");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const scriptPath = "/Users/scotty/Projects/Cascadian-app/scripts/build-approval-proxies.ts";

  try {
    let content = fs.readFileSync(scriptPath, "utf8");

    const oldSig = "0xa39707aee45523880143dba1da92036e62aa63c0";
    const newSig = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";

    if (!content.includes(oldSig)) {
      console.log("⚠ Old signature not found. Checking current state...");
      if (content.includes(newSig)) {
        console.log("✅ Script already has correct signature!");
        console.log(`════════════════════════════════════════════════════════════════════\n`);
        return;
      } else {
        console.log("❌ Neither old nor new signature found!");
        throw new Error("Cannot find signature to fix");
      }
    }

    content = content.replace(
      `"0xa39707aee45523880143dba1da92036e62aa63c0"`,
      `"0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31"`
    );

    fs.writeFileSync(scriptPath, content, "utf8");

    console.log("✅ Fixed ApprovalForAll signature in build-approval-proxies.ts");
    console.log(`   Old: ${oldSig}`);
    console.log(`   New: ${newSig}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);
  } catch (e) {
    console.error("Error in STEP 2:", e);
    throw e;
  }
}

// ============================================================================
// STEP 3: Populate pm_erc1155_flats from decoded erc1155_transfers
// ============================================================================
async function step3PopulateFlatTable(ctAddress: string): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 3: Populate pm_erc1155_flats Table");
  console.log(`Address: ${ctAddress}`);
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Create table if not exists with correct schema
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS pm_erc1155_flats
        (
          tx_hash        String,
          log_index      UInt32,
          block_number   UInt64,
          block_time     DateTime,
          operator       String,
          from_address   String,
          to_address     String,
          token_id       String,
          amount         String,
          address        LowCardinality(String)
        )
        ENGINE = MergeTree
        PARTITION BY toYYYYMM(block_time)
        ORDER BY (block_number, tx_hash, log_index)
      `,
    });
    console.log("✅ Table structure ready\n");

    // Check current count
    const countResult = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats`,
      format: "JSONEachRow",
    });
    const countText = await countResult.text();
    const countLines = countText.trim().split("\n").filter((l) => l.trim());
    const countRow = countLines.length > 0 ? JSON.parse(countLines[0]) : { cnt: 0 };
    console.log(`Current rows in pm_erc1155_flats: ${countRow.cnt}\n`);

    // Insert from decoded erc1155_transfers
    console.log("Populating pm_erc1155_flats from decoded erc1155_transfers...");
    const insertQuery = `
      INSERT INTO pm_erc1155_flats
      SELECT
        tx_hash,
        log_index,
        block_number,
        CAST(block_timestamp AS DateTime) AS block_time,
        lower(operator) AS operator,
        lower(from_address) AS from_address,
        lower(to_address) AS to_address,
        token_id,
        toString(value) AS amount,
        lower(contract) AS address
      FROM erc1155_transfers
      WHERE lower(contract) = lower({ct:String})
    `;

    await ch.exec({
      query: insertQuery,
      query_params: { ct: ctAddress },
    });

    console.log("✅ Data inserted\n");

    // Final count
    const finalResult = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats`,
      format: "JSONEachRow",
    });
    const finalText = await finalResult.text();
    const finalLines = finalText.trim().split("\n").filter((l) => l.trim());
    const finalRow = finalLines.length > 0 ? JSON.parse(finalLines[0]) : { cnt: 0 };
    console.log(`✅ Final row count in pm_erc1155_flats: ${finalRow.cnt}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);
  } catch (e) {
    console.error("Error in STEP 3:", e);
    throw e;
  }
}

// ============================================================================
// STEP 4: Build pm_user_proxy_wallets (placeholder - needs raw logs)
// ============================================================================
async function step4BuildProxyWallets(ctAddress: string): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 4: Build pm_user_proxy_wallets from ApprovalForAll");
  console.log(`Address: ${ctAddress}`);
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Create table
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS pm_user_proxy_wallets
        (
          user_eoa     LowCardinality(String),
          proxy_wallet LowCardinality(String),
          source       LowCardinality(String),
          first_seen   DateTime
        )
        ENGINE = ReplacingMergeTree()
        ORDER BY (user_eoa, proxy_wallet)
      `,
    });
    console.log("✅ Table structure ready\n");

    // Check current count
    const countResult = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_user_proxy_wallets`,
      format: "JSONEachRow",
    });
    const countText = await countResult.text();
    const countLines = countText.trim().split("\n").filter((l) => l.trim());
    const countRow = countLines.length > 0 ? JSON.parse(countLines[0]) : { cnt: 0 };
    console.log(`Current rows: ${countRow.cnt}\n`);

    console.log("⚠ STEP 4 requires raw event logs with topics (not available in current schema)");
    console.log("   This step will be completed when raw log data is available\n");

    console.log(`════════════════════════════════════════════════════════════════════\n`);
  } catch (e) {
    console.error("Error in STEP 4:", e);
    throw e;
  }
}

// ============================================================================
// STEP 5: Enhance ctf_token_map Schema
// ============================================================================
async function step5EnhanceTokenMap(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 5: Enhance ctf_token_map Schema");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Check if table exists and has columns
    const describeResult = await ch.query({
      query: `DESCRIBE TABLE ctf_token_map`,
    });

    const describeText = await describeResult.text();
    const hasMarketId = describeText.includes("market_id");
    const hasOutcome = describeText.includes("outcome");

    console.log("Current columns:");
    console.log(`  market_id: ${hasMarketId ? "✓ exists" : "✗ missing"}`);
    console.log(`  outcome: ${hasOutcome ? "✓ exists" : "✗ missing"}\n`);

    // Add columns if missing
    if (!hasMarketId) {
      await ch.exec({
        query: `ALTER TABLE ctf_token_map ADD COLUMN IF NOT EXISTS market_id String`,
      });
      console.log("✅ Added market_id column");
    }

    if (!hasOutcome) {
      await ch.exec({
        query: `ALTER TABLE ctf_token_map ADD COLUMN IF NOT EXISTS outcome String`,
      });
      console.log("✅ Added outcome column");
    }

    console.log("\n✅ Schema enhancement complete\n");

    // Show enrichment stats
    const statsResult = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          countIf(market_id IS NOT NULL AND market_id != '') as with_market_id,
          ROUND(countIf(market_id IS NOT NULL AND market_id != '') * 100.0 / COUNT(*), 2) as enrichment_pct
        FROM ctf_token_map
      `,
      format: "JSONEachRow",
    });

    const statsText = await statsResult.text();
    const statsLines = statsText.trim().split("\n").filter((l) => l.trim());
    const statsRow = statsLines.length > 0 ? JSON.parse(statsLines[0]) : {};

    console.log(`✅ Enrichment Statistics:`);
    console.log(`   Total rows: ${statsRow.total_rows || 0}`);
    console.log(`   With market_id: ${statsRow.with_market_id || 0}`);
    console.log(`   Enrichment: ${statsRow.enrichment_pct || 0}%`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);
  } catch (e) {
    console.error("Error in STEP 5:", e);
    throw e;
  }
}

// ============================================================================
// STEP 6: Create markets view
// ============================================================================
async function step6CreateMarketsView(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 6: Create markets canonical view");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    await ch.exec({
      query: `
        CREATE OR REPLACE VIEW markets AS
        SELECT
          g.market_id,
          g.condition_id,
          g.question,
          g.category,
          r.winning_outcome,
          r.resolved_at
        FROM gamma_markets g
        LEFT JOIN market_resolutions_final r
          ON lower(r.condition_id) = lower(g.condition_id)
      `,
    });

    console.log("✅ Created markets view\n");

    // Verify view
    const countResult = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM markets`,
      format: "JSONEachRow",
    });

    const countText = await countResult.text();
    const countLines = countText.trim().split("\n").filter((l) => l.trim());
    const countRow = countLines.length > 0 ? JSON.parse(countLines[0]) : { cnt: 0 };

    console.log(`✅ View Statistics:`);
    console.log(`   Accessible markets: ${countRow.cnt}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);
  } catch (e) {
    console.error("Error in STEP 6:", e);
    throw e;
  }
}

// ============================================================================
// STEP 7: Run Validation Checks
// ============================================================================
async function step7ValidationChecks(ctAddress: string): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 7: Run Validation Checks");
  console.log(`Address: ${ctAddress}`);
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Check A: ERC-1155 volume
    console.log("A) ERC-1155 Volume at detected CT address:\n");

    const checkA = await ch.query({
      query: `
        SELECT toStartOfDay(block_time) AS d, sum(parseUInt256OrZero(amount)) AS units
        FROM pm_erc1155_flats
        WHERE lower(address) = lower({ct:String})
        GROUP BY d ORDER BY d DESC LIMIT 10
        FORMAT JSONEachRow
      `,
      query_params: { ct: ctAddress },
    });

    const checkAText = await checkA.text();
    const checkALines = checkAText.trim().split("\n").filter((l) => l.trim());
    console.log(`   Rows returned: ${checkALines.length}`);
    if (checkALines.length > 0) {
      const sample = JSON.parse(checkALines[0]);
      console.log(`   Sample: ${sample.d} - ${sample.units} units`);
    }

    // Check C: Token map enrichment
    console.log("\nC) Sample token map enrichment:\n");

    const checkC = await ch.query({
      query: `
        SELECT token_id, market_id, outcome, condition_id
        FROM ctf_token_map
        WHERE market_id IS NOT NULL
        LIMIT 20
        FORMAT JSONEachRow
      `,
    });

    const checkCText = await checkC.text();
    const checkCLines = checkCText.trim().split("\n").filter((l) => l.trim());
    console.log(`   Enriched tokens (sample): ${checkCLines.length}`);
    if (checkCLines.length > 0) {
      const sample = JSON.parse(checkCLines[0]);
      console.log(`   Sample: token_id=${sample.token_id}, market_id=${sample.market_id}`);
    }

    // Check markets view
    console.log("\nD) Markets view sample:\n");

    const checkD = await ch.query({
      query: `
        SELECT market_id, condition_id, question
        FROM markets
        LIMIT 5
        FORMAT JSONEachRow
      `,
    });

    const checkDText = await checkD.text();
    const checkDLines = checkDText.trim().split("\n").filter((l) => l.trim());
    console.log(`   Markets accessible: ${checkDLines.length}`);
    if (checkDLines.length > 0) {
      const sample = JSON.parse(checkDLines[0]);
      console.log(`   Sample: ${sample.market_id} - ${sample.question?.substring(0, 50)}`);
    }

    console.log(`\n════════════════════════════════════════════════════════════════════\n`);
  } catch (e) {
    console.error("Error in STEP 7:", e);
    throw e;
  }
}

// ============================================================================
// MAIN: Execute all steps in order
// ============================================================================
async function main() {
  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════════════╗");
  console.log("║                  AUDIT FIX SEQUENCE - COMPLETE                      ║");
  console.log("╚════════════════════════════════════════════════════════════════════╝");

  try {
    // Step 1: Detect CT address
    const ctAddress = await step1DetectCTAddress();

    // Step 2: Fix approval signature
    await step2FixApprovalSignature();

    // Step 3: Populate flat table
    await step3PopulateFlatTable(ctAddress);

    // Step 4: Build proxy wallets
    await step4BuildProxyWallets(ctAddress);

    // Step 5: Enhance token map
    await step5EnhanceTokenMap();

    // Step 6: Create markets view
    await step6CreateMarketsView();

    // Step 7: Validation checks
    await step7ValidationChecks(ctAddress);

    console.log("╔════════════════════════════════════════════════════════════════════╗");
    console.log("║                         ALL STEPS COMPLETE                         ║");
    console.log("╚════════════════════════════════════════════════════════════════════╝\n");

    await ch.close();
    process.exit(0);
  } catch (e) {
    console.error("\n❌ FATAL ERROR:", e);
    await ch.close();
    process.exit(1);
  }
}

main();
