#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 30000,
});

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  FIXING trade_flows_v2 - Using Correct Direction Assignment  ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  try {
    console.log("Step 1: Recreating trade_flows_v2 with correct direction...\n");

    // DROP the old broken view
    try {
      await ch.command({
        query: "DROP VIEW IF EXISTS trade_flows_v2"
      });
      console.log("  ✓ Dropped old trade_flows_v2");
    } catch (e) {
      // Might not exist
    }

    // CREATE CORRECTED trade_flows_v2
    await ch.command({
      query: `
        CREATE VIEW trade_flows_v2 AS
        SELECT
          lower(tr.wallet_address) AS wallet,
          lower(tr.market_id) AS market_id,
          CAST(tr.outcome_index AS Int16) AS trade_idx,
          toString(tr.outcome) AS outcome_raw,
          -- Use trade_direction_assignments to get CORRECT direction
          round(
            (CAST(tr.entry_price AS Float64) * CAST(tr.shares AS Float64)) *
            if(
              tda.direction = 'BUY',
              -1,  -- BUY: negative cashflow (money spent)
              if(
                tda.direction = 'SELL',
                1,   -- SELL: positive cashflow (money received)
                0    -- UNKNOWN: no cashflow contribution
              )
            ),
            8
          ) AS cashflow_usdc,
          -- Share delta: positive for BUY, negative for SELL
          if(
            tda.direction = 'BUY',
            CAST(tr.shares AS Float64),
            if(
              tda.direction = 'SELL',
              -CAST(tr.shares AS Float64),
              0
            )
          ) AS delta_shares
        FROM trades_raw tr
        LEFT JOIN trade_direction_assignments tda
          ON tr.transaction_hash = tda.tx_hash
          AND lower(tr.wallet_address) = lower(tda.wallet_address)
          AND lower(replaceAll(tr.condition_id, '0x', '')) = tda.condition_id_norm
        WHERE tr.market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000')
      `
    });

    console.log("  ✓ Created corrected trade_flows_v2\n");

    // Verify with niggemon
    console.log("Step 2: Validating with niggemon...\n");

    const result = await ch.query({
      query: `
        SELECT
          count() as trade_count,
          SUM(cashflow_usdc) as total_cashflows,
          SUM(delta_shares) as total_delta_shares
        FROM trade_flows_v2
        WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data;

    const tradeCount = data[0][0];
    const totalCashflows = parseFloat(data[0][1] || "0").toFixed(2);
    const totalDeltaShares = parseFloat(data[0][2] || "0").toFixed(4);

    console.log(`  Niggemon in trade_flows_v2:`);
    console.log(`    Trades: ${tradeCount}`);
    console.log(`    Total cashflows: $${totalCashflows}`);
    console.log(`    Total delta shares: ${totalDeltaShares}`);
    console.log(`    Expected: cashflows around $-102K to $102K range\n`);

    console.log("Step 3: Check realized_pnl_by_market_v2 with new trade_flows_v2...\n");

    const rpnlResult = await ch.query({
      query: `
        SELECT
          wallet,
          ROUND(SUM(realized_pnl_usd), 2) as total_realized_pnl
        FROM realized_pnl_by_market_v2
        WHERE wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        GROUP BY wallet
      `,
      format: "JSONCompact"
    });

    const rpnlText = await rpnlResult.text();
    const rpnlData = JSON.parse(rpnlText).data;

    if (rpnlData.length > 0) {
      const pnl = rpnlData[0][1];
      const variance = ((pnl - 101949.55) / 101949.55 * 100).toFixed(2);
      const isGood = Math.abs(variance) < 10;
      const icon = isGood ? "✅" : "⚠️";

      console.log(`  ${icon} Realized P&L: $${pnl}`);
      console.log(`     Target: $101,949.55`);
      console.log(`     Variance: ${variance}%\n`);
    }

    console.log("╔════════════════════════════════════════════════════════════════╗");
    console.log("║               ✅ FIX COMPLETE - trade_flows_v2 UPDATED          ║");
    console.log("╚════════════════════════════════════════════════════════════════╝\n");

  } catch (e: any) {
    console.error("\n❌ ERROR:", e.message);
    process.exit(1);
  }
}

main().catch(console.error);
