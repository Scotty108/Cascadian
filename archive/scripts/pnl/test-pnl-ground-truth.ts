// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * TDD Test: PnL Ground Truth Validation
 *
 * This script tests PnL calculations against known ground truth values.
 * Ground truth was provided directly from Goldsky (external source).
 *
 * INVESTIGATION FINDINGS:
 * ======================
 *
 * 1. ROOT CAUSE: Goldsky's pm_user_positions.realized_pnl accumulates
 *    trading profits from EVERY trade, not just final position outcomes.
 *
 * 2. MARKET MAKERS are affected most:
 *    - They trade both YES and NO on the same condition
 *    - Each profitable trade adds to realized_pnl
 *    - With 621K trades at 140 trades/position, MM profits accumulate
 *
 * 3. REGULAR TRADERS match well:
 *    - Wallet 0xb48ef6de... has 81 positions, 951 trades (11.7 trades/pos)
 *    - Goldsky PnL ($111,504) ≈ Ground Truth ($114,087) within 2%
 *
 * 4. METHODOLOGY DIFFERENCE:
 *    - Goldsky realized_pnl = cumulative trading profits (trade-level)
 *    - Ground truth appears to use position-level or condition-level PnL
 *
 * 5. KEY METRIC: trades_per_position
 *    - Low (< 15): Goldsky matches ground truth
 *    - High (> 50): Goldsky inflates PnL significantly
 *
 * HYPOTHESIS: Ground truth may calculate PnL as:
 *    - Final position value at resolution - total cost basis
 *    - OR: Net USDC flow per condition (not per token)
 *    - OR: Some de-duplication of YES/NO arbitrage profits
 *
 * @see check-whale-pnl.ts for comparison script
 * @see validate-sports-bettor-pnl.ts for WAC methodology
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

