#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function executeQuery(query: string) {
  try {
    await ch.query({ query });
    return { success: true, error: null };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("EXECUTING THE WORKING FIX");
  console.log("Formula: net_shares_in_winner - total_cashflows");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Step 1: Create the realized_pnl_by_market_final view with correct formula
  console.log("📋 Creating realized_pnl_by_market_final...\n");

  const createRealizedPnl = `
    CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
    WITH win AS (
      SELECT 
        condition_id_norm, 
        toInt16(win_idx) AS win_idx, 
        resolved_at 
      FROM winning_index
    )
    SELECT 
      p.wallet,
      p.market_id,
      p.condition_id_norm,
      w.resolved_at,
      round(sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx) - sum(toFloat64(c.cashflow_usdc)), 4) AS realized_pnl_usd
    FROM outcome_positions_v2 AS p
    ANY LEFT JOIN trade_cashflows_v3 AS c 
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w 
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE w.win_idx IS NOT NULL
    GROUP BY p.wallet, p.market_id, p.condition_id_norm, w.resolved_at
  `;

  let result = await executeQuery(createRealizedPnl);
  if (result.success) {
    console.log(`  ✅ Created realized_pnl_by_market_final\n`);
  } else {
    console.log(`  ❌ ERROR: ${result.error}\n`);
    process.exit(1);
  }

  // Step 2: Create wallet_realized_pnl_final
  console.log("📋 Creating wallet_realized_pnl_final...\n");

  const createWalletRealizedPnl = `
    CREATE OR REPLACE VIEW wallet_realized_pnl_final AS
    SELECT 
      wallet,
      round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
    FROM realized_pnl_by_market_final
    GROUP BY wallet
  `;

  result = await executeQuery(createWalletRealizedPnl);
  if (result.success) {
    console.log(`  ✅ Created wallet_realized_pnl_final\n`);
  } else {
    console.log(`  ❌ ERROR: ${result.error}\n`);
    process.exit(1);
  }

  // Step 3: Test the results
  console.log("════════════════════════════════════════════════════════════════");
  console.log("TESTING RESULTS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  try {
    const testResult = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd
        FROM wallet_realized_pnl_final
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await testResult.text();
    const data = JSON.parse(text).data || [];

    console.log("Target Wallets Results:");
    console.log("─".repeat(70) + "\n");

    for (const row of data) {
      const wallet = row[0];
      const pnl = parseFloat(row[1]);

      if (wallet.includes("eb6f")) {
        const variance = ((pnl - 102001) / 102001) * 100;
        console.log(`niggemon:       $${pnl.toFixed(2)}`);
        console.log(`Expected:       $102,001.46`);
        console.log(`Variance:       ${variance.toFixed(2)}%`);
        console.log(variance >= -5 && variance <= 5 ? "✅ PASS\n" : "❌ FAIL\n");
      } else if (wallet.includes("a4b3")) {
        const variance = ((pnl - 89975) / 89975) * 100;
        console.log(`HolyMoses7:     $${pnl.toFixed(2)}`);
        console.log(`Expected:       $89,975.16`);
        console.log(`Variance:       ${variance.toFixed(2)}%`);
        console.log(variance >= -5 && variance <= 5 ? "✅ PASS\n" : "❌ FAIL\n");
      }
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
