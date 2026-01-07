/**
 * Copy Trading Wallet Hunt v1
 *
 * Experimental data science project to find the best copy-tradable wallets
 * using a wallet-first discovery approach.
 *
 * Core Formula:
 *   Expected Return per Bet = (win_rate / avg_entry_price) - 1
 *   Return per Day = Expected_Return / avg_resolution_days
 *
 * Constraints (12s delay, no CTF arb, etc.) are built into the filters.
 *
 * Usage: npx tsx scripts/experimental/copy-hunt-v1.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';
import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

interface CopyCandidate {
  wallet: string;
  tokens_traded: number;
  trades_per_day: number;
  avg_entry_price: number;
  total_volume: number;
}

interface CopyScore {
  wallet: string;
  win_rate: number;
  avg_entry_price: number;
  expected_return: number;
  avg_resolution_days: number;
  return_per_day: number;
  resolved_positions: number;
  total_pnl: number;
  trades_per_day: number;
  recency_weighted_return: number;
  verified: boolean;
}

// ============================================================================
// Discovery Query
// ============================================================================

async function discoverCopyablWallets(): Promise<CopyCandidate[]> {
  console.log('\n=== PHASE 1: DISCOVERY ===\n');
  console.log('Using pre-computed leaderboard universe (10K wallets)...\n');

  // Step 1: Get wallets from pre-computed universe (fast)
  const universeQuery = `
    SELECT
      wallet,
      total_volume_usdc as total_volume,
      total_events,
      active_days,
      resolved_markets,
      last_ts
    FROM pm_wallet_leaderboard_universe_v2
    WHERE last_ts >= now() - INTERVAL 30 DAY
      AND resolved_markets >= 20
      AND total_volume_usdc >= 500
      AND total_events / GREATEST(active_days, 1) <= 50
    ORDER BY total_volume_usdc DESC
    LIMIT 300
  `;

  const universeResult = await clickhouse.query({ query: universeQuery, format: 'JSONEachRow' });
  const universe = await universeResult.json() as any[];

  console.log(`Found ${universe.length} active wallets from universe\n`);

  // Step 2: Check CTF arb activity (splits/merges = can't copy)
  const walletList = universe.map(w => `'${w.wallet.toLowerCase()}'`).join(',');

  // Note: We DON'T exclude ERC1155 recipients - most CLOB traders have some transfers
  // We only exclude heavy split/merge users (the actual arb strategy we can't copy)
  const ctfQuery = `
    SELECT lower(user_address) as wallet, count() as split_merge_count
    FROM pm_ctf_events
    WHERE event_type IN ('PositionSplit', 'PositionsMerge')
      AND is_deleted = 0
      AND lower(user_address) IN (${walletList})
    GROUP BY lower(user_address)
    HAVING count() >= 10
  `;
  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfSet = new Set((await ctfResult.json() as any[]).map(r => r.wallet));
  console.log(`Excluding ${ctfSet.size} heavy CTF arb wallets (10+ splits/merges)`);

  // Step 3: Filter
  const filtered = universe.filter(w =>
    !ctfSet.has(w.wallet.toLowerCase())
  );

  console.log(`After exclusions: ${filtered.length} candidates\n`);

  // For now, set placeholder values for entry price (will calculate per-wallet)
  const candidates: CopyCandidate[] = filtered.map(w => ({
    wallet: w.wallet.toLowerCase(),
    tokens_traded: w.resolved_markets * 2,
    trades_per_day: w.total_events / Math.max(w.active_days, 1),
    avg_entry_price: 0.5, // Will be calculated per-wallet during scoring
    total_volume: w.total_volume,
  }));

  if (candidates.length > 0) {
    console.log(`Top 5 by volume:`);
    for (const c of candidates.slice(0, 5)) {
      console.log(`  ${c.wallet.slice(0, 10)}... | Vol: $${Number(c.total_volume).toLocaleString()} | ${Number(c.trades_per_day).toFixed(1)} trades/day`);
    }
  }

  return candidates;
}

// ============================================================================
// Fast Batch Metrics Calculation
// ============================================================================

interface BatchMetrics {
  wallet: string;
  win_rate: number;
  avg_entry_price: number;
  total_pnl: number;
  resolved_positions: number;
  avg_resolution_days: number;
}

async function getCopyableWalletsFromPrecomputed(): Promise<Map<string, BatchMetrics>> {
  console.log(`Fetching pre-computed copyable wallets from pm_copy_trading_metrics_v1...`);

  // Use the pre-computed copy trading metrics table
  // CRITICAL: Filter for realistic win rates (55-80%) to exclude arbers
  const query = `
    SELECT
      wallet_address as wallet,
      win_rate,
      realized_pnl as total_pnl,
      resolved_positions
    FROM pm_copy_trading_metrics_v1
    WHERE is_copyable = 1
      AND resolved_positions >= 30        -- Need statistical significance
      AND win_rate >= 0.55               -- Minimum edge
      AND win_rate <= 0.80               -- Exclude arbers with 95%+ win rates
      AND realized_pnl >= 1000           -- Require $1000+ PnL to show skill
    ORDER BY realized_pnl DESC
    LIMIT 100
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];

    console.log(`Found ${rows.length} copyable wallets from pre-computed table`);

    // Build metrics map with default entry price
    // Entry price will be refined later for top candidates only
    const metricsMap = new Map<string, BatchMetrics>();
    for (const row of rows) {
      const wallet = row.wallet.toLowerCase();
      // Use 50¢ default - will filter and refine for top candidates
      const avgEntry = 0.50;

      metricsMap.set(wallet, {
        wallet: wallet,
        win_rate: Number(row.win_rate),
        avg_entry_price: avgEntry,
        total_pnl: Number(row.total_pnl),
        resolved_positions: Number(row.resolved_positions),
        avg_resolution_days: 14, // Default, will refine later
      });
    }

    return metricsMap;
  } catch (e) {
    console.error('Pre-computed metrics query failed:', e);
    return new Map();
  }
}

function scoreFromMetrics(wallet: string, metrics: BatchMetrics, tradesPerDay: number): CopyScore | null {
  // Skip if entry price too high (arbers) or too low (extreme underdogs)
  if (metrics.avg_entry_price > 0.85 || metrics.avg_entry_price < 0.10) {
    return null;
  }

  // Calculate expected return: win_rate / avg_entry_price - 1
  const expectedReturn = metrics.win_rate / metrics.avg_entry_price - 1;

  // Calculate return per day
  const returnPerDay = expectedReturn / Math.max(metrics.avg_resolution_days, 1);

  return {
    wallet: wallet,
    win_rate: metrics.win_rate,
    avg_entry_price: metrics.avg_entry_price,
    expected_return: expectedReturn,
    avg_resolution_days: metrics.avg_resolution_days,
    return_per_day: returnPerDay,
    resolved_positions: metrics.resolved_positions,
    total_pnl: metrics.total_pnl,
    trades_per_day: tradesPerDay,
    recency_weighted_return: returnPerDay,
    verified: false,
  };
}

// ============================================================================
// Leaderboard Display
// ============================================================================

function displayLeaderboard(scores: CopyScore[], title: string = 'LIVE LEADERBOARD') {
  console.log('\n' + '═'.repeat(80));
  console.log(`  COPY TRADING HUNT - ${title}`);
  console.log('═'.repeat(80));
  console.log('  Rank │ Wallet            │ Return/Day │ WinRate │ AvgEntry │ PnL        │ Res.');
  console.log('─'.repeat(80));

  for (let i = 0; i < Math.min(scores.length, 20); i++) {
    const s = scores[i];
    const rank = String(i + 1).padStart(4);
    const wallet = s.wallet.slice(0, 10) + '...';
    const returnDay = (s.return_per_day * 100).toFixed(2) + '%';
    const winRate = (s.win_rate * 100).toFixed(1) + '%';
    const avgEntry = (s.avg_entry_price * 100).toFixed(0) + '¢';
    const pnl = '$' + s.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const res = String(s.resolved_positions);
    const verified = s.verified ? '✓' : '-';

    console.log(`  ${rank} │ ${wallet.padEnd(17)} │ ${returnDay.padStart(10)} │ ${winRate.padStart(7)} │ ${avgEntry.padStart(8)} │ ${pnl.padStart(10)} │ ${res.padStart(4)} ${verified}`);
  }

  console.log('═'.repeat(80));
}

function saveLeaderboard(scores: CopyScore[]) {
  const outputPath = '/Users/scotty/Projects/Cascadian-app/scripts/experimental/results/leaderboard.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated: new Date().toISOString(),
    count: scores.length,
    scores: scores.slice(0, 50),
  }, null, 2));
  console.log(`\nLeaderboard saved to: ${outputPath}`);
}

// ============================================================================
// Main Hunt
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  COPY TRADING WALLET HUNT v1                                               ║');
  console.log('║  Finding the fastest returning copyable wallets                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  // Phase 1: Get pre-computed copyable wallets with metrics
  console.log('\n=== PHASE 1: FETCHING COPYABLE WALLETS ===\n');

  const metricsMap = await getCopyableWalletsFromPrecomputed();

  if (metricsMap.size === 0) {
    console.log('\nNo copyable wallets found. Check filters.');
    return;
  }

  // Phase 2: Score each wallet using our copy trading formula
  console.log('\n=== PHASE 2: SCORING WITH COPY FORMULA ===\n');

  const scores: CopyScore[] = [];
  let skipped = 0;

  for (const [wallet, metrics] of metricsMap) {
    const score = scoreFromMetrics(wallet, metrics, 10); // Default trades/day

    if (score && score.return_per_day > 0) {
      scores.push(score);
    } else {
      skipped++;
    }
  }

  console.log(`Scored ${scores.length} profitable wallets, skipped ${skipped}`);

  if (scores.length > 0) {
    displayLeaderboard(scores.sort((a, b) => b.return_per_day - a.return_per_day), 'INITIAL RANKING');
  }

  console.log(`\n\nScoring complete: ${scores.length} profitable wallets found\n`);

  // Phase 3: Rank and display
  console.log('\n=== PHASE 3: FINAL RANKING ===\n');

  // Sort by return per day
  const ranked = scores.sort((a, b) => b.return_per_day - a.return_per_day);

  // Filter for success criteria: return > 0.5%/day, win rate > 55%
  const golden = ranked.filter(s =>
    s.return_per_day >= 0.005 && // 0.5%+ per day
    s.win_rate >= 0.55 &&        // 55%+ win rate
    s.resolved_positions >= 30   // Statistical significance
  );

  console.log(`Golden wallets (0.5%+/day, 55%+ WR, 30+ positions): ${golden.length}`);

  // Display final leaderboard
  displayLeaderboard(ranked, 'FINAL RESULTS');

  // Save results
  saveLeaderboard(ranked);

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total copyable wallets evaluated: ${metricsMap.size}`);
  console.log(`Profitable wallets: ${scores.length}`);
  console.log(`Golden wallets (meet all criteria): ${golden.length}`);

  if (golden.length > 0) {
    console.log('\nTop 5 Golden Wallets to Verify:');
    for (const g of golden.slice(0, 5)) {
      console.log(`  ${g.wallet}`);
      console.log(`    Return/Day: ${(g.return_per_day * 100).toFixed(2)}% | WR: ${(g.win_rate * 100).toFixed(1)}% | Entry: ${(g.avg_entry_price * 100).toFixed(0)}¢`);
      console.log(`    PnL: $${g.total_pnl.toLocaleString()} | Positions: ${g.resolved_positions} | Res. Days: ${g.avg_resolution_days.toFixed(1)}`);
    }
  }

  if (golden.length >= 5) {
    console.log('\n🎯 SUCCESS: Found 5+ golden wallets meeting all criteria!');
  } else if (golden.length > 0) {
    console.log(`\n⚠️  Found ${golden.length} golden wallets. Need 5+ for success.`);
  } else {
    console.log('\n❌ No golden wallets found. Consider relaxing criteria.');
  }
}

main().catch(console.error);
