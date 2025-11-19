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
  console.log("PHASE 2 STEP 5: GUARDRAILS");
  console.log("════════════════════════════════════════════════════════════════\n");

  // A) Winner shares should be nonzero across resolved conditions
  console.log("A) Checking if winner shares are nonzero:\n");
  try {
    const result = await ch.query({
      query: `SELECT sum(ws.win_shares) AS total_win_shares FROM winning_shares_v1 AS ws`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      const totalWinShares = parseFloat(data[0][0]);
      console.log(`   Total winning shares: ${totalWinShares.toFixed(2)}`);
      if (totalWinShares !== 0) {
        console.log(`   ✅ PASS: Winner shares are nonzero\n`);
      } else {
        console.log(`   ❌ FAIL: Winner shares are zero!\n`);
      }
    }
  } catch (e: any) {
    console.error(`   Error: ${e.message.split('\n')[0]}\n`);
  }

  // B) Final view uniqueness
  console.log("B) Checking final view uniqueness:\n");
  try {
    const result = await ch.query({
      query: `SELECT count() AS rows, uniqCombined(wallet, condition_id_norm) AS uniq_pairs FROM realized_pnl_by_condition_v3`,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      const rows = parseInt(data[0][0]);
      const pairs = parseInt(data[0][1]);
      console.log(`   Total rows: ${rows.toLocaleString()}`);
      console.log(`   Unique pairs: ${pairs.toLocaleString()}`);
      if (rows === pairs) {
        console.log(`   ✅ PASS: Rows match unique pairs (no duplicates)\n`);
      } else {
        console.log(`   ⚠️  WARNING: Row count (${rows}) > unique pairs (${pairs})\n`);
      }
    }
  } catch (e: any) {
    console.error(`   Error: ${e.message.split('\n')[0]}\n`);
  }

  // C) Parity check: trade_flows_v2 vs trade_cashflows_v3
  console.log("C) Parity check: trade_flows_v2 vs trade_cashflows_v3 cashflows:\n");
  try {
    const result = await ch.query({
      query: `
        SELECT
          countIf(abs(f.cash_usd - t.sum_cash) > 1e-6) AS mismatches,
          count() AS total_pairs
        FROM flows_by_condition_v1 AS f
        LEFT JOIN (
          SELECT wallet, condition_id_norm, sum(toFloat64(cashflow_usdc)) AS sum_cash
          FROM trade_cashflows_v3
          GROUP BY wallet, condition_id_norm
        ) AS t USING (wallet, condition_id_norm)
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      const mismatches = parseInt(data[0][0]);
      const total = parseInt(data[0][1]);
      const mismatchPct = ((mismatches / total) * 100).toFixed(2);
      console.log(`   Mismatches: ${mismatches} / ${total} (${mismatchPct}%)`);
      if (mismatches === 0) {
        console.log(`   ✅ PASS: Cashflows match between sources\n`);
      } else {
        console.log(`   ⚠️  WARNING: ${mismatches} mismatches - keeping flows_by_condition_v1 as primary source\n`);
      }
    }
  } catch (e: any) {
    console.error(`   Error: ${e.message.split('\n')[0]}\n`);
  }

  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