// Ground truth data from Goldsky (external source)
const GROUND_TRUTH: Array<{
  wallet: string;
  pnl: number;
  gains: number;
  losses: number;
}> = [
  { wallet: "0x4ce73141dbfce41e65db3723e31059a730f0abad", pnl: 332563, gains: 333508, losses: 945 },
  { wallet: "0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144", pnl: 114087, gains: 118922, losses: 4835 },
  { wallet: "0x1f0a343513aa6060488fabe96960e6d1e177f7aa", pnl: 107756, gains: 111455, losses: 3699 },
  { wallet: "0x06dcaa14f57d8a0573f5dc5940565e6de667af59", pnl: 181648, gains: 217261, losses: 35613 },
  { wallet: "0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed", pnl: 161509, gains: 169519, losses: 8010 },
  { wallet: "0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f", pnl: 74393, gains: 87012, losses: 12619 },
  { wallet: "0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37", pnl: 100584, gains: 101155, losses: 571 },
  { wallet: "0x12d6cccfc7470a3f4bafc53599a4779cbf2cf2a8", pnl: 100024, gains: 101247, losses: 1223 },
  { wallet: "0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db", pnl: 93971, gains: 101312, losses: 7341 },
  { wallet: "0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8", pnl: 93552, gains: 95652, losses: 2100 },
  { wallet: "0x662244931c392df70bd064fa91f838eea0bfd7a9", pnl: 90050, gains: 90050, losses: 0 },
  { wallet: "0x2e0b70d482e6b389e81dea528be57d825dd48070", pnl: 84870, gains: 88690, losses: 3820 },
  { wallet: "0x3b6fd06a595d71c70afb3f44414be1c11304340b", pnl: 84553, gains: 97591, losses: 13038 },
  { wallet: "0xd748c701ad93cfec32a3420e10f3b08e68612125", pnl: 82847, gains: 88527, losses: 5680 },
  { wallet: "0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397", pnl: 80823, gains: 82823, losses: 2000 },
  { wallet: "0xd06f0f7719df1b3b75b607923536b3250825d4a6", pnl: 78688, gains: 79333, losses: 645 },
  { wallet: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", pnl: 77188, gains: 115613, losses: 38425 },
  { wallet: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", pnl: 73628, gains: 79848, losses: 6220 },
  { wallet: "0x7f3c8979d0afa00007bae4747d5347122af05613", pnl: 72888, gains: 76898, losses: 4010 },
  { wallet: "0x1489046ca0f9980fc2d9a950d103d3bec02c1307", pnl: 66900, gains: 66900, losses: 0 },
  { wallet: "0x8e9eedf20dfa70956d49f608a205e402d9df38e4", pnl: 360492, gains: 366546, losses: 6054 },
  { wallet: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", pnl: 247219, gains: 251649, losses: 4430 },
  { wallet: "0x6770bf688b8121331b1c5cfd7723ebd4152545fb", pnl: 179044, gains: 189474, losses: 10430 },
];

interface TestResult {
  wallet: string;
  gt_pnl: number;
  calculated_pnl: number;
  goldsky_pnl: number;
  trades_per_position: number;
  match_gt: boolean;
  match_goldsky: boolean;
  gt_ratio: number;
  goldsky_ratio: number;
}

async function getWalletMetrics(wallet: string) {
  // Get position count
  const posResult = await client.query({
    query: `
      SELECT count() AS positions
      FROM pm_user_positions FINAL
      WHERE lower(proxy_wallet) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
    `,
    format: "JSONEachRow",
  });
  const positions = Number(((await posResult.json()) as any[])[0]?.positions || 0);

  // Get trade count
  const tradeResult = await client.query({
    query: `
      SELECT count() AS trades
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
    `,
    format: "JSONEachRow",
  });
  const trades = Number(((await tradeResult.json()) as any[])[0]?.trades || 0);

  // Get Goldsky realized_pnl
  const goldskyResult = await client.query({
    query: `
      SELECT sum(realized_pnl) / 1e6 AS pnl
      FROM pm_user_positions FINAL
      WHERE lower(proxy_wallet) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
    `,
    format: "JSONEachRow",
  });
  const goldsky_pnl = Number(((await goldskyResult.json()) as any[])[0]?.pnl || 0);

  return {
    positions,
    trades,
    trades_per_position: positions > 0 ? trades / positions : 0,
    goldsky_pnl,
  };
}

/**
 * PLACEHOLDER: Replace with your PnL calculation methodology
 *
 * This is where you implement your PnL calculation.
 * The goal is to make calculated_pnl match gt_pnl for all wallets.
 */
async function calculatePnl(wallet: string): Promise<number> {
  // TODO: Implement your PnL calculation here
  // Current implementation just returns Goldsky's realized_pnl
  const metrics = await getWalletMetrics(wallet);
  return metrics.goldsky_pnl;
}

async function runTests() {
  console.log("═".repeat(100));
  console.log("  PnL GROUND TRUTH VALIDATION TEST");
  console.log("═".repeat(100));
  console.log("");

  const results: TestResult[] = [];
  const tolerance = 0.1; // 10% tolerance for "match"

  for (const gt of GROUND_TRUTH) {
    const metrics = await getWalletMetrics(gt.wallet);
    const calculated = await calculatePnl(gt.wallet);

    const gt_ratio = gt.pnl !== 0 ? calculated / gt.pnl : 0;
    const goldsky_ratio = metrics.goldsky_pnl !== 0 ? calculated / metrics.goldsky_pnl : 0;

    results.push({
      wallet: gt.wallet,
      gt_pnl: gt.pnl,
      calculated_pnl: calculated,
      goldsky_pnl: metrics.goldsky_pnl,
      trades_per_position: metrics.trades_per_position,
      match_gt: Math.abs(gt_ratio - 1) < tolerance,
      match_goldsky: Math.abs(goldsky_ratio - 1) < tolerance,
      gt_ratio,
      goldsky_ratio,
    });
  }

  // Summary
  const matches = results.filter((r) => r.match_gt).length;
  const total = results.length;

  console.log("RESULTS:");
  console.log("-".repeat(100));
  console.log(
    "Wallet".padEnd(15) +
      "GT PnL".padStart(12) +
      "Calc PnL".padStart(15) +
      "GS PnL".padStart(15) +
      "T/P".padStart(8) +
      "GT Ratio".padStart(10) +
      "Match".padStart(8)
  );
  console.log("-".repeat(100));

  for (const r of results) {
    const shortWallet = r.wallet.substring(0, 10) + "...";
    const matchStr = r.match_gt ? "✓" : "✗";
    console.log(
      shortWallet.padEnd(15) +
        ("$" + r.gt_pnl.toLocaleString()).padStart(12) +
        ("$" + r.calculated_pnl.toLocaleString()).padStart(15) +
        ("$" + r.goldsky_pnl.toLocaleString()).padStart(15) +
        r.trades_per_position.toFixed(1).padStart(8) +
        (r.gt_ratio.toFixed(2) + "x").padStart(10) +
        matchStr.padStart(8)
    );
  }

  console.log("-".repeat(100));
  console.log("");
  console.log("SUMMARY:");
  console.log(`  Total wallets: ${total}`);
  console.log(`  Matches (within ${tolerance * 100}%): ${matches}`);
  console.log(`  Pass rate: ${((matches / total) * 100).toFixed(1)}%`);
  console.log("");

  // Group by trades_per_position
  const lowTpp = results.filter((r) => r.trades_per_position < 15);
  const highTpp = results.filter((r) => r.trades_per_position >= 15);

  console.log("BY TRADES PER POSITION:");
  console.log(`  Low (<15 T/P): ${lowTpp.filter((r) => r.match_gt).length}/${lowTpp.length} match`);
  console.log(`  High (≥15 T/P): ${highTpp.filter((r) => r.match_gt).length}/${highTpp.length} match`);

  await client.close();
  return matches === total;
}

runTests()
  .then((passed) => {
    process.exit(passed ? 0 : 1);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
