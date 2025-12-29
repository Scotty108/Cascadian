#!/usr/bin/env npx tsx
/**
 * Archive Migration Script
 * Moves legacy tables and views from default to pm_archive database
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

// Core tables to KEEP in default
const CORE_TABLES = [
  "pm_condition_resolutions",
  "pm_ctf_events",
  "pm_market_metadata",
  "pm_token_to_condition_map_v3",
  "pm_trader_events_v2",
];

// Tables to archive
const TABLES_TO_ARCHIVE = [
  "pm_ui_positions_new",
  "pm_condition_resolutions_backup_20251121",
  "pm_market_metadata_backup_20251121",
  "pm_token_to_condition_map",
  "pm_token_to_condition_map_v2",
  "pm_trader_events",
  "pm_trader_events_backup_20251121",
  "pm_ui_positions",
  "pm_user_positions",
  "pm_user_positions_backup_20251121",
  "pm_wallet_condition_pnl_v4",
  "pm_wallet_market_pnl_v2",
  "pm_wallet_market_pnl_v3",
  "pm_wallet_market_pnl_v4",
  "pm_wallet_market_positions_raw",
  "tmp_sports_bettor_resolutions",
  "tmp_sports_bettor_trades",
  "tmp_sports_bettor_trades_v3",
];

// Views to archive
const VIEWS_TO_ARCHIVE = [
  "vw_wallet_pnl_base",
  "vw_wallet_pnl_by_category",
  "vw_wallet_pnl_canonical",
  "vw_wallet_pnl_computed",
  "vw_wallet_pnl_goldsky",
  "vw_wallet_pnl_materialized",
  "vw_wallet_pnl_totals",
  "vw_wallet_pnl_totals_v1",
  "vw_wallet_trading_pnl",
  "vw_wallet_ui_pnl_goldsky",
  "vw_wallet_ui_pnl_hybrid",
  "vw_wallet_ui_pnl_polymarket",
  "vw_wallet_ui_pnl_v1",
  "vw_wallet_win_rate",
];

async function runQuery(query: string, description: string): Promise<boolean> {
  try {
    await client.command({ query });
    console.log(`  [OK] ${description}`);
    return true;
  } catch (e: any) {
    console.log(`  [ERROR] ${description}: ${e.message?.substring(0, 100)}`);
    return false;
  }
}

async function main() {
  const mode = process.argv[2] || "inspect";

  console.log("=".repeat(80));
  console.log("  POLYMARKET ARCHIVE MIGRATION");
  console.log("  Mode: " + mode.toUpperCase());
  console.log("=".repeat(80));
  console.log("");

  // Step 1: Show databases
  console.log("=== STEP 1: CURRENT DATABASES ===\n");
  const dbResult = await client.query({
    query: "SHOW DATABASES",
    format: "JSONEachRow",
  });
  const dbs = (await dbResult.json()) as any[];
  console.log("Databases:");
  for (const db of dbs) {
    console.log("  - " + db.name);
  }
  console.log("");

  // Step 2: Check tables in default
  console.log("=== STEP 2: TABLES IN DEFAULT ===\n");

  const allTableNames = [...CORE_TABLES, ...TABLES_TO_ARCHIVE];
  const tablesList = allTableNames.map((t) => `'${t}'`).join(", ");

  const tablesQuery = `
    SELECT name, engine
    FROM system.tables
    WHERE database = 'default'
      AND name IN (${tablesList})
    ORDER BY name
  `;

  const tablesResult = await client.query({ query: tablesQuery, format: "JSONEachRow" });
  const tables = (await tablesResult.json()) as any[];

  const foundTableNames = new Set(tables.map((t: any) => t.name));

  console.log("Tables found (" + tables.length + "):");
  console.log("-".repeat(60));
  for (const t of tables) {
    const isCore = CORE_TABLES.includes(t.name);
    const status = isCore ? "[KEEP]" : "[ARCHIVE]";
    console.log(`  ${status} ${t.name} (${t.engine})`);
  }

  const missingTables = TABLES_TO_ARCHIVE.filter((t) => {
    return foundTableNames.has(t) === false;
  });

  if (missingTables.length > 0) {
    console.log("\n*** MISSING TABLES (will be skipped): ***");
    for (const m of missingTables) {
      console.log("  - " + m);
    }
  }
  console.log("");

  // Step 3: Check views
  console.log("=== STEP 3: VIEWS IN DEFAULT ===\n");

  const viewsList = VIEWS_TO_ARCHIVE.map((v) => `'${v}'`).join(", ");
  const viewsQuery = `
    SELECT name
    FROM system.tables
    WHERE database = 'default'
      AND engine = 'View'
      AND name IN (${viewsList})
    ORDER BY name
  `;

  const viewsResult = await client.query({ query: viewsQuery, format: "JSONEachRow" });
  const views = (await viewsResult.json()) as any[];

  const foundViewNames = new Set(views.map((v: any) => v.name));

  console.log("Views found (" + views.length + "):");
  for (const v of views) {
    console.log("  [ARCHIVE] " + v.name);
  }

  const missingViews = VIEWS_TO_ARCHIVE.filter((v) => {
    return foundViewNames.has(v) === false;
  });

  if (missingViews.length > 0) {
    console.log("\n*** MISSING VIEWS (will be skipped): ***");
    for (const m of missingViews) {
      console.log("  - " + m);
    }
  }
  console.log("");

  if (mode === "inspect") {
    console.log("=== INSPECT MODE - No changes made ===");
    console.log("Run with 'execute' argument to perform migration:");
    console.log("  npx tsx scripts/pnl/archive-migration.ts execute");
    await client.close();
    return;
  }

  // Step 4: Create archive database
  console.log("=== STEP 4: CREATE ARCHIVE DATABASE ===\n");
  await runQuery("CREATE DATABASE IF NOT EXISTS pm_archive", "Create pm_archive database");
  console.log("");

  // Step 5: Move tables
  console.log("=== STEP 5: ARCHIVE TABLES ===\n");

  for (const tableName of TABLES_TO_ARCHIVE) {
    if (foundTableNames.has(tableName)) {
      await runQuery(
        `RENAME TABLE default.${tableName} TO pm_archive.${tableName}`,
        `Move ${tableName} to pm_archive`
      );
    } else {
      console.log(`  [SKIP] ${tableName} (not found)`);
    }
  }
  console.log("");

  // Step 6: Move views (views need special handling - they may have dependencies)
  console.log("=== STEP 6: ARCHIVE VIEWS ===\n");
  console.log("Note: Views may fail if they reference tables that were moved.\n");

  for (const viewName of VIEWS_TO_ARCHIVE) {
    if (foundViewNames.has(viewName)) {
      // For views, we need to get the CREATE statement, drop, and recreate in new DB
      // But RENAME TABLE should work for views in ClickHouse Cloud
      await runQuery(
        `RENAME TABLE default.${viewName} TO pm_archive.${viewName}`,
        `Move ${viewName} to pm_archive`
      );
    } else {
      console.log(`  [SKIP] ${viewName} (not found)`);
    }
  }
  console.log("");

  // Step 7: Verify final state
  console.log("=== STEP 7: VERIFY FINAL STATE ===\n");

  console.log("Tables remaining in default:");
  const remainingQuery = `
    SELECT name, engine
    FROM system.tables
    WHERE database = 'default'
      AND name LIKE 'pm_%'
    ORDER BY name
  `;
  const remainingResult = await client.query({ query: remainingQuery, format: "JSONEachRow" });
  const remaining = (await remainingResult.json()) as any[];
  for (const t of remaining) {
    console.log(`  - ${t.name} (${t.engine})`);
  }

  console.log("\nTables in pm_archive:");
  const archiveQuery = `
    SELECT name, engine
    FROM system.tables
    WHERE database = 'pm_archive'
    ORDER BY name
  `;
  const archiveResult = await client.query({ query: archiveQuery, format: "JSONEachRow" });
  const archived = (await archiveResult.json()) as any[];
  for (const t of archived) {
    console.log(`  - ${t.name} (${t.engine})`);
  }

  await client.close();
  console.log("\n=== MIGRATION COMPLETE ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
