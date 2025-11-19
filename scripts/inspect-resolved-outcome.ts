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
  console.log("INSPECTING resolved_outcome DATA");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    // Check what values are in the trades for niggemon
    const sample = await ch.query({
      query: `
        SELECT
          outcome_index,
          resolved_outcome,
          toTypeName(outcome_index) as outcome_type,
          toTypeName(resolved_outcome) as resolved_type,
          count() as cnt
        FROM trades_raw
        WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
        GROUP BY outcome_index, resolved_outcome
        ORDER BY cnt DESC
        LIMIT 20
      `,
      format: "JSONCompact"
    });

    const text = await sample.text();
    const data = JSON.parse(text).data;

    if (data.length > 0) {
      console.log("outcome_index | resolved_outcome | outcome_type | resolved_type | count");
      console.log("".padEnd(70, "-"));
      data.forEach((row: any) => {
        console.log(`${String(row[0]).padEnd(14)} | ${String(row[1]).padEnd(16)} | ${row[2].padEnd(12)} | ${row[3].padEnd(13)} | ${row[4]}`);
      });
    }

    // Check if outcome_index and resolved_outcome ever match
    console.log("\n\nCHECKING FOR MATCHES:\n");
    const matches = await ch.query({
      query: `
        SELECT
          count() as total_trades,
          countIf(outcome_index = resolved_outcome) as matching_trades,
          ROUND(100.0 * countIf(outcome_index = resolved_outcome) / count(), 2) as match_pct
        FROM trades_raw
        WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
      `,
      format: "JSONCompact"
    });

    const mText = await matches.text();
    const mData = JSON.parse(mText).data;

    if (mData[0]) {
      console.log(`Total trades: ${mData[0][0]}`);
      console.log(`Matching outcome_index = resolved_outcome: ${mData[0][1]}`);
      console.log(`Match percentage: ${mData[0][2]}%\n`);
    }

    // Check what the actual cashflow values are
    console.log("CASHFLOW CALCULATION:\n");
    const cashflow = await ch.query({
      query: `
        SELECT
          COUNT(*) as trades,
          SUM(CAST(shares as Float64) * CAST(entry_price as Float64)) as gross_value,
          SUM(CASE WHEN side = 'BUY' THEN CAST(shares as Float64) * CAST(entry_price as Float64) ELSE 0 END) as buy_value,
          SUM(CASE WHEN side = 'SELL' THEN CAST(shares as Float64) * CAST(entry_price as Float64) ELSE 0 END) as sell_value
        FROM trades_raw
        WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
      `,
      format: "JSONCompact"
    });

    const cText = await cashflow.text();
    const cData = JSON.parse(cText).data;

    if (cData[0]) {
      console.log(`Total trades: ${cData[0][0]}`);
      console.log(`Total value (all sides): $${cData[0][1]}`);
      console.log(`BUY value: $${cData[0][2]}`);
      console.log(`SELL value: $${cData[0][3]}`);
      console.log(`Net (SELL - BUY): $${(cData[0][3] - cData[0][2])}`);
    }

  } catch (e: any) {
    console.error("Error:", e.message);
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
