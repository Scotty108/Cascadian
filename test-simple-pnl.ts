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
  console.log("TESTING SIMPLE P&L USING EXISTING FIELDS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const targets = [
    { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon", exp: 102001.46 },
    { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", exp: 89975.16 },
  ];

  for (const target of targets) {
    try {
      // Approach 1: Sum pnl_net for resolved trades
      const result1 = await ch.query({
        query: `
          SELECT
            COUNT(*) as total_trades,
            SUM(CAST(pnl_net AS Float64)) as total_pnl_from_net,
            COUNT(CASE WHEN is_resolved = 1 THEN 1 END) as resolved_trades,
            SUM(CASE WHEN is_resolved = 1 THEN CAST(pnl_net AS Float64) ELSE 0 END) as pnl_resolved_only
          FROM trades_raw
          WHERE lower(wallet_address) = '${target.addr.toLowerCase()}'
        `,
        format: "JSONCompact"
      });

      const text1 = await result1.text();
      const data1 = JSON.parse(text1).data;

      console.log(`${target.name.padEnd(15)}`);
      console.log("─".repeat(60));
      
      if (data1[0]) {
        const totalTrades = data1[0][0];
        const pnlFromNet = parseFloat(data1[0][1]);
        const resolvedTrades = data1[0][2];
        const pnlResolved = parseFloat(data1[0][3]);

        console.log(`  Total trades: ${totalTrades}`);
        console.log(`  Resolved trades: ${resolvedTrades}`);
        console.log(`  Sum(pnl_net) [all]: $${pnlFromNet.toFixed(2)}`);
        console.log(`  Sum(pnl_net) [resolved only]: $${pnlResolved.toFixed(2)}`);
        console.log(`  Expected: $${target.exp.toFixed(2)}`);
        
        const var1 = ((pnlFromNet - target.exp) / target.exp * 100);
        const var2 = ((pnlResolved - target.exp) / target.exp * 100);
        
        console.log(`  Variance (all): ${var1.toFixed(2)}%`);
        console.log(`  Variance (resolved): ${var2.toFixed(2)}%`);
      }

      // Approach 2: Sum pnl_gross
      const result2 = await ch.query({
        query: `
          SELECT
            SUM(CAST(pnl_gross AS Float64)) as total_pnl_gross
          FROM trades_raw
          WHERE lower(wallet_address) = '${target.addr.toLowerCase()}'
        `,
        format: "JSONCompact"
      });

      const text2 = await result2.text();
      const data2 = JSON.parse(text2).data;
      
      if (data2[0]) {
        const pnlGross = parseFloat(data2[0][0]);
        const varGross = ((pnlGross - target.exp) / target.exp * 100);
        console.log(`  Sum(pnl_gross): $${pnlGross.toFixed(2)} (variance: ${varGross.toFixed(2)}%)`);
      }

      console.log();

    } catch (e: any) {
      console.log(`❌ ${target.name}: ${e.message}\n`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
