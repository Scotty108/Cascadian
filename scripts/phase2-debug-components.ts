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
  console.log("DEBUG: ANALYZE FORMULA COMPONENTS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    console.log("Components for niggemon:\n");
    
    const result = await ch.query({
      query: `
        SELECT
          round(sum(f.cash_usd), 2) AS total_cashflows,
          round(sum(ws.win_shares), 2) AS total_win_shares,
          round(sum(f.cash_usd) + sum(ws.win_shares), 2) AS formula_cashflows_plus_shares,
          round(sum(ws.win_shares) - sum(f.cash_usd), 2) AS formula_shares_minus_cashflows,
          round(abs(sum(f.cash_usd)) + abs(sum(ws.win_shares)), 2) AS formula_abs_both
        FROM flows_by_condition_v1 AS f
        LEFT JOIN winning_shares_v1 AS ws ON 
          f.wallet = ws.wallet AND f.condition_id_norm = ws.condition_id_norm
        WHERE lower(f.wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    if (data.length > 0) {
      const row = data[0];
      console.log("Values:");
      console.log("─".repeat(70));
      console.log(`Cashflows:                           $${parseFloat(row[0]).toFixed(2)}`);
      console.log(`Win shares:                          $${parseFloat(row[1]).toFixed(2)}`);
      console.log(`Formula (cash + shares):             $${parseFloat(row[2]).toFixed(2)}`);
      console.log(`Formula (shares - cash):             $${parseFloat(row[3]).toFixed(2)}`);
      console.log(`Formula (|cash| + |shares|):         $${parseFloat(row[4]).toFixed(2)}`);
      
      console.log("\nExpected: $102,001 ± $3,000");
      console.log("\n" + "═".repeat(70));
      
      // Analyze which formula is closest
      const vals = [
        { name: "cash + shares", val: parseFloat(row[2]) },
        { name: "shares - cash", val: parseFloat(row[3]) },
        { name: "|cash| + |shares|", val: parseFloat(row[4]) }
      ];
      
      vals.sort((a, b) => Math.abs(a.val - 102001) - Math.abs(b.val - 102001));
      
      console.log(`\nFormula distance from expected ($102,001):`);
      for (const v of vals) {
        const dist = Math.abs(v.val - 102001);
        const pct = (dist / 102001 * 100).toFixed(2);
        console.log(`  ${v.name.padEnd(25)}: $${dist.toFixed(2)} (${pct}% off)`);
      }
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
