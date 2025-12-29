#!/usr/bin/env npx tsx
/**
 * SAMPLE TIER A VERIFIED WALLETS FOR PLAYWRIGHT SCRAPING
 * ============================================================================
 *
 * Takes tierA_verified_wallets_v1.json and samples:
 * - 50 top-volume verified wallets (already sorted by PnL, re-sort by volume proxy)
 * - 50 random verified wallets
 *
 * Output: tmp/tierA_verified_scrape_sample_100.json
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import * as fs from 'fs';

interface TierAVerifiedWallet {
  wallet_address: string;
  tier: string;
  sample_type: string;
  event_count: number;
  resolved_events: number;
  unresolved_events: number;
  unresolved_pct: number;
  realized_pnl_v12: number;
  profitable: boolean;
}

interface TierAVerifiedFile {
  metadata: any;
  summary: any;
  wallets: TierAVerifiedWallet[];
}

function main() {
  const inputFile = 'tmp/tierA_verified_wallets_v1.json';
  const outputFile = 'tmp/tierA_verified_scrape_sample_100.json';

  console.log('═'.repeat(80));
  console.log('SAMPLE TIER A VERIFIED FOR PLAYWRIGHT SCRAPING');
  console.log('═'.repeat(80));
  console.log('');

  // Load verified wallets
  if (!fs.existsSync(inputFile)) {
    console.error(`ERROR: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const data: TierAVerifiedFile = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  console.log(`Loaded ${data.wallets.length} Tier A Verified wallets`);
  console.log('');

  // Separate by sample_type from original benchmark
  const topWallets = data.wallets.filter(w => w.sample_type === 'top');
  const randomWallets = data.wallets.filter(w => w.sample_type === 'random');

  console.log(`  Top-volume sample: ${topWallets.length} wallets`);
  console.log(`  Random sample: ${randomWallets.length} wallets`);
  console.log('');

  // Sort top wallets by event_count (proxy for volume) descending
  topWallets.sort((a, b) => b.event_count - a.event_count);

  // Take top 50 from top-volume
  const top50 = topWallets.slice(0, 50);

  // Shuffle random wallets and take 50
  const shuffledRandom = randomWallets.sort(() => Math.random() - 0.5);
  const random50 = shuffledRandom.slice(0, 50);

  console.log(`Sampled:`);
  console.log(`  50 from top-volume (by event count)`);
  console.log(`  50 random`);
  console.log('');

  // Combine
  const sample = [
    ...top50.map(w => ({ ...w, scrape_sample_type: 'top' })),
    ...random50.map(w => ({ ...w, scrape_sample_type: 'random' })),
  ];

  // Build output with scraping metadata
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      source_file: inputFile,
      total_wallets: sample.length,
      top_count: 50,
      random_count: 50,
      description: 'Tier A Verified wallets sampled for Playwright tooltip scraping',
    },
    wallets: sample.map((w, idx) => ({
      index: idx + 1,
      wallet_address: w.wallet_address,
      profile_url: `https://polymarket.com/profile/${w.wallet_address}`,
      scrape_sample_type: w.scrape_sample_type,
      event_count: w.event_count,
      unresolved_pct: w.unresolved_pct,
      v12_realized_pnl: w.realized_pnl_v12,
    })),
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Saved to: ${outputFile}`);
  console.log('');

  // Show first 10 from each group
  console.log('Top 10 from top-volume sample:');
  console.log('─'.repeat(80));
  for (let i = 0; i < 10; i++) {
    const w = top50[i];
    const shortWallet = w.wallet_address.slice(0, 10) + '...' + w.wallet_address.slice(-4);
    console.log(
      `${String(i + 1).padStart(2)}. ${shortWallet} | ` +
      `Events: ${w.event_count.toLocaleString().padStart(7)} | ` +
      `PnL: $${w.realized_pnl_v12.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).padStart(12)} | ` +
      `Unres: ${w.unresolved_pct.toFixed(1)}%`
    );
  }
  console.log('');

  console.log('First 10 from random sample:');
  console.log('─'.repeat(80));
  for (let i = 0; i < 10; i++) {
    const w = random50[i];
    const shortWallet = w.wallet_address.slice(0, 10) + '...' + w.wallet_address.slice(-4);
    console.log(
      `${String(i + 1).padStart(2)}. ${shortWallet} | ` +
      `Events: ${w.event_count.toLocaleString().padStart(7)} | ` +
      `PnL: $${w.realized_pnl_v12.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).padStart(12)} | ` +
      `Unres: ${w.unresolved_pct.toFixed(1)}%`
    );
  }
  console.log('');

  console.log('✅ Sample ready for Playwright scraping');
  console.log('');
  console.log('Next: Run Playwright to scrape tooltip data for all 100 wallets');
}

main();
