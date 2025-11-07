#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 45000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSONCompact' });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("DATA COMPLETENESS CHECK: HolyMoses7 vs Enriched Table");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Count in curated table
  console.log("1. CURATED CHAIN (outcome_positions_v2)");
  console.log("─".repeat(70));

  let result = await queryData(`
    SELECT 
      wallet,
      count() as position_count,
      count(DISTINCT market_id) as unique_markets
    FROM outcome_positions_v2
    WHERE wallet = lower('${wallet1}')
  `);

  let curated_count = 0;
  if (result && result.length > 0) {
    curated_count = result[0][1];
    console.log(`  HolyMoses7: ${curated_count} positions across ${result[0][2]} markets\n`);
  }

  // Count in enriched table
  console.log("2. ENRICHED TABLE (trades_enriched_with_condition)");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      wallet_address,
      count() as trade_count,
      count(DISTINCT market_id) as unique_markets,
      countIf(is_resolved = 1) as resolved_count
    FROM trades_enriched_with_condition
    WHERE wallet_address = lower('${wallet1}')
  `);

  let enriched_count = 0;
  if (result && result.length > 0) {
    enriched_count = result[0][1];
    console.log(`  HolyMoses7: ${enriched_count} trades across ${result[0][2]} markets`);
    console.log(`  Resolved: ${result[0][3]} trades\n`);
  }

  // Compare coverage
  console.log("3. COVERAGE COMPARISON");
  console.log("─".repeat(70));
  console.log(`  Curated positions: ${curated_count}`);
  console.log(`  Enriched trades: ${enriched_count}`);
  console.log(`  Enriched/Curated ratio: ${(enriched_count / curated_count * 100).toFixed(1)}%`);
  console.log(`  Difference: ${enriched_count - curated_count} ${enriched_count < curated_count ? '(CURATED has more)' : '(ENRICHED has more)'}\n`);

  // Check if enriched table has resolved P&L for those trades
  console.log("4. REALIZED P&L IN ENRICHED TABLE");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      sum(toFloat64(realized_pnl_usd)) as total_pnl,
      countIf(is_resolved = 1) as resolved
    FROM trades_enriched_with_condition
    WHERE wallet_address = lower('${wallet1}')
  `);

  if (result && result.length > 0) {
    console.log(`  Total realized_pnl_usd: $${parseFloat(result[0][0]).toFixed(2)}`);
    console.log(`  Resolved trades: ${result[0][1]}\n`);
  }

  // Look at market distribution
  console.log("5. TOP 10 MARKETS BY POSITION COUNT (HolyMoses7)");
  console.log("─".repeat(70));

  result = await queryData(`
    SELECT 
      market_id,
      count() as position_count,
      round(sum(net_shares), 2) as total_shares
    FROM outcome_positions_v2
    WHERE wallet = lower('${wallet1}')
    GROUP BY market_id
    ORDER BY position_count DESC
    LIMIT 10
  `);

  if (result && result.length > 0) {
    for (const r of result) {
      const market = r[0].substring(0, 20);
      console.log(`  ${market}... | ${r[1]} positions | ${r[2]} shares`);
    }
  }
  console.log("");

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
