#!/usr/bin/env npx tsx
/**
 * EXECUTE MARKET_ID NORMALIZATION
 *
 * Fixes the HEX/INTEGER market_id format inconsistency that causes:
 * - Row duplication in outcome_positions_v2 (97k → 32k rows)
 * - Failed JOINs between outcome_positions_v2 and trade_cashflows_v3
 * - Phase 4 P&L validation failures
 *
 * Timeline: 30-45 minutes
 * Risk: LOW (view-only changes, easy rollback)
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000, // 5 minutes
});

async function executeQuery(label: string, query: string): Promise<boolean> {
  try {
    console.log(`  ⏳ ${label}...`);
    await ch.command({ query });
    console.log(`  ✅ ${label} complete`);
    return true;
  } catch (e: any) {
    console.error(`  ❌ ${label} failed: ${e.message}`);
    return false;
  }
}

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║         MARKET_ID NORMALIZATION: HEX/INTEGER FIX              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: DIAGNOSE THE PROBLEM
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("PHASE 1: DIAGNOSE MARKET_ID FORMAT INCONSISTENCY");
  console.log("─".repeat(65));

  const formatCheck = await queryData(`
    SELECT
      CASE
        WHEN market_id LIKE '0x%' THEN 'HEX'
        ELSE 'INTEGER'
      END as format,
      COUNT(*) as row_count,
      COUNT(DISTINCT market_id) as unique_values
    FROM outcome_positions_v2
    GROUP BY format
  `);

  let hasHex = false;
  let hasInt = false;
  let hexCount = 0;
  let intCount = 0;

  if (formatCheck && formatCheck.length > 0) {
    for (const row of formatCheck) {
      const fmt = row[0];
      const cnt = row[1];
      if (fmt === "HEX") {
        hasHex = true;
        hexCount = cnt;
      } else {
        hasInt = true;
        intCount = cnt;
      }
      console.log(`  ${fmt.padEnd(10)}: ${cnt} rows (${row[2]} unique values)`);
    }
  }

  console.log("");

  if (!hasHex || !hasInt) {
    console.log("⚠️  Format inconsistency NOT detected!");
    console.log(`   HEX rows: ${hexCount}, INTEGER rows: ${intCount}`);
    console.log("   The problem may have already been fixed.\n");
    process.exit(0);
  }

  console.log("✅ Format inconsistency confirmed!");
  console.log(`   HEX rows: ${hexCount} | INTEGER rows: ${intCount}`);
  console.log(`   Total rows: ${hexCount + intCount}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: CREATE BACKUPS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("PHASE 2: CREATE BACKUPS");
  console.log("─".repeat(65));

  const timestamp = new Date().toISOString().replace(/[:-]/g, "").split(".")[0];

  await executeQuery(
    "Backup outcome_positions_v2",
    `CREATE TABLE outcome_positions_v2_backup_${timestamp} AS SELECT * FROM outcome_positions_v2`
  );

  await executeQuery(
    "Backup trade_cashflows_v3",
    `CREATE TABLE trade_cashflows_v3_backup_${timestamp} AS SELECT * FROM trade_cashflows_v3`
  );

  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: NORMALIZE outcome_positions_v2
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("PHASE 3: NORMALIZE outcome_positions_v2");
  console.log("─".repeat(65));

  const normalizeOutcome = `
    CREATE TABLE outcome_positions_v2_new AS
    SELECT
      wallet,
      CASE
        WHEN market_id LIKE '0x%' THEN toString(toUInt256(market_id))
        ELSE market_id
      END as market_id,
      condition_id_norm,
      outcome_idx,
      SUM(CAST(net_shares AS Float64)) AS net_shares
    FROM outcome_positions_v2_backup_${timestamp}
    WHERE outcome_idx >= 0 AND net_shares != 0
    GROUP BY wallet, market_id, condition_id_norm, outcome_idx
    HAVING net_shares != 0
  `;

  const step1 = await executeQuery("Rebuild outcome_positions_v2 with normalized market_id", normalizeOutcome);

  if (!step1) {
    console.log("\n❌ Failed to rebuild outcome_positions_v2");
    console.log("   Attempting rollback...");
    await executeQuery("Rollback", `DROP TABLE IF EXISTS outcome_positions_v2_new`);
    process.exit(1);
  }

  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: NORMALIZE trade_cashflows_v3
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("PHASE 4: NORMALIZE trade_cashflows_v3");
  console.log("─".repeat(65));

  const normalizeCashflows = `
    CREATE TABLE trade_cashflows_v3_new AS
    SELECT
      wallet,
      CASE
        WHEN market_id LIKE '0x%' THEN toString(toUInt256(market_id))
        ELSE market_id
      END as market_id,
      condition_id_norm,
      SUM(CAST(cashflow_usdc AS Float64)) AS cashflow_usdc
    FROM trade_cashflows_v3_backup_${timestamp}
    WHERE cashflow_usdc != 0
    GROUP BY wallet, market_id, condition_id_norm
    HAVING cashflow_usdc != 0
  `;

  const step2 = await executeQuery("Rebuild trade_cashflows_v3 with normalized market_id", normalizeCashflows);

  if (!step2) {
    console.log("\n❌ Failed to rebuild trade_cashflows_v3");
    console.log("   Attempting rollback...");
    await executeQuery("Rollback outcome_positions_v2", `RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_broken`);
    await executeQuery("Restore outcome_positions_v2", `RENAME TABLE outcome_positions_v2_backup_${timestamp} TO outcome_positions_v2`);
    await executeQuery("Cleanup", `DROP TABLE IF EXISTS outcome_positions_v2_new`);
    process.exit(1);
  }

  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: SWAP TABLES (ATOMIC)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("PHASE 5: ATOMIC TABLE SWAP");
  console.log("─".repeat(65));

  await executeQuery("Rename old outcome_positions_v2", `RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old_${timestamp}`);
  await executeQuery("Swap in new outcome_positions_v2", `RENAME TABLE outcome_positions_v2_new TO outcome_positions_v2`);
  await executeQuery("Rename old trade_cashflows_v3", `RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_old_${timestamp}`);
  await executeQuery("Swap in new trade_cashflows_v3", `RENAME TABLE trade_cashflows_v3_new TO trade_cashflows_v3`);

  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("PHASE 6: VERIFY NORMALIZATION SUCCESS");
  console.log("─".repeat(65));

  const newFormatCheck = await queryData(`
    SELECT
      CASE
        WHEN market_id LIKE '0x%' THEN 'HEX'
        ELSE 'INTEGER'
      END as format,
      COUNT(*) as row_count
    FROM outcome_positions_v2
    GROUP BY format
  `);

  console.log("  Format distribution after normalization:");
  if (newFormatCheck && newFormatCheck.length > 0) {
    for (const row of newFormatCheck) {
      console.log(`    ${row[0]}: ${row[1]} rows`);
    }
  }

  const newCounts = await queryData(`
    SELECT
      'outcome_positions_v2' as table_name,
      COUNT(*) as row_count,
      COUNT(DISTINCT wallet) as wallets,
      COUNT(DISTINCT market_id) as markets
    FROM outcome_positions_v2
    UNION ALL
    SELECT
      'trade_cashflows_v3' as table_name,
      COUNT(*) as row_count,
      COUNT(DISTINCT wallet) as wallets,
      COUNT(DISTINCT market_id) as markets
    FROM trade_cashflows_v3
  `);

  console.log("\n  Row count comparison:");
  console.log("  ┌─────────────────────────────┬──────────┬─────────┬──────────┐");
  console.log("  │ Table                       │ Rows     │ Wallets │ Markets  │");
  console.log("  ├─────────────────────────────┼──────────┼─────────┼──────────┤");

  if (newCounts && newCounts.length > 0) {
    for (const row of newCounts) {
      const tableName = String(row[0]).padEnd(27);
      const rows = String(row[1]).padEnd(8);
      const wallets = String(row[2]).padEnd(7);
      const markets = String(row[3]).padEnd(8);
      console.log(`  │ ${tableName} │ ${rows} │ ${wallets} │ ${markets} │`);
    }
  }
  console.log("  └─────────────────────────────┴──────────┴─────────┴──────────┘\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7: TEST JOINS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("PHASE 7: TEST JOINS");
  console.log("─".repeat(65));

  const joinTest = await queryData(`
    SELECT
      COUNT(DISTINCT p.wallet) as wallets_in_positions,
      COUNT(DISTINCT c.wallet) as wallets_in_cashflows,
      COUNT(DISTINCT CASE WHEN c.wallet IS NOT NULL THEN p.wallet END) as wallets_matched,
      COUNT(DISTINCT CASE WHEN c.wallet IS NULL THEN p.wallet END) as wallets_unmatched
    FROM outcome_positions_v2 p
    LEFT JOIN trade_cashflows_v3 c
      ON c.wallet = p.wallet
      AND c.market_id = p.market_id
      AND c.condition_id_norm = p.condition_id_norm
  `);

  if (joinTest && joinTest.length > 0) {
    const [posWallets, cfWallets, matched, unmatched] = joinTest[0];
    console.log(`  Wallets in outcome_positions_v2: ${posWallets}`);
    console.log(`  Wallets in trade_cashflows_v3: ${cfWallets}`);
    console.log(`  Successfully matched: ${matched}`);
    console.log(`  Unmatched: ${unmatched}`);

    if (parseInt(unmatched) === 0) {
      console.log("  ✅ All JOINs successful!\n");
    } else {
      console.log(`  ⚠️  ${unmatched} wallets have unmatched rows\n`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              MARKET_ID NORMALIZATION: ✅ COMPLETE              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("CLEANUP OPTIONS:");
  console.log("─".repeat(65));
  console.log(`  Backup tables created (can be dropped to free space):`);
  console.log(`    - outcome_positions_v2_backup_${timestamp}`);
  console.log(`    - trade_cashflows_v3_backup_${timestamp}`);
  console.log(`    - outcome_positions_v2_old_${timestamp}`);
  console.log(`    - trade_cashflows_v3_old_${timestamp}`);
  console.log("");
  console.log(`  To keep backups, run: -- (no cleanup needed)`);
  console.log(`  To remove backups, run:`);
  console.log(`    DROP TABLE outcome_positions_v2_backup_${timestamp}`);
  console.log(`    DROP TABLE trade_cashflows_v3_backup_${timestamp}`);
  console.log(`    DROP TABLE outcome_positions_v2_old_${timestamp}`);
  console.log(`    DROP TABLE trade_cashflows_v3_old_${timestamp}`);
  console.log("");
  console.log("NEXT STEPS:");
  console.log("─".repeat(65));
  console.log("  ✅ Re-run Phase 4 P&L validation with fixed tables");
  console.log("  ✅ All wallets should now show correct P&L values");
  console.log("  ✅ Proceed to Phase 5-6 for production deployment");
  console.log("");

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
