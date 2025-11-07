#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("PHASE 1A: INDEX OFFSET DIAGNOSTIC");
  console.log("════════════════════════════════════════════════════════════════\n");

  console.log("Testing alignment between trade_idx and win_idx...\n");

  try {
    const result = await ch.query({
      query: `
        SELECT
          SUM(CASE WHEN tf.trade_idx = wi.win_idx THEN 1 ELSE 0 END) as exact_match,
          SUM(CASE WHEN tf.trade_idx = wi.win_idx + 1 THEN 1 ELSE 0 END) as off_by_plus_one,
          SUM(CASE WHEN tf.trade_idx + 1 = wi.win_idx THEN 1 ELSE 0 END) as off_by_minus_one,
          SUM(CASE WHEN wi.win_idx IS NULL THEN 1 ELSE 0 END) as unresolved_markets,
          COUNT(*) as total_rows,
          countIf(tf.trade_idx IS NULL) as null_trade_idx,
          countIf(wi.win_idx IS NULL) as null_win_idx
        FROM trade_flows_v2 AS tf
        INNER JOIN canonical_condition AS cc ON lower(tf.market_id) = lower(cc.market_id)
        LEFT JOIN winning_index AS wi ON cc.condition_id_norm = wi.condition_id_norm
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data[0];

    const exact = parseFloat(data[0] || "0");
    const plus_one = parseFloat(data[1] || "0");
    const minus_one = parseFloat(data[2] || "0");
    const unresolved = parseFloat(data[3] || "0");
    const total = parseFloat(data[4] || "0");
    const null_trade_idx = parseFloat(data[5] || "0");
    const null_win_idx = parseFloat(data[6] || "0");

    console.log("RESULTS:");
    console.log("─".repeat(70));
    console.log(`Total rows tested:                       ${total.toLocaleString()}`);
    console.log(`Unresolved (win_idx IS NULL):            ${unresolved.toLocaleString()} (${((unresolved/total)*100).toFixed(2)}%)`);
    console.log(`Exact matches (trade_idx = win_idx):     ${exact.toLocaleString()} (${((exact/total)*100).toFixed(2)}%)`);
    console.log(`Off by +1 (trade_idx = win_idx + 1):     ${plus_one.toLocaleString()} (${((plus_one/total)*100).toFixed(2)}%)`);
    console.log(`Off by -1 (trade_idx + 1 = win_idx):     ${minus_one.toLocaleString()} (${((minus_one/total)*100).toFixed(2)}%)`);
    console.log(`NULL trade_idx values:                   ${null_trade_idx}`);
    console.log(`NULL win_idx values:                     ${null_win_idx}`);

    console.log("\n" + "─".repeat(70));
    console.log("INTERPRETATION:");
    console.log("─".repeat(70) + "\n");

    const resolved_total = total - unresolved;
    const exact_pct = (exact / total) * 100;
    const plus_one_pct = (plus_one / total) * 100;
    const minus_one_pct = (minus_one / total) * 100;

    if (exact > (plus_one + minus_one) * 2) {
      console.log("✅ CASE 1: Exact Match (No offset needed)");
      console.log(`   ${exact_pct.toFixed(2)}% of trades match perfectly`);
      console.log("   The join works correctly as-is.");
      console.log("   Fix: Keep `tf.trade_idx = wi.win_idx` in settlement join\n");
    } else if (plus_one > (exact + minus_one) * 2) {
      console.log("⚠️  CASE 2: Off by +1 (trade_idx = win_idx + 1)");
      console.log(`   ${plus_one_pct.toFixed(2)}% of trades are off by +1`);
      console.log("   trade_idx is 1 position ahead of win_idx");
      console.log("   Fix: Use `tf.trade_idx = wi.win_idx + 1` in settlement join\n");
    } else if (minus_one > (exact + plus_one) * 2) {
      console.log("⚠️  CASE 3: Off by -1 (trade_idx + 1 = win_idx)");
      console.log(`   ${minus_one_pct.toFixed(2)}% of trades are off by -1`);
      console.log("   trade_idx is 1 position behind win_idx");
      console.log("   Fix: Use `tf.trade_idx + 1 = wi.win_idx` in settlement join\n");
    } else {
      console.log("❓ CASE 4: Mixed or No Pattern");
      console.log(`   Exact: ${exact_pct.toFixed(2)}% | Plus-1: ${plus_one_pct.toFixed(2)}% | Minus-1: ${minus_one_pct.toFixed(2)}%`);
      console.log("   The offset varies across different markets");
      console.log("   Likely cause: Different markets have different outcome ordering");
      console.log("   Fix needed: Per-market offset logic or investigate outcome array ordering\n");
    }

    console.log("════════════════════════════════════════════════════════════════\n");
    console.log("📋 SUMMARY FOR PHASE 1B (ULTRATHINK):");
    console.log("─".repeat(70));
    console.log("Offset pattern identified above ⬆️");
    console.log("Unit mismatch: Missing × $1.00 multiplier on settlement shares");
    console.log("Per-condition aggregation: Verified correct in earlier tests");
    console.log("\nReady to design complete formula in Phase 1B\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
