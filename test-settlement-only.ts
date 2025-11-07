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
  console.log("TESTING: What if P&L = settlement only (no cashflows)?");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  // Test 1: Settlement = sum(delta_shares for resolved) where trade_idx = win_idx
  console.log("Approach 1: Settlement = SUM(delta_shares where trade_idx = win_idx)");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          tf.wallet,
          round(
            sumIf(
              tf.delta_shares,
              coalesce(
                tf.trade_idx,
                multiIf(
                  upperUTF8(tf.outcome_raw) = 'YES', 1,
                  upperUTF8(tf.outcome_raw) = 'NO', 0,
                  NULL
                )
              ) = wi.win_idx
            ),
            2
          ) AS settlement_only
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

    for (const row of data) {
      const wallet = row[0];
      const settlement = parseFloat(row[1]);
      console.log(`${wallet.substring(0, 12)}...: $${settlement.toFixed(2)}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  console.log("\nApproach 2: Settlement = SUM(delta_shares where trade_idx = win_idx - 1)");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          tf.wallet,
          round(
            sumIf(
              tf.delta_shares,
              coalesce(
                tf.trade_idx,
                multiIf(
                  upperUTF8(tf.outcome_raw) = 'YES', 1,
                  upperUTF8(tf.outcome_raw) = 'NO', 0,
                  NULL
                )
              ) = wi.win_idx - 1
            ),
            2
          ) AS settlement_only
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

    for (const row of data) {
      const wallet = row[0];
      const settlement = parseFloat(row[1]);
      console.log(`${wallet.substring(0, 12)}...: $${settlement.toFixed(2)}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("BASELINE: Cashflows only (current)");
  console.log("─".repeat(70));

  try {
    const result = await ch.query({
      query: `
        SELECT
          tf.wallet,
          round(sum(tf.cashflow_usdc), 2) AS cashflows_only
        FROM trade_flows_v2 tf
        WHERE lower(tf.wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        GROUP BY tf.wallet
        ORDER BY tf.wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const wallet = row[0];
      const cashflows = parseFloat(row[1]);
      console.log(`${wallet.substring(0, 12)}...: $${cashflows.toFixed(2)}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("EXPECTED VALUES");
  console.log("─".repeat(70));
  console.log("niggemon:    $102,001");
  console.log("HolyMoses7:  $89,975\n");
}

main().catch(console.error);
