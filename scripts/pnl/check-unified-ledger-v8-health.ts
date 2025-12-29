#!/usr/bin/env npx tsx
/**
 * PM_UNIFIED_LEDGER_V8 HEALTH CHECK
 *
 * Compares row counts between:
 * - pm_unified_ledger_v8 (view - computed on demand)
 * - pm_unified_ledger_v8_tbl (materialized table - snapshot)
 *
 * Purpose: Detect data gaps that could affect PnL calculations
 * Terminal: Claude Terminal 2 (Data Health & Engine Safety)
 * Date: 2025-12-06
 */

import { getClickHouseClient } from "../../lib/clickhouse/client";

const client = getClickHouseClient();

interface WalletHealthRow {
  wallet: string;
  view_rows: number;
  tbl_rows: number;
  row_gap: number;
  gap_pct: number;
}

// Sample wallets from regression benchmarks (from tmp/regression-matrix-fresh_2025_12_06.json)
const TEST_WALLETS = [
  "0x56687bf447db6ffa42ffe2204a05edaa20f55839", // Top wallet - $22M UI PnL
  "0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf", // #2 - $16.6M UI PnL
  "0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76", // #3 - $8.7M UI PnL, TRADER_STRICT
  "0xd235973291b2b75ff4070e9c0b01728c520b0f29", // #4 - $7.8M UI PnL, TRADER_STRICT
  "0x863134d00841b2e200492805a01e1e2f5defaa53", // #5 - $7.5M UI PnL, TRADER_STRICT
  "0x8119010a6e589062aa03583bb3f39ca632d9f887", // #6 - $6M UI PnL
  "0x0e0c91b7c21f4c64a326a5e1cb4047b87cdcfb25", // XCNStrategy wallet
  "0x17d29d96c05ff98097d2a9cb6b0f681b0e0c6b3e", // "niggemon"
];

async function checkWalletHealth(wallet: string): Promise<WalletHealthRow> {
  try {
    // Query view row count
    const viewQuery = `
      SELECT COUNT(*) as cnt
      FROM pm_unified_ledger_v8
      WHERE wallet_address = {wallet:String}
    `;

    const viewResult = await client.query({
      query: viewQuery,
      query_params: { wallet },
      format: "JSONEachRow",
    });

    const viewData = await viewResult.json<{ cnt: string }>();
    const viewRows = viewData.length > 0 ? parseInt(viewData[0].cnt, 10) : 0;

    // Query table row count
    const tblQuery = `
      SELECT COUNT(*) as cnt
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address = {wallet:String}
    `;

    const tblResult = await client.query({
      query: tblQuery,
      query_params: { wallet },
      format: "JSONEachRow",
    });

    const tblData = await tblResult.json<{ cnt: string }>();
    const tblRows = tblData.length > 0 ? parseInt(tblData[0].cnt, 10) : 0;

    const rowGap = viewRows - tblRows;
    const gapPct = tblRows > 0 ? (rowGap / tblRows) * 100 : 0;

    return {
      wallet: wallet.slice(0, 6) + "..." + wallet.slice(-4),
      view_rows: viewRows,
      tbl_rows: tblRows,
      row_gap: rowGap,
      gap_pct: parseFloat(gapPct.toFixed(2)),
    };
  } catch (error) {
    console.error(`Error checking wallet ${wallet}:`, error);
    return {
      wallet: wallet.slice(0, 6) + "..." + wallet.slice(-4),
      view_rows: -1,
      tbl_rows: -1,
      row_gap: 0,
      gap_pct: 0,
    };
  }
}

async function main() {
  console.log("PM_UNIFIED_LEDGER_V8 HEALTH CHECK");
  console.log("=".repeat(80));
  console.log(`Checking ${TEST_WALLETS.length} wallets from regression benchmarks...\n`);

  const results: WalletHealthRow[] = [];

  for (const wallet of TEST_WALLETS) {
    const health = await checkWalletHealth(wallet);
    results.push(health);

    // Print per-wallet JSON line
    const statusIcon = health.row_gap === 0 ? "✅" : (Math.abs(health.row_gap) < 100 ? "⚠️" : "❌");
    console.log(`${statusIcon} ${JSON.stringify(health)}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("AGGREGATE SUMMARY");
  console.log("=".repeat(80));

  const validResults = results.filter(r => r.view_rows >= 0);
  const walletsWithGap = validResults.filter(r => r.row_gap !== 0);

  if (validResults.length === 0) {
    console.log("❌ No valid results (all queries failed)");
    process.exit(1);
  }

  const rowGaps = validResults.map(r => r.row_gap);
  const maxGap = Math.max(...rowGaps);
  const minGap = Math.min(...rowGaps);
  const medianGap = rowGaps.sort((a, b) => a - b)[Math.floor(rowGaps.length / 2)];

  const gapPcts = validResults.map(r => Math.abs(r.gap_pct));
  const maxGapPct = Math.max(...gapPcts);

  console.log(`Total wallets checked: ${validResults.length}`);
  console.log(`Wallets with row_gap != 0: ${walletsWithGap.length} (${((walletsWithGap.length / validResults.length) * 100).toFixed(1)}%)`);
  console.log(`Max row_gap: ${maxGap}`);
  console.log(`Min row_gap: ${minGap}`);
  console.log(`Median row_gap: ${medianGap}`);
  console.log(`Max gap %: ${maxGapPct.toFixed(2)}%`);

  console.log("\n" + "=".repeat(80));
  console.log("INTERPRETATION");
  console.log("=".repeat(80));

  if (walletsWithGap.length === 0) {
    console.log("✅ HEALTHY: All wallets have matching view/table row counts.");
    console.log("   No evidence of pm_unified_ledger_v8_tbl staleness.");
  } else if (maxGapPct < 1.0) {
    console.log("⚠️  MINOR GAPS: Some wallets have <1% row count differences.");
    console.log("   This is likely negligible for PnL calculations.");
    console.log("   Consider refreshing pm_unified_ledger_v8_tbl if gaps grow.");
  } else if (maxGapPct < 5.0) {
    console.log("⚠️  MODERATE GAPS: Some wallets have 1-5% row count differences.");
    console.log("   May indicate stale materialized table or missing recent events.");
    console.log("   Recommend backfilling pm_unified_ledger_v8_tbl.");
  } else {
    console.log("❌ SEVERE GAPS: Some wallets have >5% row count differences.");
    console.log("   HIGH RISK of PnL calculation errors due to missing data.");
    console.log("   URGENT: Investigate and rebuild pm_unified_ledger_v8_tbl.");
  }

  console.log("\n" + "=".repeat(80));
  console.log("NEXT STEPS");
  console.log("=".repeat(80));
  console.log("1. Review docs/reports/UNIFIED_LEDGER_V8_HEALTH_2025_12_06.md");
  console.log("2. If gaps > 1%, check when pm_unified_ledger_v8_tbl was last updated");
  console.log("3. If gaps > 5%, tag affected wallets as DATA_SUSPECT in benchmarks");
  console.log("4. Consider automated refresh of pm_unified_ledger_v8_tbl");

  await client.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
