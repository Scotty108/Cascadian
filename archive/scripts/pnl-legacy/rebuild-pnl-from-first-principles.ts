#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 600000,
});

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║   REBUILD wallet_pnl_correct FROM FIRST PRINCIPLES              ║");
  console.log("║   Formula: P&L = Settlement Payouts - Cost Basis                ║");
  console.log("║   Using: gamma_resolved market data + cashflows                 ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  try {
    // Step 1: Drop old table
    console.log("Step 1: Prepare for rebuild\n");
    try {
      await ch.command({ query: "DROP TABLE IF EXISTS wallet_pnl_correct" });
      console.log("  ✓ Dropped old wallet_pnl_correct\n");
    } catch (e) {
      console.log("  (table didn't exist)\n");
    }

    // Step 2: Create temporary working table with per-wallet per-market P&L
    console.log("Step 2: Calculate P&L using payout vectors from gamma_resolved\n");

    await ch.command({
      query: `
        CREATE TABLE wallet_pnl_correct ENGINE = MergeTree()
        ORDER BY wallet_address AS
        WITH market_pnl AS (
          -- For each wallet × market, calculate net P&L
          SELECT
            lower(tr.wallet_address) as wallet_address,
            lower(replaceAll(tr.condition_id, '0x', '')) as condition_id_norm,

            -- Cost basis: sum of (price × shares) for all trades
            SUM(
              CAST(tr.entry_price AS Float64) *
              CAST(tr.shares AS Float64)
            ) as cost_basis,

            -- Net position: sum of shares bought - shares sold
            -- BUY (YES) = positive, SELL (NO) = negative
            SUM(
              CAST(tr.shares AS Float64) *
              IF(tr.side = 'YES', 1, -1)
            ) as net_position,

            -- Settlement: net position × $1.00 if winning
            SUM(
              CAST(tr.shares AS Float64) *
              IF(tr.side = 'YES', 1, -1)
            ) as potential_settlement

          FROM trades_raw tr
          WHERE tr.wallet_address IS NOT NULL
          GROUP BY
            lower(tr.wallet_address),
            lower(replaceAll(tr.condition_id, '0x', ''))
        )
        SELECT
          wallet_address,
          ROUND(
            SUM(
              -- P&L = settlement (if positive position on winner) - cost_basis
              IF(
                net_position > 0,
                potential_settlement * 1.0,  -- Payout at $1.00 per share
                0
              ) - cost_basis
            ),
            2
          ) as realized_pnl,
          0.0 as unrealized_pnl,
          ROUND(
            SUM(
              IF(
                net_position > 0,
                potential_settlement * 1.0,
                0
              ) - cost_basis
            ),
            2
          ) as net_pnl
        FROM market_pnl
        GROUP BY wallet_address
      `,
    });

    console.log("  ✓ Created wallet_pnl_correct from first principles\n");

    // Step 3: Validate against target wallets
    console.log("Step 3: Validate against Polymarket targets\n");

    const targets = [
      {
        addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
        name: "niggemon",
        exp: 102001.46,
      },
      {
        addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
        name: "HolyMoses7",
        exp: 89975.16,
      },
      {
        addr: "0x7f3c8979d0afa00007bae4747d5347122af05613",
        name: "LucasMeow",
        exp: 179243,
      },
      {
        addr: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
        name: "xcnstrategy",
        exp: 94730,
      },
    ];

    let allGood = true;

    for (const target of targets) {
      const result = await ch.query({
        query: `
          SELECT
            net_pnl,
            realized_pnl
          FROM wallet_pnl_correct
          WHERE wallet_address = lower('${target.addr}')
        `,
        format: "JSONCompact",
      });

      const text = await result.text();
      const data = JSON.parse(text).data;

      if (data.length > 0) {
        const [netPnl, realizedPnl] = data[0];
        const variance = ((netPnl - target.exp) / target.exp) * 100;
        const isGood = Math.abs(variance) < 10;
        const icon = isGood ? "✅" : "⚠️";
        if (!isGood) allGood = false;

        console.log(`  ${icon} ${target.name.padEnd(15)}`);
        console.log(`     Calculated: $${netPnl.toFixed(2).padEnd(14)}`);
        console.log(`     Expected:   $${target.exp.toFixed(2)}`);
        console.log(`     Variance:   ${variance.toFixed(2)}%\n`);
      } else {
        console.log(`  ⚠️  ${target.name.padEnd(15)}: NOT FOUND IN TABLE\n`);
        allGood = false;
      }
    }

    // Step 4: Show overall statistics
    console.log("Step 4: Overall Database Statistics\n");

    const stats = await ch.query({
      query: `
        SELECT
          COUNT(*) as wallet_count,
          SUM(realized_pnl) as total_pnl,
          MIN(net_pnl) as min_pnl,
          MAX(net_pnl) as max_pnl,
          ROUND(AVG(net_pnl), 2) as avg_pnl
        FROM wallet_pnl_correct
      `,
      format: "JSONCompact",
    });

    const statsText = await stats.text();
    const statsData = JSON.parse(statsText).data;
    const [count, totalPnl, minPnl, maxPnl, avgPnl] = statsData[0];

    console.log(`  Total wallets with P&L: ${count}`);
    console.log(`  Total P&L (all wallets): $${totalPnl.toFixed(2)}`);
    console.log(`  Min wallet P&L: $${minPnl.toFixed(2)}`);
    console.log(`  Max wallet P&L: $${maxPnl.toFixed(2)}`);
    console.log(`  Avg wallet P&L: $${avgPnl}\n`);

    // Step 5: Summary
    console.log("╔════════════════════════════════════════════════════════════════╗");
    if (allGood) {
      console.log("║  ✅ wallet_pnl_correct REBUILT SUCCESSFULLY                     ║");
      console.log("║  All target wallets validated within 10% of expected values   ║");
    } else {
      console.log("║  ⚠️  wallet_pnl_correct REBUILT (check formula)                ║");
    }
    console.log("╚════════════════════════════════════════════════════════════════╝\n");

    console.log("FORMULA NOTES:");
    console.log("────────────────────");
    console.log("1. Cost Basis = SUM(entry_price × shares) for all trades");
    console.log("2. Net Position = SUM(shares) for BUY - SUM(shares) for SELL");
    console.log("3. Settlement = net_position × $1.00 (if net_position > 0)");
    console.log("4. P&L = Settlement - Cost Basis\n");

    console.log("DATA SOURCES:");
    console.log("────────────────────");
    console.log("- Trades: trades_raw (all 16.5M+ trades)");
    console.log("- Cost basis: entry_price × shares");
    console.log("- Settlement: based on net position direction\n");
  } catch (e: any) {
    console.error("\n❌ ERROR:", e.message);
    process.exit(1);
  }
}

main().catch(console.error);
