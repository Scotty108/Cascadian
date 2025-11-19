#!/usr/bin/env npx tsx
/**
 * PHASE 4 EXECUTION: Comprehensive P&L Validation
 *
 * Tests our P&L formula across diverse wallets:
 * 1. niggemon (reference: $102,001)
 * 2. LucasMeow, xcnstrategy, HolyMoses7 (Priority 1)
 * 3. 3 additional wallets (Priority 2 spot-check)
 *
 * Pass criteria: ±5% variance from expected values
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: "JSONCompact" });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

interface WalletTest {
  address: string;
  name: string;
  expected: number;
  tolerance: number;
  priority: string;
}

async function testWallet(wallet: WalletTest): Promise<{
  name: string;
  expected: number;
  actual: number;
  variance: number;
  status: string;
}> {
  const query = `
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index
    )
    SELECT
      round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS realized_pnl,
      round(coalesce(u.unrealized_pnl_usd, 0), 2) AS unrealized_pnl,
      round(realized_pnl + unrealized_pnl, 2) AS total_pnl
    FROM outcome_positions_v2 AS p
    ANY LEFT JOIN trade_cashflows_v3 AS c
      ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
    ANY LEFT JOIN win AS w
      ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    LEFT JOIN wallet_unrealized_pnl_v2 AS u ON u.wallet = p.wallet
    WHERE p.wallet = lower('${wallet.address}')
    GROUP BY p.wallet, u.unrealized_pnl_usd
  `;

  const result = await queryData(query);
  let actual = 0;

  if (result && result.length > 0) {
    actual = parseFloat(result[0][2]) || 0;
  }

  const variance = wallet.expected > 0 ? ((actual - wallet.expected) / wallet.expected) * 100 : 0;
  const withinTolerance = Math.abs(variance) <= wallet.tolerance;
  const status = withinTolerance ? "✅ PASS" : "❌ FAIL";

  return {
    name: wallet.name,
    expected: wallet.expected,
    actual,
    variance,
    status,
  };
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║        PHASE 4 EXECUTION: COMPREHENSIVE P&L VALIDATION         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const wallets: WalletTest[] = [
    // Priority 1: Core reference wallets
    {
      address: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
      name: "niggemon (ref)",
      expected: 102001.46,
      tolerance: 2,
      priority: "Priority 1 (Reference)",
    },
    {
      address: "0x7f3c8979d0afa00007bae4747d5347122af05613",
      name: "LucasMeow",
      expected: 179243,
      tolerance: 5,
      priority: "Priority 1",
    },
    {
      address: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
      name: "xcnstrategy",
      expected: 94730,
      tolerance: 5,
      priority: "Priority 1",
    },
    {
      address: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      name: "HolyMoses7",
      expected: 93181,
      tolerance: 5,
      priority: "Priority 1",
    },
    // Priority 2: Extended validation (spot-check)
    {
      address: "0x4ce73141dbfce41e65db3723e31059a730f0abad",
      name: "Wallet P2-1",
      expected: 332563,
      tolerance: 10,
      priority: "Priority 2 (spot-check)",
    },
    {
      address: "0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144",
      name: "Wallet P2-2",
      expected: 114087,
      tolerance: 10,
      priority: "Priority 2 (spot-check)",
    },
    {
      address: "0x1f0a343513aa6060488fabe96960e6d1e177f7aa",
      name: "Wallet P2-3",
      expected: 101576,
      tolerance: 10,
      priority: "Priority 2 (spot-check)",
    },
  ];

  console.log("TEST PLAN:");
  console.log("─".repeat(65));
  console.log("✓ Priority 1 (4 wallets): ±2-5% tolerance");
  console.log("✓ Priority 2 (3 wallets): ±10% tolerance (spot-check only)");
  console.log("✓ Total: 7 wallets across diverse portfolio types\n");

  console.log("RUNNING VALIDATION TESTS:");
  console.log("─".repeat(65));

  const results: typeof testWallet[] = [];
  for (const wallet of wallets) {
    const result = await testWallet(wallet);
    results.push(result);

    const expectedStr = `$${result.expected.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    const actualStr = `$${result.actual.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    const varianceStr = `${result.variance > 0 ? "+" : ""}${result.variance.toFixed(1)}%`;

    console.log(
      `${result.name.padEnd(20)}: ${result.status.padEnd(12)} | Expected: ${expectedStr.padEnd(15)} | Actual: ${actualStr.padEnd(15)} | Variance: ${varianceStr}`
    );
  }

  console.log("");

  // Count passes
  const passCount = results.filter((r) => r.status.includes("✅")).length;
  const failCount = results.filter((r) => r.status.includes("❌")).length;

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION GATES
  // ═══════════════════════════════════════════════════════════════════════════

  const priority1Results = results.slice(0, 4);
  const priority2Results = results.slice(4);

  const priority1Pass = priority1Results.every((r) => r.status.includes("✅"));
  const priority2Pass = priority2Results.filter((r) => r.status.includes("✅")).length >= 2;

  const allGatesPassed = priority1Pass && priority2Pass;

  console.log("╔════════════════════════════════════════════════════════════════╗");
  if (allGatesPassed) {
    console.log("║              PHASE 4: ✅ PASSED - READY FOR PHASE 5           ║");
  } else {
    console.log("║              PHASE 4: ❌ FAILED - REVIEW ABOVE                 ║");
  }
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("VALIDATION SUMMARY:");
  console.log("─".repeat(65));
  console.log(`Total tests: ${results.length}`);
  console.log(`Passed: ${passCount} ✅`);
  console.log(`Failed: ${failCount} ❌`);
  console.log("");

  if (priority1Pass) {
    console.log("✅ PRIORITY 1 GATE: All 4 core wallets within tolerance");
  } else {
    console.log("❌ PRIORITY 1 GATE: Some core wallets outside tolerance");
  }

  if (priority2Pass) {
    console.log(`✅ PRIORITY 2 GATE: ${priority2Results.filter((r) => r.status.includes("✅")).length}/3 spot-checks passed`);
  } else {
    console.log(`❌ PRIORITY 2 GATE: Only ${priority2Results.filter((r) => r.status.includes("✅")).length}/3 spot-checks passed`);
  }

  console.log("");

  if (allGatesPassed) {
    console.log("NEXT: Phase 5 - Dry-run deployment test\n");
    process.exit(0);
  } else {
    console.log("ACTION: Review failed wallets above. Check P&L calculation formula.\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
