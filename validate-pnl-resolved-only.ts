#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  PHASE 4: P&L VALIDATION (RESOLVED CONDITIONS ONLY)           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const wallets = [
    { addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", name: "niggemon (ref)", exp: 102001.46, tol: 2 },
    { addr: "0x7f3c8979d0afa00007bae4747d5347122af05613", name: "LucasMeow", exp: 179243, tol: 5 },
    { addr: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", name: "xcnstrategy", exp: 94730, tol: 5 },
    { addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", exp: 93181, tol: 5 },
  ];

  let passed = 0;
  let failed = 0;

  for (const wallet of wallets) {
    // Calculate P&L using ONLY resolved conditions (those in winning_index)
    const result = await queryData(`
      SELECT
        round(sum(c.cashflow_usdc) - sumIf(p.net_shares, p.outcome_idx = w.win_idx), 2) AS realized_pnl,
        round(coalesce(u.unrealized_pnl_usd, 0), 2) AS unrealized_pnl,
        round(realized_pnl + unrealized_pnl, 2) AS total_pnl,
        count(DISTINCT p.condition_id_norm) as resolved_conditions
      FROM outcome_positions_v2 AS p
      INNER JOIN winning_index AS w ON p.condition_id_norm = w.condition_id_norm
      LEFT JOIN trade_cashflows_v3 AS c
        ON c.wallet = p.wallet AND c.condition_id_norm = p.condition_id_norm
      LEFT JOIN wallet_unrealized_pnl_v2 AS u ON u.wallet = p.wallet
      WHERE p.wallet = lower('${wallet.addr}')
    `);

    let actual = 0;
    let resolvedCount = 0;
    if (result && result.length > 0) {
      actual = parseFloat(result[0][2]) || 0;
      resolvedCount = result[0][3] || 0;
    }

    const variance = wallet.exp === 0 ? 0 : ((actual - wallet.exp) / wallet.exp) * 100;
    const pass = Math.abs(variance) <= wallet.tol;

    if (pass) {
      passed++;
      const padName = wallet.name.padEnd(20);
      const padExp = wallet.exp.toString().padEnd(10);
      const padAct = actual.toString().padEnd(15);
      const padVar = variance.toFixed(1).padEnd(7);
      console.log(`✅ ${padName} | Expected: $${padExp} | Actual: $${padAct} | Variance: ${padVar}% | Resolved: ${resolvedCount}`);
    } else {
      failed++;
      const padName = wallet.name.padEnd(20);
      const padExp = wallet.exp.toString().padEnd(10);
      const padAct = actual.toString().padEnd(15);
      const padVar = variance.toFixed(1).padEnd(7);
      console.log(`❌ ${padName} | Expected: $${padExp} | Actual: $${padAct} | Variance: ${padVar}% | Resolved: ${resolvedCount}`);
    }
  }

  console.log(`\n${passed}/${wallets.length} tests passed`);

  if (passed === wallets.length) {
    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║         PHASE 4: ✅ PASSED - All P&L values correct!          ║");
    console.log("╚════════════════════════════════════════════════════════════════╝\n");
  } else {
    console.log(`\n❌ PHASE 4: FAILED - ${failed} wallets outside tolerance`);
    console.log("\n⚠️  NOTE: P&L calculated only for RESOLVED conditions in winning_index.");
    console.log("   Many positions are unresolved and contribute $0 to current P&L.");
  }
}

main().catch(e => console.error("Fatal:", e.message));
