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
  console.log("CHECKING resolved_outcome FIELD COVERAGE");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    // Check coverage
    const coverage = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          SUM(CASE WHEN resolved_outcome IS NOT NULL THEN 1 ELSE 0 END) as with_resolution,
          ROUND(100.0 * SUM(CASE WHEN resolved_outcome IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as coverage_pct
        FROM trades_raw
      `,
      format: "JSONCompact"
    });

    const text = await coverage.text();
    const data = JSON.parse(text).data || [];

    if (data[0]) {
      console.log(`Total trades:           ${data[0][0]}`);
      console.log(`With resolved_outcome:  ${data[0][1]}`);
      console.log(`Coverage:               ${data[0][2]}%\n`);
    }

    // Check niggemon specifically
    console.log("NIGGEMON (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0):");
    console.log("─".repeat(70));
    const niggemon = await ch.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN resolved_outcome IS NOT NULL THEN 1 ELSE 0 END) as resolved,
          SUM(CASE WHEN resolved_outcome IS NOT NULL AND resolved_outcome = outcome_index THEN shares ELSE 0 END) as winning_shares,
          COUNT(DISTINCT market_id) as markets
        FROM trades_raw
        WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
      `,
      format: "JSONCompact"
    });

    const nigText = await niggemon.text();
    const nigData = JSON.parse(nigText).data || [];

    if (nigData[0]) {
      console.log(`  Total trades:          ${nigData[0][0]}`);
      console.log(`  Resolved trades:       ${nigData[0][1]}`);
      console.log(`  Winning shares held:   ${nigData[0][2]}`);
      console.log(`  Unique markets:        ${nigData[0][3]}\n`);
    }

    // Check HolyMoses7
    console.log("HOLYMOSES7 (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8):");
    console.log("─".repeat(70));
    const holy = await ch.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN resolved_outcome IS NOT NULL THEN 1 ELSE 0 END) as resolved,
          SUM(CASE WHEN resolved_outcome IS NOT NULL AND resolved_outcome = outcome_index THEN shares ELSE 0 END) as winning_shares,
          COUNT(DISTINCT market_id) as markets
        FROM trades_raw
        WHERE lower(wallet_address) = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
      `,
      format: "JSONCompact"
    });

    const holyText = await holy.text();
    const holyData = JSON.parse(holyText).data || [];

    if (holyData[0]) {
      console.log(`  Total trades:          ${holyData[0][0]}`);
      console.log(`  Resolved trades:       ${holyData[0][1]}`);
      console.log(`  Winning shares held:   ${holyData[0][2]}`);
      console.log(`  Unique markets:        ${holyData[0][3]}\n`);
    }

    console.log("════════════════════════════════════════════════════════════════\n");
    
    if (data[0] && parseFloat(data[0][2]) > 50) {
      console.log("✅ GOOD NEWS: resolved_outcome has >50% coverage");
      console.log("   Path forward: Use simple P&L calculation with resolved_outcome\n");
    } else {
      console.log("⚠️  resolved_outcome has <50% coverage");
      console.log("   Path forward: Need to backfill from market_resolutions_final\n");
    }

  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }
}

main().catch(console.error);
