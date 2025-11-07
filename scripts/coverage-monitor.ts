#!/usr/bin/env npx tsx
import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

async function main() {
  console.log("════════════════════════════════════════════════════════");
  console.log("COVERAGE MONITOR - Real-time tracking");
  console.log("════════════════════════════════════════════════════════\n");

  const wallets = [
    "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", // HolyMoses7
    "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0"  // niggemon
  ];

  try {
    // Check condition_id coverage
    const cond_result = await ch.query({
      query: `
        SELECT
          wallet_address,
          countIf(condition_id != '') as with_condition,
          count() as total,
          round(100.0 * with_condition / total, 2) as pct_with_condition
        FROM trades_raw
        WHERE wallet_address IN ('${wallets.join("','")}')
        GROUP BY wallet_address
        ORDER BY wallet_address
      `,
      format: "TabSeparated"
    });
    const cond_text = await cond_result.text();
    console.log("📊 CONDITION_ID Coverage:");
    console.log(cond_text);

    // Check market_id coverage
    const market_result = await ch.query({
      query: `
        SELECT
          wallet_address,
          countIf(market_id != '') as with_market,
          count() as total,
          round(100.0 * with_market / total, 2) as pct_with_market
        FROM trades_raw
        WHERE wallet_address IN ('${wallets.join("','")}')
        GROUP BY wallet_address
        ORDER BY wallet_address
      `,
      format: "TabSeparated"
    });
    const market_text = await market_result.text();
    console.log("\n📊 MARKET_ID Coverage:");
    console.log(market_text);

    // Check join coverage to resolutions
    const join_result = await ch.query({
      query: `
        SELECT
          t.wallet_address,
          count() as total_fills,
          countIf(wi.winning_index IS NOT NULL) as matched_to_resolution,
          round(100.0 * matched_to_resolution / total_fills, 2) as pct_coverage
        FROM trades_raw t
        LEFT JOIN winning_index wi ON lower(replaceAll(t.condition_id, '0x', '')) = wi.condition_id_norm
        WHERE t.wallet_address IN ('${wallets.join("','")}')
        GROUP BY t.wallet_address
        ORDER BY t.wallet_address
      `,
      format: "TabSeparated"
    });
    const join_text = await join_result.text();
    console.log("\n📊 RESOLUTION JOIN Coverage (after normalization):");
    console.log(join_text);

    // Check for duplicate trade_ids per wallet
    const dedup_result = await ch.query({
      query: `
        SELECT
          wallet_address,
          count() as raw_rows,
          uniqExact(trade_id) as unique_trade_ids,
          count() - uniqExact(trade_id) as duplicate_rows
        FROM trades_raw
        WHERE wallet_address IN ('${wallets.join("','")}')
        GROUP BY wallet_address
        ORDER BY wallet_address
      `,
      format: "TabSeparated"
    });
    const dedup_text = await dedup_result.text();
    console.log("\n🔑 DEDUP Status (trade_id):");
    console.log(dedup_text);

    console.log("\n════════════════════════════════════════════════════════");
    console.log("✅ Coverage monitor snapshot complete at", new Date().toISOString());
  } catch (error: any) {
    console.error("❌ Error:", error.message);
  }

  process.exit(0);
}

main();
