#!/usr/bin/env npx tsx
/**
 * Build Copy-Trade Leaderboard V1
 *
 * Generates a production-ready leaderboard from the Copy-Trade Ready V1 cohort.
 *
 * OUTPUTS:
 *   - tmp/copy_trade_leaderboard_v1.json
 *   - Console summary with top performers
 *
 * USAGE:
 *   npx tsx scripts/pnl/build-copy-trade-leaderboard-v1.ts [--limit=50] [--min-pnl=200]
 *
 * OPTIONS:
 *   --limit=N       Maximum wallets in leaderboard (default: 100)
 *   --min-pnl=N     Minimum absolute realized PnL (default: 200)
 *   --include-unrealized   Include unrealized PnL calculation (slower)
 */

import * as fs from "fs";
import * as path from "path";
import {
  getCopyTradeReadyV1Wallets,
  CopyTradeReadyWallet,
} from "../../lib/pnl/cohorts/copyTradeReadyV1";
import {
  computeWalletPnL,
  ComposerResult,
} from "../../lib/pnl/pnlComposerV1";

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name: string, defaultVal: string): string => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultVal;
};
const hasFlag = (name: string): boolean =>
  args.includes(`--${name}`);

const LIMIT = parseInt(getArg("limit", "100"), 10);
const MIN_PNL = parseFloat(getArg("min-pnl", "200"));
const INCLUDE_UNREALIZED = hasFlag("include-unrealized");

interface LeaderboardEntry {
  rank: number;
  wallet_address: string;
  realized_pnl: number;
  unrealized_pnl: number | null;
  total_pnl: number;
  trade_count: number;
  market_count: number;
  win_rate_proxy: number | null;
  avg_trade_size: number;
  first_trade: string;
  last_trade: string;
  days_active: number;
  diagnostics: {
    calculation_method: string;
    confidence: string;
    warnings: string[];
    omega_ready: boolean;
    omega_inputs_missing: string[];
  };
  captured_at: string;
}

interface LeaderboardOutput {
  metadata: {
    version: "v1";
    generated_at: string;
    cohort: "copy_trade_ready_v1";
    cohort_criteria: {
      source_type: "CLOB only";
      positions: "all closed";
      min_realized_magnitude: number;
      min_trade_count: number;
    };
    total_wallets: number;
    include_unrealized: boolean;
  };
  leaderboard: LeaderboardEntry[];
  summary: {
    total_realized_pnl: number;
    avg_realized_pnl: number;
    median_realized_pnl: number;
    profitable_count: number;
    losing_count: number;
    avg_trade_count: number;
    avg_win_rate: number | null;
  };
}

