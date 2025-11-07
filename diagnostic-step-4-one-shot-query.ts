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
  console.log("DIAGNOSTIC STEP 4: ONE-SHOT REALIZED P&L CALCULATION");
  console.log("(Bypassing outcome_positions_v2 joins - using trade_cashflows_v3)");
  console.log("════════════════════════════════════════════════════════════════\n");

  const targets = [
    { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon", expected: 102001.46 },
    { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", expected: 89975.16 },
    { addr: "0x5a68e8e4f4c0a5a6f7b8c9d0e1f2a3b4c5d6e7f8", name: "LucasMeow", expected: 179243 },
    { addr: "0x1234567890abcdef1234567890abcdef12345678", name: "xcnstrategy", expected: 94730 }
  ];

  console.log("Using simple cashflow approach (realized P&L only):\n");
  console.log("Formula: P&L = SUM(cashflows from trades in resolved markets only)\n");

  for (const target of targets) {
    try {
      const result = await ch.query({
        query: `
          SELECT
            count() as trades_in_resolved,
            sum(CAST(c.cashflow_usdc AS Float64)) as realized_pnl
          FROM trade_cashflows_v3 c
          INNER JOIN winning_index w ON c.condition_id_norm = w.condition_id_norm
          WHERE lower(c.wallet) = lower('${target.addr}')
        `,
        format: "JSONCompact"
      });

      const text = await result.text();
      const data = JSON.parse(text).data || [];

      if (data[0]) {
        const tradeCount = data[0][0];
        const pnl = parseFloat(data[0][1] || "0");
        const variance = ((pnl - target.expected) / target.expected * 100).toFixed(2);
        const match = Math.abs(parseFloat(variance)) < 5;

        console.log(`${target.name.padEnd(15)}`);
        console.log(`  Expected: $${target.expected.toLocaleString()}`);
        console.log(`  Actual:   $${pnl.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
        console.log(`  Variance: ${variance}%`);
        console.log(`  Trades:   ${tradeCount}\n`);

        if (match) {
          console.log(`  ✅ MATCH WITHIN 5%!\n`);
        } else if (parseFloat(variance) > 0) {
          console.log(`  ⚠️  Under-calculated (missing ${Math.abs(pnl - target.expected).toLocaleString()} in value)\n`);
        } else {
          console.log(`  ⚠️  Over-calculated (excess ${Math.abs(pnl - target.expected).toLocaleString()} in value)\n`);
        }
      }

    } catch (e: any) {
      console.log(`${target.name}: Error - ${e.message}\n`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════\n");
  console.log("ANALYSIS:");
  console.log("If these match within 5% → We've found the correct formula");
  console.log("If not → We need to add unrealized P&L or fix data issues\n");
}

main().catch(console.error);
