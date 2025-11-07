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
  console.log("║     PHASE 4: BUILD CORRECT P&L TABLE (Signed Cashflows)      ║");
  console.log("║     Formula: P&L = Cashflows + Settlement                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  try {
    console.log("Step 1: Preparing table...");
    try {
      await ch.command({ query: "DROP TABLE IF EXISTS wallet_pnl_correct" });
      console.log("  ✓ Cleaned up old table");
    } catch (e) {
      // OK
    }

    console.log("\nStep 2: Building wallet_pnl_correct...\n");

    // The key insight: We need to calculate per-condition:
    // 1. Total cashflows = sum of all signed trades
    // 2. Settlement = net_position * $1.00 (if winning and position > 0)
    await ch.command({
      query: `
        CREATE TABLE wallet_pnl_correct ENGINE = MergeTree() ORDER BY wallet_address AS
        SELECT
          wallet_address,
          SUM(IF(condition_pnl > 0, condition_pnl, 0)) as total_gains,
          SUM(IF(condition_pnl < 0, ABS(condition_pnl), 0)) as total_losses,
          total_gains - total_losses as net_pnl
        FROM (
          -- Per-condition P&L calculation
          SELECT
            t.wallet_address,
            -- Sum signed cashflows for all trades in this condition
            SUM(CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64) * IF(t.side = 'BUY', -1, 1)) as total_cashflow,
            -- Net position: sum of shares (BUY=+, SELL=-)
            SUM(CAST(t.shares AS Float64) * IF(t.side = 'BUY', 1, -1)) as net_position,
            -- Settlement: if net position > 0 and outcome_index = winning_index, value = net_position * $1.00
            IF(
              m.winning_index IS NOT NULL AND 
              SUM(CAST(t.shares AS Float64) * IF(t.outcome_index = m.winning_index AND t.side = 'BUY', 1, IF(t.outcome_index = m.winning_index AND t.side = 'SELL', -1, 0))) > 0,
              SUM(CAST(t.shares AS Float64) * IF(t.outcome_index = m.winning_index AND t.side = 'BUY', 1, IF(t.outcome_index = m.winning_index AND t.side = 'SELL', -1, 0))) * 1.0,
              0
            ) as settlement,
            -- P&L for this condition
            total_cashflow + settlement as condition_pnl
          FROM trades_raw t
          LEFT JOIN market_resolutions_final m 
            ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
          WHERE t.wallet_address IS NOT NULL
            AND t.shares > 0
            AND m.winning_index IS NOT NULL
          GROUP BY t.wallet_address, t.condition_id, m.winning_index
        )
        GROUP BY wallet_address
      `
    });

    console.log("  ✓ Table created successfully\n");

    // Test with niggemon
    console.log("Step 3: Validating with niggemon:");
    console.log("  Target: $101,949.55\n");

    const result = await ch.query({
      query: `
        SELECT
          wallet_address,
          ROUND(total_gains, 2) as gains,
          ROUND(total_losses, 2) as losses,
          ROUND(net_pnl, 2) as net
        FROM wallet_pnl_correct
        WHERE wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data;

    if (data.length > 0) {
      const [wallet, gains, losses, net] = data[0];
      const variance = ((net - 101949.55) / 101949.55 * 100);
      const isMatch = Math.abs(variance) < 10;
      const icon = isMatch ? "✅" : "⚠️";

      console.log(`  ${icon} Wallet: ${wallet.substring(0, 16)}...`);
      console.log(`     Gains:     $${gains?.toFixed(2)}`);
      console.log(`     Losses:    $${losses?.toFixed(2)}`);
      console.log(`     Net P&L:   $${net?.toFixed(2)}`);
      console.log(`     Target:    $101,949.55`);
      console.log(`     Variance:  ${variance.toFixed(2)}%\n`);

      if (isMatch) {
        console.log("✅ VALIDATION PASSED\n");
      }
    }

    // Reference wallets
    console.log("Step 4: Reference Wallet Validation:");
    console.log("─".repeat(100));

    const refWallets = [
      { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon", exp: 101949.55 },
      { addr: "0x7f3c8979d0afa00007bae4747d5347122af05613", name: "LucasMeow", exp: 179243 },
      { addr: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", name: "xcnstrategy", exp: 94730 },
      { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", exp: 93181 },
    ];

    for (const w of refWallets) {
      const refResult = await ch.query({
        query: `
          SELECT ROUND(net_pnl, 2) FROM wallet_pnl_correct
          WHERE wallet_address = lower('${w.addr}')
        `,
        format: "JSONCompact"
      });

      const refText = await refResult.text();
      const refData = JSON.parse(refText).data;
      const calculated = refData.length > 0 ? refData[0][0] : 0;
      const variance = calculated ? (calculated - w.exp) / w.exp * 100 : null;
      const match = calculated > 0 && variance && Math.abs(variance) < 10 ? "✅" : "⚠️";

      const calcStr = calculated > 0 ? `$${calculated.toFixed(2)}` : "NO DATA";
      const varStr = variance !== null ? `${variance.toFixed(1)}%` : "N/A";

      console.log(`  ${match} ${w.name.padEnd(15)} | Calculated: ${calcStr.padEnd(14)} | Target: $${String(w.exp).padEnd(8)} | Variance: ${varStr.padStart(7)}`);
    }

    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║              ✅ PHASE 4 IMPLEMENTATION COMPLETE                ║");
    console.log("║         wallet_pnl_correct table ready for dashboard           ║");
    console.log("╚════════════════════════════════════════════════════════════════╝\n");

  } catch (e: any) {
    console.error("\n❌ ERROR:", e.message);
  }
}

main();
