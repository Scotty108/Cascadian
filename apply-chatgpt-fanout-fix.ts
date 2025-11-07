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
  console.log("APPLYING CHATGPT FANOUT FIX: Aggregate FIRST, then join");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    const result = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        ),
        -- STEP 1: Aggregate cashflows PER CONDITION (prevent fanout)
        agg_cashflows AS (
          SELECT
            lower(wallet) AS wallet,
            condition_id_norm,
            sum(toFloat64(cashflow_usdc)) AS total_cashflows
          FROM trade_cashflows_v3
          GROUP BY wallet, condition_id_norm
        ),
        -- STEP 2: Aggregate positions per condition
        agg_positions AS (
          SELECT
            lower(wallet) AS wallet,
            condition_id_norm,
            outcome_idx,
            sum(toFloat64(net_shares)) AS net_shares
          FROM outcome_positions_v2
          GROUP BY wallet, condition_id_norm, outcome_idx
        ),
        -- STEP 3: Match to winners with OFFSET = 0
        with_winners AS (
          SELECT
            p.wallet,
            p.condition_id_norm,
            sumIf(p.net_shares, p.outcome_idx = w.win_idx) AS winning_shares,
            c.total_cashflows
          FROM agg_positions AS p
          JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
          LEFT JOIN agg_cashflows AS c ON 
            c.wallet = p.wallet AND c.condition_id_norm = p.condition_id_norm
          GROUP BY p.wallet, p.condition_id_norm, c.total_cashflows
        )
        SELECT
          lower(wallet) AS wallet,
          round(sum(winning_shares * 1.00 + coalesce(total_cashflows, 0)), 2) AS pnl
        FROM with_winners
        WHERE lower(wallet) = lower('${niggemon}')
        GROUP BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Results (ChatGPT Fanout Fix - OFFSET = 0):");
    console.log("─".repeat(70));

    for (const row of data) {
      const wallet = row[0];
      const pnl = parseFloat(row[1]);
      
      console.log(`\nWallet: ${wallet.substring(0,12)}...`);
      console.log(`P&L:    $${pnl.toFixed(2)}`);
      console.log(`Target: $102,001.00`);
      
      const diff = Math.abs(pnl - 102001);
      const pct = (diff / 102001 * 100).toFixed(2);
      
      if (diff < 5000) {
        console.log(`✅ MATCH! (${pct}% off)`);
      } else {
        console.log(`Variance: ${pct}%`);
      }
    }

    console.log("\n" + "═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
