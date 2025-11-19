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
  console.log("SIMPLE CHECK: Does trade_idx from trade_flows_v2 = outcome_index from trades_raw?");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    const result = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          SUM(CASE WHEN CAST(t.outcome_index AS Int16) = tf.trade_idx THEN 1 ELSE 0 END) as exact_matches,
          SUM(CASE WHEN CAST(t.outcome_index AS Int16) = tf.trade_idx - 1 THEN 1 ELSE 0 END) as off_by_minus_one,
          SUM(CASE WHEN CAST(t.outcome_index AS Int16) = tf.trade_idx + 1 THEN 1 ELSE 0 END) as off_by_plus_one
        FROM trades_raw t
        INNER JOIN trade_flows_v2 tf ON lower(t.wallet_address) = lower(tf.wallet)
                                       AND lower(t.market_id) = lower(tf.market_id)
        LIMIT 1000000
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data[0];

    const total = parseFloat(data[0]);
    const exact = parseFloat(data[1]);
    const minus_one = parseFloat(data[2]);
    const plus_one = parseFloat(data[3]);

    console.log(`Total rows sampled: ${total.toLocaleString()}`);
    console.log(`Exact match (outcome_index = trade_idx): ${exact.toLocaleString()} (${((exact/total)*100).toFixed(2)}%)`);
    console.log(`Off by -1 (outcome_index = trade_idx - 1): ${minus_one.toLocaleString()} (${((minus_one/total)*100).toFixed(2)}%)`);
    console.log(`Off by +1 (outcome_index = trade_idx + 1): ${plus_one.toLocaleString()} (${((plus_one/total)*100).toFixed(2)}%)`);

    console.log("\n════════════════════════════════════════════════════════════════");
    console.log("IMPLICATION:");
    console.log("════════════════════════════════════════════════════════════════\n");

    if (exact > (minus_one + plus_one)) {
      console.log("✅ trade_idx DIRECTLY matches outcome_index");
      console.log("   → Use outcome_index from the view, not trade_idx");
    } else if (minus_one > (exact + plus_one)) {
      console.log("⚠️  trade_idx is 1 position AHEAD of outcome_index");
      console.log("   → outcome_index = trade_idx - 1");
    } else if (plus_one > (exact + minus_one)) {
      console.log("⚠️  trade_idx is 1 position BEHIND outcome_index");
      console.log("   → outcome_index = trade_idx + 1");
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
