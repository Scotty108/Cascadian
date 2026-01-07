/**
 * Find Top Scoring Wallets from Database
 *
 * This script queries the database to find ALL eligible wallets,
 * then scores them using Score = μ × M to find the true top performers.
 *
 * Step 1: Query for wallets with >15 resolved trades
 * Step 2: Score each wallet using CCR-v1
 * Step 3: Rank and display top performers
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';
import { ccrToWalletScore, passesFilters, WalletScore } from '../../lib/leaderboard/scoring';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function findEligibleWallets(): Promise<string[]> {
  console.log('═'.repeat(100));
  console.log('STEP 1: Finding eligible wallets from database');
  console.log('Criteria: >15 resolved markets (from pm_wallet_leaderboard_universe_v2)');
  console.log('═'.repeat(100));

  // Use pre-computed wallet stats table for speed
  // This has 10,275 wallets with resolved_markets already calculated
  const query = `
    SELECT
      wallet,
      resolved_markets,
      realized_pnl,
      total_events
    FROM pm_wallet_leaderboard_universe_v2
    WHERE resolved_markets >= 15
    ORDER BY realized_pnl DESC
    LIMIT 500
  `;

  console.log('\nQuerying for wallets with >=15 resolved markets...');
  const start = Date.now();

  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 60,
      }
    });
    const rows = await result.json() as { wallet: string; resolved_markets: number; realized_pnl: number; total_events: number }[];

    console.log(`Found ${rows.length} wallets with >=15 resolved markets (${Date.now() - start}ms)`);
    console.log(`\nTop 10 by realized PnL (pre-filter):`);
    rows.slice(0, 10).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.wallet.slice(0, 10)}... - $${Math.round(r.realized_pnl).toLocaleString()} (${r.resolved_markets} markets)`);
    });

    return rows.map(r => r.wallet);
  } catch (e: any) {
    console.error(`Query failed: ${e.message}`);
    throw e;
  }
}

async function scoreWallets(wallets: string[], maxToScore: number = 50): Promise<WalletScore[]> {
  console.log('\n' + '═'.repeat(100));
  console.log(`STEP 2: Scoring top ${maxToScore} wallets using CCR-v1 + Score = μ × M`);
  console.log('═'.repeat(100));

  const walletsToScore = wallets.slice(0, maxToScore);
  const results: WalletScore[] = [];
  const errors: { wallet: string; error: string }[] = [];

  for (let i = 0; i < walletsToScore.length; i++) {
    const wallet = walletsToScore[i];
    const progress = `[${i + 1}/${walletsToScore.length}]`;
    process.stdout.write(`${progress} ${wallet.slice(0, 10)}... `);

    try {
      const metrics = await computeCCRv1(wallet);
      const score = ccrToWalletScore(metrics);
      results.push(score);

      const passes = passesFilters(score);
      const status = passes ? '✅' : '⚠️';
      console.log(`${status} Score: ${score.score.toFixed(4)} | μ: ${(score.mu * 100).toFixed(1)}% | M: ${(score.M * 100).toFixed(1)}% | Trades: ${score.num_trades}`);
    } catch (e: any) {
      errors.push({ wallet, error: e.message });
      console.log(`❌ Error: ${e.message?.slice(0, 40)}`);
    }
  }

  console.log(`\nScored ${results.length} wallets, ${errors.length} errors`);
  return results;
}

async function main() {
  console.log('\n🎯 COPY TRADING LEADERBOARD - Database-Driven Discovery');
  console.log('Finding the TRUE top performers by Score = μ × M\n');

  try {
    // Step 1: Find eligible wallets
    const eligibleWallets = await findEligibleWallets();

    if (eligibleWallets.length === 0) {
      console.log('No eligible wallets found!');
      return;
    }

    // Step 2: Score wallets (limit to top 50 by trade count for speed)
    const scores = await scoreWallets(eligibleWallets, 50);

    // Step 3: Filter and rank
    console.log('\n' + '═'.repeat(100));
    console.log('STEP 3: Final Ranking (Eligible wallets only)');
    console.log('Filters: >15 trades, >10 markets, μ > 0');
    console.log('═'.repeat(100));

    const eligible = scores
      .filter(s => passesFilters(s))
      .sort((a, b) => b.score - a.score);

    console.log(`\nEligible wallets: ${eligible.length}/${scores.length}\n`);

    console.log('Rank │ Wallet                                      │ Score    │ μ (avg)  │ M (move) │ Trades │ Win%  │ PnL');
    console.log('─'.repeat(120));

    eligible.slice(0, 20).forEach((r, i) => {
      console.log(
        `${(i + 1).toString().padStart(3)}  │ ${r.wallet.padEnd(42)} │ ${r.score.toFixed(4).padStart(8)} │ ${(r.mu * 100).toFixed(1).padStart(6)}% │ ${(r.M * 100).toFixed(1).padStart(6)}% │ ${r.num_trades.toString().padStart(6)} │ ${(r.win_rate * 100).toFixed(0).padStart(4)}% │ $${r.realized_pnl.toLocaleString()}`
      );
    });

    // Summary
    console.log('\n' + '─'.repeat(120));
    console.log(`Total wallets queried: ${eligibleWallets.length}`);
    console.log(`Wallets scored: ${scores.length}`);
    console.log(`Eligible (passes filters): ${eligible.length}`);
    console.log(`Top Score: ${eligible[0]?.wallet.slice(0, 10)}... (${eligible[0]?.score.toFixed(4)})`);

    // Top 5 for copy trading
    console.log('\n' + '═'.repeat(100));
    console.log('🏆 TOP 5 FOR COPY TRADING');
    console.log('═'.repeat(100));
    eligible.slice(0, 5).forEach((r, i) => {
      console.log(`${i + 1}. ${r.wallet}`);
      console.log(`   Score: ${r.score.toFixed(4)} | μ: ${(r.mu * 100).toFixed(1)}% | M: ${(r.M * 100).toFixed(1)}% | Win Rate: ${(r.win_rate * 100).toFixed(0)}% | PnL: $${r.realized_pnl.toLocaleString()}`);
    });

  } catch (e: any) {
    console.error(`\nFatal error: ${e.message}`);
    console.error(e.stack);
  } finally {
    await client.close();
  }
}

main();
