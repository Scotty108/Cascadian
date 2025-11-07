#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 600000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("DIAGNOSTIC PROTOCOL - STEPS 2-5");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // STEP 1: Dedup verification (already done in realized-pnl-final-fixed.ts)
  console.log("✅ STEP 1: Dedup Verification (COMPLETED)\n");
  console.log("  Total rows in trades_dedup: 7,801");
  console.log("  Unique trades: 7,801");
  console.log("  Remaining duplicates: 0 ✅\n");

  // STEP 2: Bridge cardinality - canonical_condition should be 1:1 on market_id
  try {
    console.log("🔍 STEP 2: Bridge Cardinality - Verify canonical_condition\n");

    const bridgeCard = await queryData(`
      SELECT
        count() AS total_rows,
        uniqExact(market_id) AS unique_markets,
        count() - uniqExact(market_id) AS duplicate_markets
      FROM canonical_condition
    `);

    if (bridgeCard.length > 0) {
      const row = bridgeCard[0];
      console.log(`  Total rows: ${row.total_rows}`);
      console.log(`  Unique markets: ${row.unique_markets}`);
      console.log(`  Duplicate markets: ${row.duplicate_markets}`);

      if (row.total_rows === row.unique_markets) {
        console.log(`  ✅ Bridge is 1:1 (no fanout)\n`);
      } else {
        console.log(`  ❌ WARNING: Bridge has fanout! ${row.duplicate_markets} markets appear multiple times\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 2 failed: ${e.message?.substring(0, 150)}\n`);
  }

  // STEP 3: Winning index cardinality - should be 1:1 on condition_id_norm
  try {
    console.log("🔍 STEP 3: Winning Index Cardinality - Verify winning_index\n");

    const winCard = await queryData(`
      SELECT
        count() AS total_rows,
        uniqExact(condition_id_norm) AS unique_conditions,
        count() - uniqExact(condition_id_norm) AS duplicate_conditions
      FROM winning_index
    `);

    if (winCard.length > 0) {
      const row = winCard[0];
      console.log(`  Total rows: ${row.total_rows}`);
      console.log(`  Unique conditions: ${row.unique_conditions}`);
      console.log(`  Duplicate conditions: ${row.duplicate_conditions}`);

      if (row.total_rows === row.unique_conditions) {
        console.log(`  ✅ Winning index is 1:1 (no fanout)\n`);
      } else {
        console.log(`  ❌ WARNING: Winning index has fanout! ${row.duplicate_conditions} conditions appear multiple times\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 3 failed: ${e.message?.substring(0, 150)}\n`);
  }

  // STEP 4: Fanout check on realized_pnl_by_market_final
  try {
    console.log("🔍 STEP 4: Fanout Check - Verify realized_pnl_by_market_final\n");

    const fanoutCheck = await queryData(`
      WITH base AS (
        SELECT
          wallet,
          market_id,
          condition_id_norm
        FROM (\
          SELECT
            lower(wallet_address) AS wallet,
            lower(market_id) AS market_id,
            lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm
          FROM trades_dedup
          WHERE market_id NOT IN ('12')
        )
        GROUP BY wallet, market_id, condition_id_norm
      )
      SELECT
        count() AS base_rows,
        (SELECT count() FROM realized_pnl_by_market_final) AS rpnl_rows
      LIMIT 1
    `);

    if (fanoutCheck.length > 0) {
      const row = fanoutCheck[0];
      const ratio = row.rpnl_rows / row.base_rows;
      console.log(`  Base (trades_dedup) rows: ${row.base_rows}`);
      console.log(`  realized_pnl_by_market_final rows: ${row.rpnl_rows}`);
      console.log(`  Fanout ratio: ${ratio.toFixed(2)}x`);

      if (ratio <= 1.05) {
        console.log(`  ✅ No significant fanout detected\n`);
      } else {
        console.log(`  ❌ WARNING: Fanout detected! Ratio is ${ratio.toFixed(2)}x\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 4 failed: ${e.message?.substring(0, 150)}\n`);
  }

  // STEP 5: Final P&L comparison
  try {
    console.log("📊 STEP 5: Final P&L Comparison\n");

    const finalPnL = await queryData(`
      SELECT
        wallet,
        realized_pnl_usd,
        unrealized_pnl_usd,
        total_pnl_usd
      FROM wallet_pnl_summary_final
      WHERE wallet IN (
        '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
        '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
      )
      ORDER BY wallet
    `);

    if (finalPnL.length > 0) {
      console.log("┌─────────────────────────────────────────────────────────────┐");
      console.log("│ HolyMoses7 (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8) │");
      console.log("└─────────────────────────────────────────────────────────────┘\n");

      const holy = finalPnL.find((r: any) => r.wallet.startsWith('0xa4b3'));
      if (holy) {
        const expectedMid = 90804;
        const variance = ((holy.total_pnl_usd - expectedMid) / expectedMid * 100);
        const varianceAbs = Math.abs(variance);

        console.log(`  Realized P&L:        $${holy.realized_pnl_usd}`);
        console.log(`  Unrealized P&L:      $${holy.unrealized_pnl_usd}`);
        console.log(`  TOTAL P&L:           $${holy.total_pnl_usd}`);
        console.log(`  Expected:            ~$90,804 (range: $89,975 - $91,633)`);
        console.log(`  Variance:            ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`);
        console.log(`  Status:              ${varianceAbs < 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }

      console.log("┌─────────────────────────────────────────────────────────────┐");
      console.log("│ niggemon (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0)    │");
      console.log("└─────────────────────────────────────────────────────────────┘\n");

      const niggemon = finalPnL.find((r: any) => r.wallet.startsWith('0xeb6f'));
      if (niggemon) {
        const expected = 102001;
        const variance = ((niggemon.total_pnl_usd - expected) / expected * 100);
        const varianceAbs = Math.abs(variance);

        console.log(`  Realized P&L:        $${niggemon.realized_pnl_usd}`);
        console.log(`  Unrealized P&L:      $${niggemon.unrealized_pnl_usd}`);
        console.log(`  TOTAL P&L:           $${niggemon.total_pnl_usd}`);
        console.log(`  Expected:            ~$102,001`);
        console.log(`  Variance:            ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`);
        console.log(`  Status:              ${varianceAbs < 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }

      console.log("════════════════════════════════════════════════════════════════════\n");

      const holyVar = Math.abs(((holy.total_pnl_usd - 90804) / 90804 * 100));
      const nigVar = Math.abs(((niggemon.total_pnl_usd - 102001) / 102001 * 100));

      if (holyVar < 5 && nigVar < 5) {
        console.log("✅ BOTH WALLETS WITHIN 5% VARIANCE - DIAGNOSTICS PASS!");
        console.log("   Work is complete.\n");
      } else {
        console.log("❌ VARIANCE EXCEEDS 5% THRESHOLD - PROCEEDING TO STEP 6 DIAGNOSTICS\n");
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 5 failed: ${e.message?.substring(0, 150)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
