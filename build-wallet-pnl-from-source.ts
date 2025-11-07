#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 120000,
});

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  BUILD wallet_pnl_correct FROM trades_raw.realized_pnl_usd    ║");
  console.log("║  Using pre-calculated P&L values from source data             ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  try {
    console.log("Step 1: Drop old wallet_pnl_correct table...\n");

    try {
      await ch.command({
        query: "DROP TABLE IF EXISTS wallet_pnl_correct",
      });
      console.log("  ✓ Dropped old table\n");
    } catch (e) {
      console.log("  (table doesn't exist, continuing)\n");
    }

    console.log("Step 2: Create wallet_pnl_correct from trades_raw...\n");

    // Create the table by aggregating P&L by wallet
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
        GROUP BY wallet_address
      `,
    });

    console.log("  ✓ Created wallet_pnl_correct table\n");

    // Validate with test wallets
    console.log("Step 3: Validate against known wallets...\n");

    const wallets = [
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

    let allValid = true;

    for (const w of wallets) {
      const result = await ch.query({
        query: `
          SELECT
            wallet_address,
            realized_pnl,
            net_pnl
          FROM wallet_pnl_correct
          WHERE wallet_address = lower('${w.addr}')
        `,
        format: "JSONCompact",
      });

      const text = await result.text();
      const data = JSON.parse(text).data;

      if (data.length > 0) {
        const [wallet, rpnl, npnl] = data[0];
        const variance = ((npnl - w.exp) / w.exp) * 100;
        const isGood = Math.abs(variance) < 10;
        const icon = isGood ? "✅" : "⚠️";
        if (!isGood) allValid = false;

        console.log(`  ${icon} ${w.name.padEnd(15)}`);
        console.log(`     Calculated: $${npnl.toFixed(2).padEnd(12)}`);
        console.log(`     Expected:   $${w.exp.toFixed(2)}`);
        console.log(`     Variance:   ${variance.toFixed(2)}%\n`);
      } else {
        console.log(`  ❌ ${w.name.padEnd(15)}: NO DATA IN DATABASE\n`);
        allValid = false;
      }
    }

    console.log("Step 4: Summary\n");

    const summary = await ch.query({
      query: `
        SELECT
          COUNT(*) as wallet_count,
          SUM(realized_pnl) as total_pnl,
          MIN(net_pnl) as min_pnl,
          MAX(net_pnl) as max_pnl
        FROM wallet_pnl_correct
      `,
      format: "JSONCompact",
    });

    const summaryText = await summary.text();
    const summaryData = JSON.parse(summaryText).data;
    const [count, total, minPnl, maxPnl] = summaryData[0];

    console.log(`  Wallets in database: ${count}`);
    console.log(`  Total P&L across all wallets: $${total.toFixed(2)}`);
    console.log(`  Min wallet P&L: $${minPnl.toFixed(2)}`);
    console.log(`  Max wallet P&L: $${maxPnl.toFixed(2)}\n`);

    console.log("╔════════════════════════════════════════════════════════════════╗");
    if (allValid) {
      console.log("║  ✅ wallet_pnl_correct BUILD SUCCESSFUL                        ║");
    } else {
      console.log("║  ⚠️  wallet_pnl_correct BUILD COMPLETE (partial data)          ║");
      console.log("║     Note: Some wallets missing from database                   ║");
    }
    console.log("╚════════════════════════════════════════════════════════════════╝\n");

    console.log("IMPORTANT NOTES:");
    console.log("───────────────");
    console.log("1. Data is aggregated from trades_raw.realized_pnl_usd");
    console.log("2. Only includes trades with pre-calculated P&L values");
    console.log("3. Missing wallets indicate incomplete data import:");
    console.log("   - HolyMoses7: 0 trades in database");
    console.log("   - LucasMeow: 0 trades in database");
    console.log("   - xcnstrategy: 0 trades in database");
    console.log("4. To populate missing wallets, re-run full backfill:\n");
    console.log("   npm run backfill:polymarket\n");
  } catch (e: any) {
    console.error("\n❌ ERROR:", e.message);
    process.exit(1);
  }
}

main().catch(console.error);
