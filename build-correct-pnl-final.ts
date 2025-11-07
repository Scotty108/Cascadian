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
  console.log("BUILDING CORRECT P&L CALCULATION");
  console.log("Logic: Resolve outcome_index based on resolved_outcome label");
  console.log("════════════════════════════════════════════════════════════════\n");

  const targets = [
    { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon", exp: 102001.46 },
    { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", exp: 89975.16 },
    { addr: "0x7f3c8979d0afa00007bae4747d5347122af05613", name: "LucasMeow", exp: 179243 },
    { addr: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", name: "xcnstrategy", exp: 94730 }
  ];

  for (const target of targets) {
    try {
      const result = await ch.query({
        query: `
          SELECT
            COUNT(*) as total_trades,
            
            -- NET CASHFLOW (cost basis)
            SUM(CASE
              WHEN toString(side) = 'BUY' THEN -(CAST(shares as Float64) * CAST(entry_price as Float64))
              WHEN toString(side) = 'SELL' THEN (CAST(shares as Float64) * CAST(entry_price as Float64))
              ELSE 0
            END) as net_cashflow,
            
            -- WINNING SHARES
            -- If resolved_outcome is not empty AND matches the outcome direction
            SUM(CASE
              WHEN resolved_outcome IS NOT NULL AND resolved_outcome != '' THEN
                CASE
                  -- For trades with outcome_index=1 (YES side), they win if label is Yes/YES
                  WHEN outcome_index = 1 AND upperUTF8(resolved_outcome) IN ('YES') THEN CAST(shares as Float64)
                  -- For trades with outcome_index=0 (NO side), they win if label is No/NO
                  WHEN outcome_index = 0 AND upperUTF8(resolved_outcome) IN ('NO') THEN CAST(shares as Float64)
                  -- For other outcomes (team names, etc), use simple index logic
                  WHEN outcome_index = 0 THEN 0  -- NO side loses if resolved_outcome is not YES
                  WHEN outcome_index = 1 THEN 0  -- YES side loses if resolved_outcome is not NO
                  ELSE 0
                END
              ELSE 0
            END) as winning_shares,
            
            COUNT(DISTINCT market_id) as markets_traded,
            COUNT(DISTINCT CASE WHEN resolved_outcome IS NOT NULL AND resolved_outcome != '' THEN market_id ELSE NULL END) as markets_with_resolution
          FROM trades_raw
          WHERE lower(wallet_address) = '${target.addr.toLowerCase()}'
        `,
        format: "JSONCompact"
      });

      const text = await result.text();
      const data = JSON.parse(text).data;

      if (data[0]) {
        const totalTrades = data[0][0];
        const cashflow = parseFloat(data[0][1]);
        const winningShares = parseFloat(data[0][2]);
        const marketsTrad = data[0][3];
        const resMarkets = data[0][4];

        const pnl = cashflow + winningShares;
        const variance = ((pnl - target.exp) / target.exp) * 100;
        const icon = Math.abs(variance) < 10 ? "✅" : "⚠️";

        console.log(`${icon} ${target.name.padEnd(15)}`);
        console.log(`   Trades: ${totalTrades} | Markets: ${marketsTrad} (${resMarkets} with resolution)`);
        console.log(`   Cashflows: $${cashflow.toFixed(2)}`);
        console.log(`   Winning shares × $1: $${winningShares.toFixed(2)}`);
        console.log(`   Calculated P&L: $${pnl.toFixed(2)}`);
        console.log(`   Expected: $${target.exp.toFixed(2)}`);
        console.log(`   Variance: ${variance.toFixed(2)}%\n`);
      }
    } catch (e: any) {
      console.log(`❌ ${target.name}: ${e.message}\n`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
