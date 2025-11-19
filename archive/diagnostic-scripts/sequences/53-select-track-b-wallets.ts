/**
 * 53: SELECT TRACK B WALLETS
 *
 * Track B - Step B3.1
 *
 * Select 2-3 random wallets that are regular users (not system wallets)
 * plus the specific wallet requested by user.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

// User-specified wallet to include
const USER_SPECIFIED_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Heuristics for system wallet detection (same as script 52)
function isSystemWallet(wallet: any): boolean {
  let score = 0;

  // Heuristic 1: Very high fills per market (>100)
  if (wallet.fills_per_market > 100) {
    score += 3;
  }

  // Heuristic 2: Very high total fills (>500k)
  if (wallet.total_fills > 500000) {
    score += 2;
  }

  // Heuristic 3: High fills per day (>1000)
  if (wallet.fills_per_day > 1000) {
    score += 2;
  }

  // Score >= 3 means system wallet
  return score >= 3;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('53: SELECT TRACK B WALLETS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Select 2-3 regular user wallets + user-specified wallet\n');

  // Step 1: Get candidate wallets (mid-volume traders, not too high, not too low)
  console.log('📊 Step 1: Finding candidate wallets...\n');

  const candidatesQuery = await clickhouse.query({
    query: `
      SELECT
        canonical_wallet,
        sum(fills_count) AS total_fills,
        sum(markets_traded) AS total_markets,
        sum(fills_count) / sum(markets_traded) AS fills_per_market,
        sum(fills_count) / (dateDiff('day', min(first_fill_ts), max(last_fill_ts)) + 1) AS fills_per_day,
        min(first_fill_ts) AS earliest_fill,
        max(last_fill_ts) AS latest_fill
      FROM wallet_identity_map
      GROUP BY canonical_wallet
      HAVING total_fills >= 100 AND total_fills <= 100000
      ORDER BY rand()
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const candidates: any[] = await candidatesQuery.json();

  console.log(`Found ${candidates.length} candidate wallets (100-100K fills)\n`);

  // Step 2: Filter out system wallets
  console.log('📊 Step 2: Filtering out system wallets...\n');

  const regularUsers = candidates.filter(w => !isSystemWallet(w));

  console.log(`Regular users: ${regularUsers.length} / ${candidates.length}\n`);

  // Step 3: Select 2-3 random regular users
  console.log('📊 Step 3: Selecting 2-3 random regular users...\n');

  const selectedWallets: any[] = [];

  // Select 3 random wallets
  for (let i = 0; i < 3 && i < regularUsers.length; i++) {
    const wallet = regularUsers[i];
    selectedWallets.push(wallet);
    console.log(`  ✓ Selected: ${wallet.canonical_wallet.substring(0, 12)}... (${wallet.total_fills} fills, ${wallet.total_markets} markets)`);
  }

  console.log('');

  // Step 4: Add user-specified wallet
  console.log('📊 Step 4: Adding user-specified wallet...\n');

  const userWalletQuery = await clickhouse.query({
    query: `
      SELECT
        canonical_wallet,
        sum(fills_count) AS total_fills,
        sum(markets_traded) AS total_markets,
        sum(fills_count) / sum(markets_traded) AS fills_per_market,
        sum(fills_count) / (dateDiff('day', min(first_fill_ts), max(last_fill_ts)) + 1) AS fills_per_day,
        min(first_fill_ts) AS earliest_fill,
        max(last_fill_ts) AS latest_fill
      FROM wallet_identity_map
      WHERE canonical_wallet = '${USER_SPECIFIED_WALLET}'
      GROUP BY canonical_wallet
    `,
    format: 'JSONEachRow'
  });

  const userWalletResults: any[] = await userWalletQuery.json();

  if (userWalletResults.length > 0) {
    const userWallet = userWalletResults[0];
    selectedWallets.push(userWallet);

    const isSystem = isSystemWallet(userWallet);
    console.log(`  ✓ Added: ${userWallet.canonical_wallet.substring(0, 12)}... (${userWallet.total_fills} fills, ${userWallet.total_markets} markets)`);
    console.log(`     ${isSystem ? '⚠️  System wallet' : '✅ Regular user'}\n`);
  } else {
    console.log(`  ⚠️  User-specified wallet not found in wallet_identity_map\n`);
  }

  // Step 5: Print final selection
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SELECTED WALLETS FOR TRACK B');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('| # | Wallet | Fills | Markets | F/M | F/Day | Type | Earliest Fill | Latest Fill |');
  console.log('|---|--------|-------|---------|-----|-------|------|---------------|-------------|');

  selectedWallets.forEach((w, idx) => {
    const num = idx + 1;
    const wallet = w.canonical_wallet.substring(0, 10) + '...';
    const fills = w.total_fills.toLocaleString();
    const markets = w.total_markets;
    const fpm = Math.round(w.fills_per_market);
    const fpd = Math.round(w.fills_per_day);
    const type = isSystemWallet(w) ? 'System' : 'User';
    const earliest = w.earliest_fill.substring(0, 10);
    const latest = w.latest_fill.substring(0, 10);

    console.log(`| ${num} | ${wallet} | ${fills} | ${markets} | ${fpm} | ${fpd} | ${type} | ${earliest} | ${latest} |`);
  });

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('SELECTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Total wallets selected: ${selectedWallets.length}`);
  console.log(`Regular users: ${selectedWallets.filter(w => !isSystemWallet(w)).length}`);
  console.log(`System wallets: ${selectedWallets.filter(w => isSystemWallet(w)).length}`);
  console.log('');

  console.log('Selected wallet addresses:');
  selectedWallets.forEach((w, idx) => {
    console.log(`  ${idx + 1}. ${w.canonical_wallet}`);
  });

  console.log('\n✅ Wallet selection complete\n');
  console.log('Next: Run script 54 to build Track B fixture\n');
}

main().catch(console.error);
