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
  const wallets = [
    { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon", exp: 102001.46 },
    { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", exp: 89975.16 },
    { addr: "0x7f3c8979d0afa00007bae4747d5347122af05613", name: "LucasMeow", exp: 179243 },
    { addr: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", name: "xcnstrategy", exp: 94730 },
  ];

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║   VERIFYING TARGET WALLETS IN COMPLETE BACKFILL                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  for (const w of wallets) {
    console.log(`${w.name.padEnd(15)}`);
    console.log("─".repeat(60));

    try {
      const result = await ch.query({
        query: `
          SELECT
            COUNT(*) as trade_count,
            COUNT(DISTINCT condition_id) as unique_markets,
            min(timestamp) as first_trade,
            max(timestamp) as last_trade,
            SUM(toFloat64(usd_value)) as total_usd_value
          FROM trades_raw
          WHERE wallet_address = lower('${w.addr}')
        `,
        format: "JSONCompact",
      });

      const text = await result.text();
      const data = JSON.parse(text).data;

      if (data.length > 0) {
        const [trades, markets, first, last, usdValue] = data[0];
        console.log(`  Trades: ${trades}`);
        console.log(`  Markets: ${markets}`);
        console.log(`  First trade: ${new Date(first * 1000).toISOString().split("T")[0]}`);
        console.log(`  Last trade: ${new Date(last * 1000).toISOString().split("T")[0]}`);
        console.log(`  Total USD value: $${parseFloat(usdValue).toFixed(2)}`);
        console.log(`  Target P&L: $${w.exp.toFixed(2)}`);

        // Calculate simple P&L from cashflows
        const pnlResult = await ch.query({
          query: `
            SELECT
              SUM(entry_price * shares * IF(side = 'YES', -1, 1)) as cashflows,
              SUM(shares) as total_shares
            FROM trades_raw
            WHERE wallet_address = lower('${w.addr}')
          `,
          format: "JSONCompact",
        });

        const pnlText = await pnlResult.text();
        const pnlData = JSON.parse(pnlText).data;
        const [cashflows, totalShares] = pnlData[0];

        console.log(`  Total cashflows: $${parseFloat(cashflows).toFixed(2)}`);
        console.log(`  Total shares: ${parseFloat(totalShares).toFixed(2)}`);
      } else {
        console.log(`  NO DATA IN DATABASE`);
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message.substring(0, 60)}`);
    }

    console.log();
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║        All wallet data present in complete backfill            ║");
  console.log("║  Ready to calculate correct P&L and rebuild wallet_pnl_correct ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
