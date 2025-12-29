#!/usr/bin/env npx tsx
/**
 * Archive all remaining views from default to pm_archive
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
});

// All 28 views to archive
const VIEWS_TO_ARCHIVE = [
  // PROVISIONAL views (8)
  "pm_market_pnl",
  "pm_market_pnl_with_resolution",
  "pm_trader_events_clean",
  "pm_user_positions_clean",
  "pm_wallet_metrics_PROVISIONAL",
  "pm_wallet_pnl_PROVISIONAL",
  "pm_wallet_pnl_by_category_PROVISIONAL",
  "pm_wallet_pnl_by_tag_PROVISIONAL",
  // RESA views (2)
  "vw_wallet_condition_ledger_v1",
  "vw_wallet_condition_pnl_v1",
  // Other legacy views (18)
  "vw_category_pnl_totals",
  "vw_condition_winners",
  "vw_fills_deduped",
  "vw_fills_normalized",
  "vw_pm_ledger",
  "vw_pm_ledger_by_condition",
  "vw_pm_ledger_test",
  "vw_pm_mark_to_market_prices",
  "vw_pm_positions_ui",
  "vw_pm_resolution_payouts",
  "vw_pm_wallet_condition_pnl_v4",
  "vw_pnl_leaderboard",
  "vw_trader_events_dedup",
  "vw_trader_events_v2_dedup",
  "vw_trades_enriched",
  "vw_wallet_category_pnl",
  "vw_wallet_gain_loss",
  "vw_wallet_market_fills",
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
  console.log("=".repeat(60));
  console.log("  ARCHIVE REMAINING VIEWS");
  console.log("=".repeat(60));
  console.log("");

  // Check which views actually exist
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
  const existingViews = ((await viewsResult.json()) as any[]).map((v) => v.name);

  console.log(`Found ${existingViews.length}/${VIEWS_TO_ARCHIVE.length} views to archive\n`);

  // Archive each view
  let successCount = 0;
  let errorCount = 0;

  for (const viewName of VIEWS_TO_ARCHIVE) {
    if (existingViews.includes(viewName)) {
      const success = await runQuery(
        `RENAME TABLE default.${viewName} TO pm_archive.${viewName}`,
        `Move ${viewName} to pm_archive`
      );
      if (success) successCount++;
      else errorCount++;
    } else {
      console.log(`  [SKIP] ${viewName} (not found)`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  RESULTS: ${successCount} moved, ${errorCount} errors`);
  console.log("=".repeat(60));

  // Verify final state
  console.log("\nObjects remaining in default:");
  const remainingQuery = `
    SELECT name, engine
    FROM system.tables
    WHERE database = 'default'
      AND (name LIKE 'pm_%' OR name LIKE 'vw_%')
    ORDER BY name
  `;
  const remainingResult = await client.query({ query: remainingQuery, format: "JSONEachRow" });
  const remaining = (await remainingResult.json()) as any[];

  const tables = remaining.filter((r: any) => !r.engine.includes("View"));
  const views = remaining.filter((r: any) => r.engine.includes("View"));

  console.log(`\nTables (${tables.length}):`);
  for (const t of tables) {
    console.log(`  - ${t.name}`);
  }

  console.log(`\nViews (${views.length}):`);
  for (const v of views) {
    console.log(`  - ${v.name}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
