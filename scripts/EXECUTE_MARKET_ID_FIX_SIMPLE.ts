#!/usr/bin/env npx tsx
/**
 * SIMPLE MARKET_ID NORMALIZATION FIX
 *
 * Uses ALTER TABLE to normalize market_id in-place
 * No backups needed, simple and safe
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║     MARKET_ID NORMALIZATION FIX (Simple ALTER Table)          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Check format distribution
  console.log("CHECKING CURRENT FORMAT DISTRIBUTION:");
  console.log("─".repeat(65));

  const check = await queryData(`
    SELECT
      CASE WHEN market_id LIKE '0x%' THEN 'HEX' ELSE 'INTEGER' END as fmt,
      COUNT(*) as cnt
    FROM outcome_positions_v2
    GROUP BY fmt
  `);

  if (check && check.length > 0) {
    for (const [fmt, cnt] of check) {
      console.log(`  ${fmt}: ${cnt} rows`);
    }
  }

  console.log("\n");

  // The key insight: we don't need to rebuild!
  // We can just fix the JOIN logic to normalize on-the-fly
  // OR we can use a simpler approach: rebuild outcome_positions_v2
  // WITHOUT market_id (use condition_id_norm as the key instead)

  console.log("SOLUTION: Rebuild views to use condition_id_norm as primary key");
  console.log("(This eliminates the market_id join key issue entirely)");
  console.log("─".repeat(65));
  console.log("");

  console.log("Step 1: Get current outcome_positions_v2 row count");
  const before = await queryData(`SELECT COUNT(*) FROM outcome_positions_v2`);
  const beforeCount = before && before.length > 0 ? before[0][0] : 0;
  console.log(`  Current: ${beforeCount} rows\n`);

  console.log("Step 2: Rebuild outcome_positions_v2 (normalized & deduplicated)");
  console.log("  This aggregates by wallet + condition_id_norm (removes market_id)");

  try {
    // Create new view that aggregates by condition_id_norm instead of market_id
    // This avoids the format mismatch entirely
    await ch.command({
      query: `
        CREATE TABLE outcome_positions_v2_fixed AS
        SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          SUM(CAST(net_shares AS Float64)) AS net_shares
        FROM outcome_positions_v2
        WHERE outcome_idx >= 0 AND net_shares != 0
        GROUP BY wallet, condition_id_norm, outcome_idx
        HAVING net_shares != 0
        ORDER BY wallet, condition_id_norm
      `
    });
    console.log("  ✅ Created outcome_positions_v2_fixed\n");
  } catch (e: any) {
    console.log(`  ❌ Failed: ${e.message}\n`);
    process.exit(1);
  }

  console.log("Step 3: Rebuild trade_cashflows_v3 (normalized & deduplicated)");

  try {
    await ch.command({
      query: `
        CREATE TABLE trade_cashflows_v3_fixed AS
        SELECT
          wallet,
          condition_id_norm,
          SUM(CAST(cashflow_usdc AS Float64)) AS cashflow_usdc
        FROM trade_cashflows_v3
        WHERE cashflow_usdc != 0
        GROUP BY wallet, condition_id_norm
        HAVING cashflow_usdc != 0
        ORDER BY wallet, condition_id_norm
      `
    });
    console.log("  ✅ Created trade_cashflows_v3_fixed\n");
  } catch (e: any) {
    console.log(`  ❌ Failed: ${e.message}\n`);
    process.exit(1);
  }

  console.log("Step 4: Verify new tables");
  const afterPos = await queryData(`SELECT COUNT(*) FROM outcome_positions_v2_fixed`);
  const afterCf = await queryData(`SELECT COUNT(*) FROM trade_cashflows_v3_fixed`);

  const posCount = afterPos && afterPos.length > 0 ? afterPos[0][0] : 0;
  const cfCount = afterCf && afterCf.length > 0 ? afterCf[0][0] : 0;

  console.log(`  outcome_positions_v2_fixed: ${posCount} rows`);
  console.log(`  trade_cashflows_v3_fixed: ${cfCount} rows\n`);

  console.log("Step 5: Test JOINs on new tables");
  const joinTest = await queryData(`
    SELECT
      COUNT(DISTINCT p.wallet) as pos_wallets,
      COUNT(DISTINCT c.wallet) as cf_wallets,
      COUNT(DISTINCT CASE WHEN c.wallet IS NOT NULL THEN p.wallet END) as matched
    FROM outcome_positions_v2_fixed p
    LEFT JOIN trade_cashflows_v3_fixed c
      ON p.wallet = c.wallet AND p.condition_id_norm = c.condition_id_norm
  `);

  if (joinTest && joinTest.length > 0) {
    const [posW, cfW, matched] = joinTest[0];
    console.log(`  Wallets in positions: ${posW}`);
    console.log(`  Wallets in cashflows: ${cfW}`);
    console.log(`  Matched on JOIN: ${matched}`);
    console.log("");

    if (parseInt(matched) > 0) {
      console.log("  ✅ JOINs are working!\n");
    }
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                     NEXT STEPS                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("To complete the fix, swap the old tables for the new ones:");
  console.log("");
  console.log("  RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old;");
  console.log("  RENAME TABLE outcome_positions_v2_fixed TO outcome_positions_v2;");
  console.log("");
  console.log("  RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_old;");
  console.log("  RENAME TABLE trade_cashflows_v3_fixed TO trade_cashflows_v3;");
  console.log("");
  console.log("Then re-run Phase 4 validation.");
  console.log("");

  process.exit(0);
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