async function buildLeaderboard(): Promise<void> {
  console.log("=".repeat(60));
  console.log("COPY-TRADE LEADERBOARD V1 BUILDER");
  console.log("=".repeat(60));
  console.log(`\nParameters:`);
  console.log(`  Limit: ${LIMIT}`);
  console.log(`  Min PnL: $${MIN_PNL}`);
  console.log(`  Include Unrealized: ${INCLUDE_UNREALIZED}`);
  console.log("");

  // Step 1: Get cohort wallets
  console.log("Step 1: Fetching Copy-Trade Ready V1 cohort...");
  const cohortWallets = await getCopyTradeReadyV1Wallets(LIMIT * 2); // Fetch extra to filter

  if (cohortWallets.length === 0) {
    console.error("ERROR: No wallets found in cohort. Check cohort criteria.");
    process.exit(1);
  }

  console.log(`  Found ${cohortWallets.length} wallets in cohort`);

  // Step 2: Compute PnL for each wallet
  console.log("\nStep 2: Computing PnL for cohort wallets...");
  const entries: LeaderboardEntry[] = [];
  let processed = 0;
  let errors = 0;

  for (const wallet of cohortWallets) {
    if (entries.length >= LIMIT) break;

    processed++;
    if (processed % 10 === 0) {
      console.log(`  Processing ${processed}/${cohortWallets.length}...`);
    }

    try {
      const pnlResult: ComposerResult = await computeWalletPnL(
        wallet.wallet_address,
        {}
      );

      // Skip if below minimum PnL threshold
      if (Math.abs(pnlResult.realized_pnl) < MIN_PNL) {
        continue;
      }

      // Calculate win rate proxy from cohort data if available
      // Clamp to [0, 1] to handle data inconsistencies
      let winRateProxy: number | null = null;
      if (wallet.profitable_markets !== undefined && wallet.market_count > 0) {
        const rawRate = wallet.profitable_markets / wallet.market_count;
        winRateProxy = Math.min(1, Math.max(0, rawRate));
      }

      const entry: LeaderboardEntry = {
        rank: 0, // Will be assigned after sorting
        wallet_address: wallet.wallet_address,
        realized_pnl: pnlResult.realized_pnl,
        unrealized_pnl: INCLUDE_UNREALIZED ? pnlResult.unrealized_pnl : null,
        total_pnl: pnlResult.total_pnl,
        trade_count: wallet.trade_count,
        market_count: wallet.market_count,
        win_rate_proxy: winRateProxy,
        avg_trade_size: wallet.total_volume / wallet.trade_count,
        first_trade: wallet.first_trade,
        last_trade: wallet.last_trade,
        days_active: Math.ceil(
          (new Date(wallet.last_trade).getTime() -
            new Date(wallet.first_trade).getTime()) /
            (1000 * 60 * 60 * 24)
        ),
        diagnostics: {
          calculation_method: `cohort_${pnlResult.diagnostics.cohort.toLowerCase()}`,
          confidence: pnlResult.diagnostics.activePositions === 0 ? 'HIGH' : 'MEDIUM',
          warnings: pnlResult.diagnostics.warnings,
          omega_ready: pnlResult.diagnostics.omegaReady,
          omega_inputs_missing: pnlResult.diagnostics.omegaInputsMissing,
        },
        captured_at: new Date().toISOString(),
      };

      entries.push(entry);
    } catch (err) {
      errors++;
      console.warn(
        `  Warning: Failed to compute PnL for ${wallet.wallet_address}: ${err}`
      );
    }
  }

  if (entries.length === 0) {
    console.error("ERROR: No valid entries after PnL computation.");
    process.exit(1);
  }

  // Step 3: Sort by realized PnL (descending)
  console.log("\nStep 3: Sorting by realized PnL...");
  entries.sort((a, b) => b.realized_pnl - a.realized_pnl);

  // Assign ranks
  entries.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });

  // Step 4: Calculate summary statistics
  console.log("\nStep 4: Calculating summary statistics...");
  const pnlValues = entries.map((e) => e.realized_pnl);
  const sortedPnL = [...pnlValues].sort((a, b) => a - b);
  const medianPnL =
    sortedPnL.length % 2 === 0
      ? (sortedPnL[sortedPnL.length / 2 - 1] +
          sortedPnL[sortedPnL.length / 2]) /
        2
      : sortedPnL[Math.floor(sortedPnL.length / 2)];

  const winRates = entries
    .map((e) => e.win_rate_proxy)
    .filter((w): w is number => w !== null);
  const avgWinRate =
    winRates.length > 0
      ? winRates.reduce((a, b) => a + b, 0) / winRates.length
      : null;

  const output: LeaderboardOutput = {
    metadata: {
      version: "v1",
      generated_at: new Date().toISOString(),
      cohort: "copy_trade_ready_v1",
      cohort_criteria: {
        source_type: "CLOB only",
        positions: "all closed",
        min_realized_magnitude: MIN_PNL,
        min_trade_count: 10,
      },
      total_wallets: entries.length,
      include_unrealized: INCLUDE_UNREALIZED,
    },
    leaderboard: entries,
    summary: {
      total_realized_pnl: pnlValues.reduce((a, b) => a + b, 0),
      avg_realized_pnl: pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length,
      median_realized_pnl: medianPnL,
      profitable_count: entries.filter((e) => e.realized_pnl > 0).length,
      losing_count: entries.filter((e) => e.realized_pnl < 0).length,
      avg_trade_count:
        entries.reduce((a, e) => a + e.trade_count, 0) / entries.length,
      avg_win_rate: avgWinRate,
    },
  };

  // Step 5: Write output
  console.log("\nStep 5: Writing output files...");
  const tmpDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const outputPath = path.join(tmpDir, "copy_trade_leaderboard_v1.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`  Written: ${outputPath}`);

  // Step 6: Print summary
  console.log("\n" + "=".repeat(60));
  console.log("LEADERBOARD SUMMARY");
  console.log("=".repeat(60));
  console.log(`\nTotal Wallets: ${output.metadata.total_wallets}`);
  console.log(`Profitable: ${output.summary.profitable_count}`);
  console.log(`Losing: ${output.summary.losing_count}`);
  console.log(
    `\nTotal Realized PnL: $${output.summary.total_realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );
  console.log(
    `Avg Realized PnL: $${output.summary.avg_realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );
  console.log(
    `Median Realized PnL: $${output.summary.median_realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );
  console.log(
    `Avg Trade Count: ${output.summary.avg_trade_count.toFixed(1)}`
  );
  if (output.summary.avg_win_rate !== null) {
    console.log(
      `Avg Win Rate: ${(output.summary.avg_win_rate * 100).toFixed(1)}%`
    );
  }

  console.log("\n" + "-".repeat(60));
  console.log("TOP 10 PERFORMERS");
  console.log("-".repeat(60));
  console.log(
    `${"Rank".padEnd(6)}${"Wallet".padEnd(14)}${"Realized PnL".padStart(15)}${"Trades".padStart(10)}${"Win Rate".padStart(12)}`
  );
  console.log("-".repeat(60));

  for (const entry of entries.slice(0, 10)) {
    const walletShort = `${entry.wallet_address.slice(0, 6)}...${entry.wallet_address.slice(-4)}`;
    const winRateStr =
      entry.win_rate_proxy !== null
        ? `${(entry.win_rate_proxy * 100).toFixed(1)}%`
        : "N/A";
    console.log(
      `${entry.rank.toString().padEnd(6)}${walletShort.padEnd(14)}${("$" + entry.realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).padStart(15)}${entry.trade_count.toString().padStart(10)}${winRateStr.padStart(12)}`
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("DIAGNOSTICS");
  console.log("=".repeat(60));
  console.log(`\nProcessed: ${processed} wallets`);
  console.log(`Errors: ${errors}`);
  console.log(`Final entries: ${entries.length}`);

  const warningCounts: Record<string, number> = {};
  for (const entry of entries) {
    for (const warning of entry.diagnostics.warnings) {
      warningCounts[warning] = (warningCounts[warning] || 0) + 1;
    }
  }

  if (Object.keys(warningCounts).length > 0) {
    console.log("\nWarning Distribution:");
    for (const [warning, count] of Object.entries(warningCounts).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${warning}: ${count}`);
    }
  }

  // Omega readiness summary
  const omegaReady = entries.filter((e) => e.diagnostics.omega_ready).length;
  console.log(
    `\nOmega Ratio Readiness: ${omegaReady}/${entries.length} wallets`
  );
  if (omegaReady === 0) {
    console.log("  Missing inputs for all wallets:");
    console.log("    - per_trade_returns");
    console.log("    - benchmark_returns");
    console.log("    - threshold_parameter");
    console.log("  → Omega ratio will be implemented in v1.1");
  }

  console.log("\n✅ Leaderboard build complete!");
}

// Run
buildLeaderboard().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
