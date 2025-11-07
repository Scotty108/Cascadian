#!/usr/bin/env npx tsx
/**
 * Step 4: Settlement Rules Verification
 * Tests the correct application of signed cashflows and settlement logic
 * Per the coaching spec: BUY negative, SELL positive, settlement = 1.0 per winning share
 */
import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

// Settlement rules as per coaching script
interface SettlementTest {
  name: string;
  side: string;
  price: number;
  shares: number;
  outcome_index: number;
  winning_index: number;
  fee_usd: number;
  slippage_usd: number;
  expected_cashflow: number;
  expected_settlement: number;
  expected_pnl: number;
}

const unitTests: SettlementTest[] = [
  {
    name: "Long-Win: BUY 100 shares @ $0.50, Win",
    side: "BUY",
    price: 0.5,
    shares: 100,
    outcome_index: 0,
    winning_index: 0,
    fee_usd: 1.0,
    slippage_usd: 0.5,
    expected_cashflow: -(100 * 0.5) - 1.0 - 0.5, // -51.50
    expected_settlement: 100 * 1.0, // 100.00
    expected_pnl: 100 - 51.5, // 48.50
  },
  {
    name: "Long-Lose: BUY 100 shares @ $0.50, Lose",
    side: "BUY",
    price: 0.5,
    shares: 100,
    outcome_index: 0,
    winning_index: 1,
    fee_usd: 1.0,
    slippage_usd: 0.5,
    expected_cashflow: -(100 * 0.5) - 1.0 - 0.5, // -51.50
    expected_settlement: 0, // No settlement
    expected_pnl: 0 - 51.5, // -51.50
  },
  {
    name: "Short-Win: SELL 100 shares @ $0.50, Lose",
    side: "SELL",
    price: 0.5,
    shares: -100, // shorts are negative shares
    outcome_index: 1,
    winning_index: 0,
    fee_usd: 1.0,
    slippage_usd: 0.5,
    expected_cashflow: (100 * 0.5) - 1.0 - 0.5, // 48.50
    expected_settlement: 100 * 1.0, // 100.00 (short on loser gets paid)
    expected_pnl: 100 + 48.5, // 148.50
  },
  {
    name: "Short-Lose: SELL 100 shares @ $0.50, Win",
    side: "SELL",
    price: 0.5,
    shares: -100,
    outcome_index: 0,
    winning_index: 0,
    fee_usd: 1.0,
    slippage_usd: 0.5,
    expected_cashflow: (100 * 0.5) - 1.0 - 0.5, // 48.50
    expected_settlement: 0, // No settlement (short on winner loses)
    expected_pnl: 0 + 48.5, // 48.50
  },
];

async function main() {
  console.log("════════════════════════════════════════════════════════");
  console.log("STEP 4: SETTLEMENT RULES VERIFICATION");
  console.log("════════════════════════════════════════════════════════\n");

  console.log("Running 4 unit tests for settlement math...\n");

  let passed = 0;
  let failed = 0;

  for (const test of unitTests) {
    console.log(`Test: ${test.name}`);

    // Calculate signed cashflow
    const sign = test.side === "BUY" ? -1 : 1;
    const abs_shares = Math.abs(test.shares);
    const signed_cashflow = sign * test.price * abs_shares - test.fee_usd - test.slippage_usd;

    // Settlement logic
    let settlement = 0;
    if (test.side === "BUY") {
      // Long position
      if (test.outcome_index === test.winning_index) {
        settlement = abs_shares * 1.0; // Long on winner
      }
      // else: Long on loser: settlement = 0
    } else {
      // Short position (SELL)
      if (test.outcome_index !== test.winning_index) {
        settlement = abs_shares * 1.0; // Short on loser
      }
      // else: Short on winner: settlement = 0
    }

    // PnL = Settlement + Signed Cashflow (signed cashflow is negative for buys, positive for sells)
    const realized_pnl = settlement + signed_cashflow;

    const cashflow_match = Math.abs(signed_cashflow - test.expected_cashflow) < 0.01;
    const settlement_match = Math.abs(settlement - test.expected_settlement) < 0.01;
    const pnl_match = Math.abs(realized_pnl - test.expected_pnl) < 0.01;

    console.log(`  Cashflow:    ${signed_cashflow.toFixed(2)} (expected ${test.expected_cashflow.toFixed(2)}) ${cashflow_match ? "✅" : "❌"}`);
    console.log(`  Settlement:  ${settlement.toFixed(2)} (expected ${test.expected_settlement.toFixed(2)}) ${settlement_match ? "✅" : "❌"}`);
    console.log(`  Realized PnL: ${realized_pnl.toFixed(2)} (expected ${test.expected_pnl.toFixed(2)}) ${pnl_match ? "✅" : "❌"}`);

    if (cashflow_match && settlement_match && pnl_match) {
      passed++;
      console.log("  ✅ PASS\n");
    } else {
      failed++;
      console.log("  ❌ FAIL\n");
    }
  }

  console.log("════════════════════════════════════════════════════════");
  console.log(`Tests: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log("✅ All settlement rules verified correctly!");
    console.log("\nReady for Step 5: Outcome mapping sanity check");
  } else {
    console.log("❌ Settlement rules have errors. Fix before proceeding.");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
