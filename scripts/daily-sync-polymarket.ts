#!/usr/bin/env npx tsx
/**
 * Daily Sync Script: Keep P&L tables current
 * Runs daily at 2 AM UTC via cron job
 * Rebuilds outcome_positions_v2 and trade_cashflows_v3
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

async function execQuery(label: string, query: string) {
  try {
    console.log(`[${new Date().toISOString()}] ${label}...`);
    await ch.command({ query });
    console.log(`✅ ${label} complete`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${label} failed: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("DAILY SYNC: Rebuilding P&L tables");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const startTime = Date.now();

  // Step 1: Rebuild outcome_positions_v2
  console.log("Step 1/2: Rebuild outcome_positions_v2 from ERC-1155 transfers");
  console.log("─".repeat(65));
  const step1Ok = await execQuery(
    "Rebuilding outcome_positions_v2",
    `
      CREATE TABLE outcome_positions_v2_new AS
      SELECT
        wallet,
        market_id,
        condition_id_norm,
        outcome_idx,
        SUM(CAST(balance AS Float64)) AS net_shares
      FROM erc1155_transfers
      WHERE outcome_idx >= 0
      GROUP BY wallet, market_id, condition_id_norm, outcome_idx
      HAVING net_shares != 0;

      RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old;
      RENAME TABLE outcome_positions_v2_new TO outcome_positions_v2;
      DROP TABLE outcome_positions_v2_old;
    `
  );

  // Step 2: Rebuild trade_cashflows_v3
  console.log("\nStep 2/2: Rebuild trade_cashflows_v3 from USDC transfers");
  console.log("─".repeat(65));
  const step2Ok = await execQuery(
    "Rebuilding trade_cashflows_v3",
    `
      CREATE TABLE trade_cashflows_v3_new AS
      SELECT
        wallet,
        market_id,
        condition_id_norm,
        SUM(CAST(value AS Float64)) AS cashflow_usdc
      FROM erc20_transfers
      WHERE token_type = 'USDC'
      GROUP BY wallet, market_id, condition_id_norm;

      RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_old;
      RENAME TABLE trade_cashflows_v3_new TO trade_cashflows_v3;
      DROP TABLE trade_cashflows_v3_old;
    `
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  if (step1Ok && step2Ok) {
    console.log(`✅ DAILY SYNC COMPLETE (${elapsed}s)`);
    console.log(`═══════════════════════════════════════════════════════════════\n`);
    process.exit(0);
  } else {
    console.log(`❌ DAILY SYNC FAILED - Review errors above`);
    console.log(`═══════════════════════════════════════════════════════════════\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
