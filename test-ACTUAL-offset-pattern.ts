#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 600000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TESTING: With ACTUAL offset pattern (trade_idx = win_idx + 1)");
  console.log("Based on Phase 1A diagnostic: 98.38% of trades match this pattern");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  try {
    const result = await ch.query({
      query: `
        SELECT
          tf.wallet,
          round(
            sum(tf.cashflow_usdc) +
            sumIf(
              tf.delta_shares,
              coalesce(
                tf.trade_idx,
                multiIf(
                  upperUTF8(tf.outcome_raw) = 'YES', 1,
                  upperUTF8(tf.outcome_raw) = 'NO', 0,
                  NULL
                )
              ) = wi.win_idx + 1
            ),
            2
          ) AS realized_pnl_usd
        FROM trade_flows_v2 tf
        JOIN canonical_condition cc ON cc.market_id = tf.market_id
        LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
        WHERE wi.win_idx IS NOT NULL
          AND lower(tf.wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY tf.wallet
        ORDER BY tf.wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("RESULTS:\n");
    for (const row of data) {
      const wallet = row[0];
      const pnl = parseFloat(row[1]);

      console.log(`${wallet.substring(0, 12)}...`);
      console.log(`  P&L: $${pnl.toFixed(2)}`);

      if (wallet.includes("eb6f")) {
        const variance = ((pnl - 102001) / 102001) * 100;
        console.log(`  Expected: $102,001 | Variance: ${variance.toFixed(2)}%`);
        console.log(variance >= -5 && variance <= 5 ? "  ✅ PASS\n" : "  ❌ FAIL\n");
      } else if (wallet.includes("a4b3")) {
        const variance = ((pnl - 89975) / 89975) * 100;
        console.log(`  Expected: $89,975 | Variance: ${variance.toFixed(2)}%`);
        console.log(variance >= -5 && variance <= 5 ? "  ✅ PASS\n" : "  ❌ FAIL\n");
      }
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
