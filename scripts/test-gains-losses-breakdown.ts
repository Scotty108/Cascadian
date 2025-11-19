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
  console.log("DIAGNOSTIC: REALIZED GAINS VS LOSSES (RESOLVED TRADES ONLY)");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  try {
    // Test 1: Verify table status
    console.log("Step 1: Verify P&L table status\n");
    
    try {
      const result = await ch.query({
        query: `SELECT count() as cnt FROM wallet_pnl_summary_v2`,
        format: "JSONCompact"
      });
      const text = await result.text();
      const data = JSON.parse(text).data || [];
      console.log(`✅ wallet_pnl_summary_v2 exists: ${data[0][0]} rows`);
    } catch (e) {
      console.log(`❌ wallet_pnl_summary_v2 not found or empty`);
    }

    // Test 2: Analyze gains vs losses for resolved conditions
    console.log("\nStep 2: Analyze realized gains vs losses (RESOLVED ONLY)\n");

    const result = await ch.query({
      query: `
        WITH winning_outcomes AS (
          SELECT condition_id_norm, toInt16(win_idx) AS win_idx
          FROM winning_index
          WHERE win_idx IS NOT NULL
        ),
        per_condition_analysis AS (
          SELECT
            lower(p.wallet) AS wallet,
            p.condition_id_norm,
            -- Winning shares (what we got from winning position)
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) AS winning_shares,
            -- Cashflows (what we paid for all positions)
            sum(toFloat64(c.cashflow_usdc)) AS total_cashflows,
            -- Payout value (settlement at $1 per share)
            sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) * 1.00 AS payout_value,
            -- Component P&L
            (sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx + 1) * 1.00) + sum(toFloat64(c.cashflow_usdc)) AS pnl_per_condition
          FROM outcome_positions_v2 AS p
          LEFT JOIN winning_outcomes AS w ON w.condition_id_norm = p.condition_id_norm
          LEFT JOIN trade_cashflows_v3 AS c ON 
            (c.wallet = p.wallet) AND (c.condition_id_norm = p.condition_id_norm)
          WHERE w.win_idx IS NOT NULL  -- Only resolved markets
          GROUP BY p.wallet, p.condition_id_norm
        ),
        summary AS (
          SELECT
            wallet,
            sum(winning_shares) AS total_winning_shares,
            sum(total_cashflows) AS total_cashflows,
            sum(payout_value) AS total_payout,
            sum(pnl_per_condition) AS total_pnl,
            -- Count gains vs losses
            countIf(pnl_per_condition > 0) AS winning_conditions,
            countIf(pnl_per_condition < 0) AS losing_conditions,
            -- Sum of gains and losses separately
            sumIf(pnl_per_condition, pnl_per_condition > 0) AS realized_gains,
            sumIf(pnl_per_condition, pnl_per_condition < 0) AS realized_losses
          FROM per_condition_analysis
          GROUP BY wallet
        )
        SELECT
          wallet,
          round(total_winning_shares, 2) AS winning_shares,
          round(total_cashflows, 2) AS cashflows,
          round(total_payout, 2) AS payout,
          winning_conditions,
          losing_conditions,
          round(realized_gains, 2) AS gains,
          round(realized_losses, 2) AS losses,
          round(realized_gains + realized_losses, 2) AS net_pnl
        FROM summary
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Results (RESOLVED TRADES ONLY):");
    console.log("─".repeat(70));

    const expectedValues: Record<string, { gains: number; losses: number; net: number }> = {
      [niggemon]: { gains: 297637.31, losses: -195687.76, net: 102001 },
      [holymoses]: { gains: 0, losses: 0, net: 89975 }  // Estimate
    };

    for (const row of data) {
      const wallet = row[0];
      const winShares = parseFloat(row[1]);
      const cashflows = parseFloat(row[2]);
      const payout = parseFloat(row[3]);
      const winCount = parseInt(row[4]);
      const lossCount = parseInt(row[5]);
      const gains = parseFloat(row[6]);
      const losses = parseFloat(row[7]);
      const net = parseFloat(row[8]);

      const walletName = wallet.includes("eb6f") ? "niggemon" : "HolyMoses7";
      const expected = expectedValues[wallet] || { gains: 0, losses: 0, net: 0 };

      console.log(`\n${walletName}:`);
      console.log(`  Winning shares (value): $${winShares.toFixed(2)}`);
      console.log(`  Cashflows paid:         $${cashflows.toFixed(2)}`);
      console.log(`  Payout at $1/share:     $${payout.toFixed(2)}`);
      console.log(`  Winning conditions:     ${winCount}`);
      console.log(`  Losing conditions:      ${lossCount}`);
      console.log(`\n  Realized GAINS:         $${gains.toFixed(2)} (expected: $${expected.gains.toFixed(2)})`);
      console.log(`  Realized LOSSES:        $${losses.toFixed(2)} (expected: $${expected.losses.toFixed(2)})`);
      console.log(`  NET P&L:                $${net.toFixed(2)} (expected: ~$${expected.net.toFixed(2)})`);
      
      if (Math.abs(gains - expected.gains) < 10000) {
        console.log(`  ✅ GAINS MATCH!`);
      }
      if (Math.abs(losses - expected.losses) < 10000) {
        console.log(`  ✅ LOSSES MATCH!`);
      }
      if (Math.abs(net - expected.net) < 5000) {
        console.log(`  ✅ NET P&L MATCH!`);
      }
    }

    console.log("\n" + "═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
