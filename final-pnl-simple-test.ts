#!/usr/bin/env npx tsx
/**
 * FINAL P&L CALCULATION: Simple Direct Approach
 *
 * Uses trades_raw directly without complex views/joins
 * Side: 1 = BUY, 2 = SELL
 * Market filter: resolved markets only for realized P&L
 */

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
  console.log("FINAL P&L TEST: Direct trades_raw Approach");
  console.log("════════════════════════════════════════════════════════════════\n");

  const targets = [
    {
      addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
      name: "niggemon",
      expected: 102001.46,
    },
    {
      addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      name: "HolyMoses7",
      expected: 89975.16,
    },
    {
      addr: "0x7f3c8979d0afa00007bae4747d5347122af05613",
      name: "LucasMeow",
      expected: 179243,
    },
  ];

  for (const target of targets) {
    try {
      console.log(`\n${target.name}`);
      console.log("─".repeat(70));

      // REALIZED P&L: Only trades in resolved markets
      const realizedResult = await ch.query({
        query: `
          SELECT
            lower(t.wallet_address) as wallet,
            COUNT(*) as trades_in_resolved,
            SUM(
              CASE
                WHEN t.side = 1 THEN -(CAST(t.shares AS Float64) * CAST(t.entry_price AS Float64))
                WHEN t.side = 2 THEN (CAST(t.shares AS Float64) * CAST(t.entry_price AS Float64))
                ELSE 0
              END
            ) as realized_pnl
          FROM trades_raw t
          WHERE lower(t.wallet_address) = lower('${target.addr}')
            AND t.market_id IN (
              SELECT DISTINCT lower(market_id)
              FROM market_resolutions_final
            )
          GROUP BY wallet
        `,
        format: "JSONCompact",
      });

      const realText = await realizedResult.text();
      const realData = JSON.parse(realText).data || [];

      if (realData[0]) {
        const resolvedTrades = realData[0][1];
        const realizedPnL = parseFloat(realData[0][2] || "0");
        console.log(`Realized P&L (resolved markets only):`);
        console.log(`  Trades: ${resolvedTrades}`);
        console.log(`  P&L: $${realizedPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      } else {
        console.log(`Realized P&L: No resolved markets`);
      }

      // TOTAL CASHFLOWS: All trades (realized + unrealized combined in raw form)
      const allResult = await ch.query({
        query: `
          SELECT
            lower(t.wallet_address) as wallet,
            COUNT(*) as total_trades,
            SUM(
              CASE
                WHEN t.side = 1 THEN -(CAST(t.shares AS Float64) * CAST(t.entry_price AS Float64))
                WHEN t.side = 2 THEN (CAST(t.shares AS Float64) * CAST(t.entry_price AS Float64))
                ELSE 0
              END
            ) as total_cashflows
          FROM trades_raw t
          WHERE lower(t.wallet_address) = lower('${target.addr}')
          GROUP BY wallet
        `,
        format: "JSONCompact",
      });

      const allText = await allResult.text();
      const allData = JSON.parse(allText).data || [];

      if (allData[0]) {
        const totalTrades = allData[0][1];
        const totalCashflows = parseFloat(allData[0][2] || "0");
        console.log(`\nTotal Cashflows (all trades):`);
        console.log(`  Trades: ${totalTrades}`);
        console.log(`  Total: $${totalCashflows.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

        // Compare
        console.log(`\nExpected: $${target.expected.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
        const variance = ((totalCashflows - target.expected) / target.expected) * 100;
        console.log(`Variance: ${variance.toFixed(2)}%`);

        if (Math.abs(variance) < 5) {
          console.log(`✅ WITHIN 5% - This is the correct P&L!`);
        } else if (Math.abs(variance) < 10) {
          console.log(`⚠️  Within 10% - Close match`);
        } else {
          console.log(`❌ Variance too high - Need to investigate`);
        }
      }
    } catch (e: any) {
      console.log(`❌ Error: ${e.message}`);
    }
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");
  console.log("INTERPRETATION:");
  console.log("- If total_cashflows matches expected within 5%");
  console.log("- Then we've found the working formula");
  console.log("- Build production views from this query\n");
}

main().catch(console.error);
