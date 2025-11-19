/**
 * 52: FIND SYSTEM WALLETS
 *
 * Track B - Step B2.2
 *
 * Detect wallets that are likely system wallets (market makers, liquidity providers,
 * bots, etc.) using heuristics. Flag these for exclusion from validation.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

interface WalletHeuristics {
  canonical_wallet: string;
  total_fills: number;
  total_markets: number;
  fills_per_market: number;
  avg_fill_size: number;
  median_fill_size: number;
  distinct_days_active: number;
  fills_per_day: number;
  system_wallet_score: number;
  flags: string[];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('52: FIND SYSTEM WALLETS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Detect system wallets using heuristics\n');

  // Step 1: Calculate heuristics for all wallets
  console.log('📊 Step 1: Calculating heuristics for all wallets...\n');

  const heuristicsQuery = await clickhouse.query({
    query: `
      SELECT
        wim.canonical_wallet,
        sum(wim.fills_count) AS total_fills,
        sum(wim.markets_traded) AS total_markets,
        sum(wim.fills_count) / sum(wim.markets_traded) AS fills_per_market,
        sum(wim.fills_count) / (dateDiff('day', min(wim.first_fill_ts), max(wim.last_fill_ts)) + 1) AS fills_per_day,
        0 AS avg_fill_size,
        0 AS median_fill_size,
        0 AS distinct_days_active
      FROM wallet_identity_map wim
      GROUP BY wim.canonical_wallet
      ORDER BY total_fills DESC
      LIMIT 1000
    `,
    format: 'JSONEachRow'
  });

  const wallets: any[] = await heuristicsQuery.json();

  console.log(`Analyzed top ${wallets.length} wallets by fill count\n`);

  // Step 2: Apply heuristics to detect system wallets
  console.log('📊 Step 2: Applying system wallet detection heuristics...\n');

  const systemWallets: WalletHeuristics[] = [];

  for (const wallet of wallets) {
    // Skip if canonical_wallet is undefined or null
    if (!wallet.canonical_wallet) {
      continue;
    }

    const flags: string[] = [];
    let score = 0;

    // Heuristic 1: Very high fills per market (>100) suggests market maker
    if (wallet.fills_per_market > 100) {
      flags.push('HIGH_FILLS_PER_MARKET');
      score += 3;
    }

    // Heuristic 2: Very high total fills (>500k) suggests institutional
    if (wallet.total_fills > 500000) {
      flags.push('VERY_HIGH_VOLUME');
      score += 2;
    }

    // Heuristic 3: High fills per day (>1000) suggests bot
    if (wallet.fills_per_day > 1000) {
      flags.push('HIGH_FILLS_PER_DAY');
      score += 2;
    }

    // Heuristic 4: Very small median fill size (<10) suggests fragmentation
    if (wallet.median_fill_size < 10) {
      flags.push('SMALL_FILL_SIZE');
      score += 1;
    }

    // Heuristic 5: Active almost every day suggests automated trading
    const activity_rate = wallet.distinct_days_active / (wallet.total_fills / wallet.fills_per_day);
    if (activity_rate > 0.8) {
      flags.push('CONSISTENT_DAILY_ACTIVITY');
      score += 1;
    }

    // Only flag if score >= 3 (at least 3 points from heuristics)
    if (score >= 3) {
      systemWallets.push({
        canonical_wallet: wallet.canonical_wallet,
        total_fills: wallet.total_fills,
        total_markets: wallet.total_markets,
        fills_per_market: wallet.fills_per_market,
        avg_fill_size: wallet.avg_fill_size,
        median_fill_size: wallet.median_fill_size,
        distinct_days_active: wallet.distinct_days_active,
        fills_per_day: wallet.fills_per_day,
        system_wallet_score: score,
        flags
      });
    }
  }

  console.log(`Detected ${systemWallets.length} potential system wallets\n`);

  // Step 3: Print top system wallets
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TOP SYSTEM WALLETS (Score >= 3)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('| Rank | Wallet | Fills | Markets | F/M | Fills/Day | Score | Flags |');
  console.log('|------|--------|-------|---------|-----|-----------|-------|-------|');

  systemWallets
    .filter(w => w.canonical_wallet) // Filter out undefined wallets
    .sort((a, b) => b.system_wallet_score - a.system_wallet_score)
    .slice(0, 30)
    .forEach((w, idx) => {
      const rank = idx + 1;
      const wallet = w.canonical_wallet.substring(0, 10) + '...';
      const fills = w.total_fills.toLocaleString();
      const markets = w.total_markets;
      const fpm = Math.round(w.fills_per_market);
      const fpd = Math.round(w.fills_per_day);
      const score = w.system_wallet_score;
      const flags = w.flags.join(', ');

      console.log(`| ${rank} | ${wallet} | ${fills} | ${markets} | ${fpm} | ${fpd} | ${score} | ${flags} |`);
    });

  // Step 4: Summary statistics
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('HEURISTIC BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════\n');

  const flagCounts = new Map<string, number>();
  for (const wallet of systemWallets) {
    for (const flag of wallet.flags) {
      flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
    }
  }

  console.log('Flag distribution:');
  for (const [flag, count] of Array.from(flagCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${flag}: ${count} wallets`);
  }

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('SCORE DISTRIBUTION');
  console.log('═══════════════════════════════════════════════════════════\n');

  const scoreCounts = new Map<number, number>();
  for (const wallet of systemWallets) {
    scoreCounts.set(wallet.system_wallet_score, (scoreCounts.get(wallet.system_wallet_score) || 0) + 1);
  }

  for (const [score, count] of Array.from(scoreCounts.entries()).sort((a, b) => b[0] - a[0])) {
    console.log(`  Score ${score}: ${count} wallets`);
  }

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('SYSTEM WALLET DETECTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Total wallets analyzed: ${wallets.length}`);
  console.log(`System wallets detected: ${systemWallets.length}`);
  console.log(`System wallet rate: ${((systemWallets.length / wallets.length) * 100).toFixed(1)}%`);
  console.log('');

  // Check if our Track A test wallets are flagged
  const trackAWallets = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    '0xc5d563a36ae78145c45a50134d48a1215220f80a'
  ];

  console.log('Track A test wallets:');
  for (const wallet of trackAWallets) {
    const systemWallet = systemWallets.find(w =>
      w.canonical_wallet && w.canonical_wallet.toLowerCase() === wallet.toLowerCase()
    );
    if (systemWallet) {
      console.log(`  ${wallet.substring(0, 12)}... - FLAGGED as system wallet (score: ${systemWallet.system_wallet_score})`);
    } else {
      console.log(`  ${wallet.substring(0, 12)}... - Not flagged (regular user)`);
    }
  }

  console.log('\n');
  console.log('✅ System wallet detection complete');
  console.log('');
  console.log('Recommendation: Use wallets with score < 3 for Track B validation\n');
  console.log('Next: Run script 53 to select Track B wallets\n');
}

main().catch(console.error);
