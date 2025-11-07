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
  console.log("DIAGNOSTIC: ACTUAL FIELD VALUES FOR NIGGEMON");
  console.log("════════════════════════════════════════════════════════════════\n");

  const wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  try {
    // Check what the actual side values are
    console.log("1️⃣  SIDE VALUES:");
    const sides = await ch.query({
      query: `
        SELECT DISTINCT side, toTypeName(side) as type, COUNT(*) as cnt
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet}'
        GROUP BY side
      `,
      format: "JSONCompact"
    });
    const sideText = await sides.text();
    const sideData = JSON.parse(sideText).data || [];
    sideData.forEach((r: any) => console.log(`   ${r[0]} (${r[1]}): ${r[2]} trades`));

    // Check is_resolved values
    console.log("\n2️⃣  is_resolved VALUES:");
    const resolved = await ch.query({
      query: `
        SELECT DISTINCT is_resolved, toTypeName(is_resolved) as type, COUNT(*) as cnt
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet}'
        GROUP BY is_resolved
      `,
      format: "JSONCompact"
    });
    const resolvedText = await resolved.text();
    const resolvedData = JSON.parse(resolvedText).data || [];
    resolvedData.forEach((r: any) => console.log(`   ${r[0]} (${r[1]}): ${r[2]} trades`));

    // Check winning_outcome values
    console.log("\n3️⃣  winning_outcome VALUES (first 10):");
    const winning = await ch.query({
      query: `
        SELECT DISTINCT winning_outcome, toTypeName(winning_outcome) as type, COUNT(*) as cnt
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet}'
          AND winning_outcome IS NOT NULL
        GROUP BY winning_outcome
        LIMIT 10
      `,
      format: "JSONCompact"
    });
    const winningText = await winning.text();
    const winningData = JSON.parse(winningText).data || [];
    winningData.forEach((r: any) => console.log(`   "${r[0]}" (${r[1]}): ${r[2]} trades`));

    // Check sample trades with values
    console.log("\n4️⃣  SAMPLE 5 TRADES WITH KEY FIELDS:");
    const sample = await ch.query({
      query: `
        SELECT
          side,
          entry_price,
          shares,
          is_resolved,
          winning_outcome,
          (shares * CAST(entry_price AS Float64)) as trade_value
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet}'
        LIMIT 5
      `,
      format: "JSONCompact"
    });
    const sampleText = await sample.text();
    const sampleData = JSON.parse(sampleText).data || [];
    console.log("   side | entry_price | shares | is_resolved | winning_outcome | trade_value");
    sampleData.forEach((r: any) => {
      console.log(`   ${String(r[0]).padEnd(4)} | ${String(r[1]).padEnd(11)} | ${String(r[2]).padEnd(6)} | ${r[3]} | ${String(r[4]).padEnd(15)} | ${r[5]}`);
    });

    // Check what happens with cashflow calculation
    console.log("\n5️⃣  CASHFLOW CALCULATION TEST:");
    const cashflow = await ch.query({
      query: `
        SELECT
          SUM(CASE
            WHEN side = 'BUY' THEN -(shares * CAST(entry_price AS Float64))
            WHEN side = 'SELL' THEN (shares * CAST(entry_price AS Float64))
            ELSE 0
          END) as total_cashflow,
          
          SUM(shares * CAST(entry_price AS Float64)) as gross_trades_value,
          
          COUNT(CASE WHEN side = 'BUY' THEN 1 END) as buy_count,
          COUNT(CASE WHEN side = 'SELL' THEN 1 END) as sell_count
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet}'
      `,
      format: "JSONCompact"
    });
    const cashflowText = await cashflow.text();
    const cashflowData = JSON.parse(cashflowText).data || [];
    if (cashflowData[0]) {
      console.log(`   Total cashflow: ${cashflowData[0][0]}`);
      console.log(`   Gross trades value: ${cashflowData[0][1]}`);
      console.log(`   Buy trades: ${cashflowData[0][2]}`);
      console.log(`   Sell trades: ${cashflowData[0][3]}`);
    }

  } catch (e: any) {
    console.error("Error:", e.message);
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
