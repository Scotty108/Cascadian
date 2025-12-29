#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 120000,
});

async function main() {
  const wallet = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║   CALCULATING P&L WITH gamma_resolved                         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Sample from gamma_resolved to understand structure
  console.log("STEP 1: Sample gamma_resolved data\n");

  const sample = await ch.query({
    query: `
      SELECT
        cid,
        winning_outcome,
        closed
      FROM gamma_resolved
      LIMIT 5
    `,
    format: "JSONCompact"
  });

  const sampleText = await sample.text();
  const sampleData = JSON.parse(sampleText).data;
  
  console.log("Sample records:");
  for (const [cid, outcome, closed] of sampleData) {
    console.log(`  CID: ${cid?.substring(0, 16)}... | Outcome: ${outcome} | Closed: ${closed}`);
  }

  // Now calculate P&L
  console.log("\n\nSTEP 2: Calculate P&L using gamma_resolved (niggemon)\n");

  try {
    const pnl = await ch.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          COUNT(DISTINCT lower(replaceAll(tr.condition_id, '0x', ''))) as resolved_markets,
          SUM(
            IF(
              tr.outcome_index = 
              IF(gr.winning_outcome = 'YES', 0, 1),
              CAST(tr.shares AS Float64) * 1.0,
              0
            ) -
            CAST(tr.entry_price AS Float64) * CAST(tr.shares AS Float64) *
            IF(tr.side = 'YES', 1, -1)
          ) as pnl
        FROM trades_raw tr
        LEFT JOIN gamma_resolved gr 
          ON lower(replaceAll(tr.condition_id, '0x', '')) = lower(gr.cid)
        WHERE tr.wallet_address = lower('${wallet}')
          AND gr.cid IS NOT NULL
      `,
      format: "JSONCompact"
    });

    const pnlText = await pnl.text();
    const pnlData = JSON.parse(pnlText).data;
    const [trades, markets, totalPnl] = pnlData[0];

    const variance = ((totalPnl - 102001.46) / 102001.46 * 100).toFixed(2);
    const icon = Math.abs(variance) < 10 ? "✅" : "❌";

    console.log(`${icon} Trades matched to resolved markets: ${trades}`);
    console.log(`  Resolved markets: ${markets}`);
    console.log(`  Calculated P&L: $${totalPnl?.toFixed(2) || '0.00'}`);
    console.log(`  Target P&L: $102,001.46`);
    console.log(`  Variance: ${variance}%\n`);
  } catch (e: any) {
    console.log(`  ERROR: ${e.message.substring(0, 80)}\n`);
  }

  // Try without the winning_outcome logic
  console.log("STEP 3: Calculate simple sum of all cashflows\n");

  try {
    const simple = await ch.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          SUM(CAST(entry_price AS Float64) * CAST(shares AS Float64) * 
              IF(side = 'YES', 1, -1)) as total_cashflows
        FROM trades_raw
        WHERE wallet_address = lower('${wallet}')
      `,
      format: "JSONCompact"
    });

    const simpleText = await simple.text();
    const simpleData = JSON.parse(simpleText).data;
    const [trades, cashflows] = simpleData[0];

    console.log(`  Total trades: ${trades}`);
    console.log(`  Total cashflows: $${cashflows?.toFixed(2) || '0.00'}`);
    console.log(`  Target P&L: $102,001.46`);
    console.log(`  Difference: $${(102001.46 - cashflows)?.toFixed(2)}\n`);
  } catch (e: any) {
    console.log(`  ERROR: ${e.message.substring(0, 80)}\n`);
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              DIAGNOSIS COMPLETE                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
