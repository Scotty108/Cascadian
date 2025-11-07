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
  console.log("FINAL DIAGNOSTIC - STEPS 1, 2, 5 (AFTER DEDUP MATERIALIZATION)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  // STEP 1: Confirm dedup is working
  console.log("📊 STEP 1: Confirm Dedup Effectiveness\n");
  try {
    const dedupCheck = await queryData(`
      SELECT
        'raw' AS tag,
        count() AS rows,
        uniqExact(transaction_hash, wallet_address) AS uniq_fills
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')

      UNION ALL
      SELECT
        'dedup_mat',
        count(),
        uniqExact(transaction_hash, wallet_address)
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
    `);

    if (dedupCheck.length >= 2) {
      const raw = dedupCheck.find((r: any) => r.tag === 'raw');
      const dedup = dedupCheck.find((r: any) => r.tag === 'dedup_mat');

      console.log(`  Raw trades:       ${raw.rows} rows, ${raw.uniq_fills} unique fills`);
      console.log(`  Dedup mat:        ${dedup.rows} rows, ${dedup.uniq_fills} unique fills`);
      console.log(`  Duplicates removed: ${raw.rows - dedup.rows} (${((raw.rows - dedup.rows) / raw.rows * 100).toFixed(1)}%)`);

      if (dedup.rows === dedup.uniq_fills) {
        console.log(`  ✅ PASS: No duplicates in dedup_mat\n`);
      } else {
        console.log(`  ❌ FAIL: Still have duplicates!\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 1 failed: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 2: Fanout check with ANY JOINs
  console.log("🔍 STEP 2: Fanout Check with ANY JOINs\n");
  try {
    const fanoutCheck = await queryData(`
      SELECT
        'base' AS tag,
        count() AS rows
      FROM trades_dedup_mat
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')

      UNION ALL
      SELECT
        'bridge',
        count()
      FROM trades_dedup_mat t
      ANY LEFT JOIN canonical_condition c USING (market_id)
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')

      UNION ALL
      SELECT
        'bridge+win',
        count()
      FROM trades_dedup_mat t
      ANY LEFT JOIN canonical_condition c USING (market_id)
      ANY LEFT JOIN winning_index wi ON lower(replaceAll(c.condition_id_norm,'0x','')) = lower(replaceAll(wi.condition_id_norm,'0x',''))
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')
    `);

    if (fanoutCheck.length >= 3) {
      const base = fanoutCheck.find((r: any) => r.tag === 'base');
      const bridge = fanoutCheck.find((r: any) => r.tag === 'bridge');
      const bridgeWin = fanoutCheck.find((r: any) => r.tag === 'bridge+win');

      console.log(`  Base rows:         ${base.rows}`);
      console.log(`  After bridge:      ${bridge.rows}`);
      console.log(`  After win join:    ${bridgeWin.rows}`);

      if (base.rows === bridge.rows && bridge.rows === bridgeWin.rows) {
        console.log(`  ✅ PASS: No fanout detected\n`);
      } else {
        console.log(`  ❌ FAIL: Fanout detected!\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 2 failed: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 5: Final P&L comparison
  console.log("🎯 STEP 5: Final P&L Comparison vs Polymarket Targets\n");
  try {
    // First check what views exist
    const viewsCheck = await queryData(`
      SELECT name FROM system.tables
      WHERE database = 'default'
      AND name IN ('realized_pnl_by_market_final', 'wallet_unrealized_pnl_v2')
      ORDER BY name
    `);

    console.log(`  Views found: ${viewsCheck.map((v: any) => v.name).join(', ')}\n`);

    const finalResults = await queryData(`
      SELECT
        lower('${wallet1}') AS wallet,
        round(coalesce(sum(realized_pnl_usd),0),2) AS realized_usd,
        0 AS unrealized_usd,
        round(coalesce(sum(realized_pnl_usd),0),2) AS total_usd,
        89975.16 AS expected_total,
        round(100.0 * abs(coalesce(sum(realized_pnl_usd),0) - 89975.16) / 89975.16, 3) AS pct_diff
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet1}')

      UNION ALL
      SELECT
        lower('${wallet2}') AS wallet,
        round(coalesce(sum(realized_pnl_usd),0),2) AS realized_usd,
        0 AS unrealized_usd,
        round(coalesce(sum(realized_pnl_usd),0),2) AS total_usd,
        102001.46 AS expected_total,
        round(100.0 * abs(coalesce(sum(realized_pnl_usd),0) - 102001.46) / 102001.46, 3) AS pct_diff
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet2}')
    `);

    if (finalResults.length > 0) {
      console.log("  HolyMoses7 (0xa4b3...):");
      const holy = finalResults.find((r: any) => r.wallet.startsWith('0xa4b3'));
      if (holy) {
        console.log(`    Realized:   $${holy.realized_usd}`);
        console.log(`    Unrealized: $${holy.unrealized_usd}`);
        console.log(`    Total:      $${holy.total_usd}`);
        console.log(`    Expected:   $${holy.expected_total}`);
        console.log(`    Variance:   ${holy.pct_diff}%`);
        console.log(`    Status:     ${holy.pct_diff <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }

      console.log("  niggemon (0xeb6f...):");
      const niggemon = finalResults.find((r: any) => r.wallet.startsWith('0xeb6f'));
      if (niggemon) {
        console.log(`    Realized:   $${niggemon.realized_usd}`);
        console.log(`    Unrealized: $${niggemon.unrealized_usd}`);
        console.log(`    Total:      $${niggemon.total_usd}`);
        console.log(`    Expected:   $${niggemon.expected_total}`);
        console.log(`    Variance:   ${niggemon.pct_diff}%`);
        console.log(`    Status:     ${niggemon.pct_diff <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }

      const maxVar = Math.max(
        holy?.pct_diff || 0,
        niggemon?.pct_diff || 0
      );

      console.log("════════════════════════════════════════════════════════════════════");
      if (maxVar <= 5) {
        console.log(`✅ SUCCESS: All wallets within 5% variance!\n`);
        console.log("Work is complete. The dedup fix resolved the issue.\n");
      } else {
        console.log(`❌ FAIL: Maximum variance is ${maxVar}% (threshold: 5%)\n`);
        console.log("Additional diagnostics needed. Send Step 6A-C outputs.\n");
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 5 failed: ${e.message?.substring(0, 200)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
