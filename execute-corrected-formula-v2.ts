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
  console.log("EXECUTING CORRECTED P&L FORMULA v2 (Separated Aggregations)");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  console.log("Formula Logic:");
  console.log("─".repeat(70));
  console.log("1. Sum net_shares where outcome_idx = win_idx");
  console.log("2. Sum all cashflows");
  console.log("3. Realized P&L = net_shares_winning - total_cashflows\n");

  try {
    console.log("Executing calculation...");
    
    const result = await ch.query({
      query: `
        WITH winning_shares AS (
          SELECT
            p.wallet,
            sum(toFloat64(p.net_shares)) AS winning_net_shares
          FROM outcome_positions_v2 AS p
          JOIN winning_index AS w ON w.condition_id_norm = p.condition_id_norm
          WHERE p.outcome_idx = w.win_idx
          GROUP BY p.wallet
        ),
        total_cashflows AS (
          SELECT
            wallet,
            sum(toFloat64(cashflow_usdc)) AS total_cf
          FROM trade_cashflows_v3
          GROUP BY wallet
        )
        SELECT
          w.wallet,
          round(w.winning_net_shares - coalesce(c.total_cf, 0), 2) AS realized_pnl_usd,
          w.winning_net_shares,
          coalesce(c.total_cf, 0) AS total_cashflows
        FROM winning_shares AS w
        LEFT JOIN total_cashflows AS c ON c.wallet = w.wallet
        WHERE lower(w.wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        ORDER BY w.wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("✅ Calculation complete\n");

    console.log("════════════════════════════════════════════════════════════════");
    console.log("RESULTS");
    console.log("════════════════════════════════════════════════════════════════\n");
    
    const expectedValues: Record<string, number> = {
      "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0": 102001,
      "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8": 89975
    };

    for (const row of data) {
      const wallet = row[0];
      const pnl = parseFloat(row[1]);
      const winning = parseFloat(row[2]);
      const cashflows = parseFloat(row[3]);

      const walletName = wallet === niggemon ? "niggemon" : wallet === holymoses ? "HolyMoses7" : "OTHER";
      const expected = expectedValues[wallet];
      const variance = expected ? ((pnl - expected) / expected) * 100 : null;

      console.log(`${walletName}:`);
      console.log(`  Winning shares: $${winning.toFixed(2)}`);
      console.log(`  Total cashflows: $${cashflows.toFixed(2)}`);
      console.log(`  Calculated P&L: $${pnl.toFixed(2)}`);
      console.log(`  Expected P&L:   $${expected.toFixed(2)}`);
      if (variance !== null) {
        console.log(`  Variance:       ${variance.toFixed(2)}%`);
        console.log(`  Status:         ${Math.abs(variance) <= 5 ? "✅ PASS" : "❌ FAIL"}`);
      }
      console.log();
    }

    console.log("═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`❌ Error: ${e.message}\n`);
  }
}

main().catch(console.error);
