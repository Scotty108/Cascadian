#!/usr/bin/env npx tsx
/**
 * ULTRA SIMPLE P&L: No subqueries, just raw trades_raw
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
  console.log("ULTRA SIMPLE P&L TEST");
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
      console.log(`\n${target.name.padEnd(20)}`);
      console.log("─".repeat(70));

      // TOTAL CASHFLOWS: All trades, simple calculation
      const result = await ch.query({
        query: `
          SELECT
            COUNT(*) as total_trades,
            SUM(
              CASE
                WHEN side = 1 THEN -(CAST(shares AS Float64) * CAST(entry_price AS Float64))
                WHEN side = 2 THEN (CAST(shares AS Float64) * CAST(entry_price AS Float64))
                ELSE 0
              END
            ) as total_pnl
          FROM trades_raw
          WHERE lower(wallet_address) = lower('${target.addr}')
        `,
        format: "JSONCompact",
      });

      const text = await result.text();
      const data = JSON.parse(text).data || [];

      if (data[0]) {
        const totalTrades = data[0][0];
        const totalPnL = parseFloat(data[0][1] || "0");

        console.log(`Total trades: ${totalTrades}`);
        console.log(`Total P&L: $${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
        console.log(`Expected: $${target.expected.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

        const variance = ((totalPnL - target.expected) / target.expected) * 100;
        console.log(`Variance: ${variance.toFixed(2)}%`);

        if (Math.abs(variance) < 5) {
          console.log(`✅ MATCH! Within 5%`);
        } else if (Math.abs(variance) < 10) {
          console.log(`⚠️  Close (within 10%)`);
        } else {
          console.log(`❌ Mismatch (> 10%)`);
        }
      }
    } catch (e: any) {
      console.log(`❌ Error: ${e.message}`);
    }
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
