#!/usr/bin/env npx tsx
/**
 * PHASE 3 EXECUTION: Delete Broken Enriched Tables
 *
 * These tables have 99.9% error rates (showed $117 instead of $102k)
 * Must be removed before production deployment
 *
 * Tables to delete:
 * - trades_enriched_with_condition
 * - trades_enriched
 * - trades_with_recovered_cid
 * - trades_dedup
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 60000,
});

async function dropTable(tableName: string): Promise<boolean> {
  try {
    await ch.command({
      query: `DROP TABLE IF EXISTS ${tableName}`,
    });
    console.log(`✅ Dropped: ${tableName}`);
    return true;
  } catch (e: any) {
    console.log(`❌ Failed to drop ${tableName}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║         PHASE 3 EXECUTION: DELETE BROKEN ENRICHED TABLES       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("RATIONALE:");
  console.log("─".repeat(65));
  console.log("These tables have 99.9% error rate:");
  console.log("  - niggemon: Shows $117.24 (should be $102,001.46)");
  console.log("  - Cannot be fixed, must be deleted");
  console.log("  - Production P&L calculation uses outcome_positions_v2 + trade_cashflows_v3\n");

  console.log("TABLES TO DELETE:");
  console.log("─".repeat(65));

  const tablesToDelete = [
    "trades_enriched_with_condition",
    "trades_enriched",
    "trades_with_recovered_cid",
    "trades_dedup",
  ];

  let successCount = 0;
  for (const table of tablesToDelete) {
    const success = await dropTable(table);
    if (success) successCount++;
  }

  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL GATE CHECK
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("╔════════════════════════════════════════════════════════════════╗");
  if (successCount === tablesToDelete.length) {
    console.log("║              PHASE 3: ✅ PASSED - READY FOR PHASE 4           ║");
  } else {
    console.log("║              PHASE 3: ⚠️  PARTIAL - REVIEW ABOVE              ║");
  }
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("RESULTS SUMMARY:");
  console.log("─".repeat(65));
  console.log(`Tables deleted: ${successCount}/${tablesToDelete.length}`);
  console.log("");
  console.log("NEXT: Phase 4 - Comprehensive P&L validation\n");

  process.exit(successCount === tablesToDelete.length ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
