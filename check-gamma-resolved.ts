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
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║   CHECKING gamma_resolved TABLE                               ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Check schema
  console.log("SCHEMA of gamma_resolved:\n");
  const schema = await ch.query({
    query: "DESC gamma_resolved",
    format: "JSONCompact"
  });

  const schemaText = await schema.text();
  const schemaData = JSON.parse(schemaText).data;
  
  for (const [name, type] of schemaData) {
    console.log(`  ${name.padEnd(25)} ${type}`);
  }

  // Check how many markets are resolved
  console.log("\n\nResolution Coverage:");
  console.log("─".repeat(60));

  const coverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as resolved_markets,
        (SELECT COUNT(DISTINCT lower(replaceAll(condition_id, '0x', '')))
         FROM trades_raw
         WHERE wallet_address = lower('${wallet}')) as total_markets_in_wallet
      FROM gamma_resolved
    `,
    format: "JSONCompact"
  });

  const coverageText = await coverage.text();
  const coverageData = JSON.parse(coverageText).data;
  const [resolvedMarkets, totalMarkets] = coverageData[0];
  
  console.log(`  Resolved markets in gamma_resolved: ${resolvedMarkets}`);
  console.log(`  Total unique markets for niggemon: ${totalMarkets}`);
  console.log(`  Coverage: ${((resolvedMarkets / totalMarkets) * 100).toFixed(1)}%\n`);

  // Try to calculate P&L using gamma_resolved
  console.log("\nAttempting P&L calculation using gamma_resolved...\n");

  try {
    const pnl = await ch.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          COUNT(DISTINCT gr.condition_id) as resolved_markets,
          SUM(
            IF(
              tr.outcome_index = gr.winning_outcome_index,
              CAST(tr.shares AS Float64) * 1.0,
              0
            ) -
            CAST(tr.entry_price AS Float64) * CAST(tr.shares AS Float64) *
            IF(tr.side = 'YES', 1, -1)
          ) as pnl
        FROM trades_raw tr
        INNER JOIN gamma_resolved gr 
          ON lower(replaceAll(tr.condition_id, '0x', '')) = lower(replaceAll(gr.condition_id, '0x', ''))
        WHERE tr.wallet_address = lower('${wallet}')
      `,
      format: "JSONCompact"
    });

    const pnlText = await pnl.text();
    const pnlData = JSON.parse(pnlText).data;
    const [trades, markets, totalPnl] = pnlData[0];

    console.log(`  Trades matched to resolved markets: ${trades}`);
    console.log(`  Resolved markets: ${markets}`);
    console.log(`  Calculated P&L: $${totalPnl?.toFixed(2) || '0.00'}`);
    console.log(`  Target P&L: $102,001.46`);
    console.log(`  Variance: ${(((totalPnl - 102001.46) / 102001.46) * 100).toFixed(2)}%`);
  } catch (e: any) {
    console.log(`  ERROR: ${e.message.substring(0, 100)}`);
  }

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║              DIAGNOSIS COMPLETE                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
