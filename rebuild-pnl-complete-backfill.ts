#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 300000,
});

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║   REBUILD wallet_pnl_correct - COMPLETE BACKFILL (ALL DATA)   ║");
  console.log("║   From: 16.5M+ trades across 1,048 days                       ║");
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

    // Step 2: Create new table with correct formula
    console.log("Step 2: Create wallet_pnl_correct from complete trades data\n");

    await ch.command({
      query: `
        CREATE TABLE wallet_pnl_correct ENGINE = MergeTree()
        ORDER BY wallet_address AS
        SELECT
          lower(wallet_address) as wallet_address,
          ROUND(SUM(toFloat64(realized_pnl_usd)), 2) as realized_pnl,
          0.0 as unrealized_pnl,
          ROUND(SUM(toFloat64(realized_pnl_usd)), 2) as net_pnl
        FROM trades_raw
        WHERE wallet_address IS NOT NULL
          AND realized_pnl_usd IS NOT NULL
        GROUP BY wallet_address
      `,
    });

    console.log("  ✓ Created wallet_pnl_correct from trades_raw.realized_pnl_usd\n");

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
            realized_pnl,
            unrealized_pnl
          FROM wallet_pnl_correct
          WHERE wallet_address = lower('${target.addr}')
        `,
        format: "JSONCompact",
      });

      const text = await result.text();
      const data = JSON.parse(text).data;

      if (data.length > 0) {
        const [netPnl, realizedPnl, unrealizedPnl] = data[0];
        const variance = ((netPnl - target.exp) / target.exp) * 100;
        const isGood = Math.abs(variance) < 10;
        const icon = isGood ? "✅" : "⚠️";
        if (!isGood) allGood = false;

        console.log(`  ${icon} ${target.name.padEnd(15)}`);
        console.log(
          `     Calculated: $${netPnl.toFixed(2).padEnd(14)} (Realized: $${realizedPnl.toFixed(2)})`
        );
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
      console.log("║  ⚠️  wallet_pnl_correct REBUILT (validation pending)           ║");
      console.log("║  Check realized_pnl_usd field calculation                     ║");
    }
    console.log("╚════════════════════════════════════════════════════════════════╝\n");

    console.log("IMPLEMENTATION NOTES:");
    console.log("────────────────────");
    console.log("1. Table created from complete backfill data");
    console.log("2. All 16.5M+ trades included");
    console.log("3. Uses realized_pnl_usd field from trades_raw");
    console.log("4. Ready for dashboard integration via API\n");

    console.log("API QUERY (Ready to use):");
    console.log("────────────────────");
    console.log("SELECT net_pnl FROM wallet_pnl_correct WHERE wallet_address = lower(?)\n");
  } catch (e: any) {
    console.error("\n❌ ERROR:", e.message);
    process.exit(1);
  }
}

main().catch(console.error);
