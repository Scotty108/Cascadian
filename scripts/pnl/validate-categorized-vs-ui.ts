#!/usr/bin/env npx tsx
/**
 * Validate Categorized Wallet Set Against Polymarket UI
 *
 * This script:
 * 1. Loads the categorized wallet dataset
 * 2. Computes V11 PnL for each wallet
 * 3. Outputs results for Playwright UI scraping
 * 4. Generates a comparison report by category
 */

import fs from 'fs';
import { createV11Engine } from '../../lib/pnl/uiActivityEngineV11';

interface CategorizedWallet {
  wallet_address: string;
  category: string;
  tags: string[];
  clob_trades: number;
  ctf_splits: number;
  ctf_merges: number;
  redemptions: number;
  transfers_in: number;
  transfers_out: number;
  dome_realized?: number;
}

interface ValidationResult {
  wallet: string;
  category: string;
  tags: string[];
  // V11 computed values
  v11_realized_pnl: number;
  v11_total_gain: number;
  v11_total_loss: number;
  v11_open_positions: number;
  v11_open_value: number;
  v11_synthetic_realized: number; // Resolved but unredeemed positions
  // UI scraped values (null until scraped)
  ui_pnl: number | null;
  // Comparison
  difference: number | null;
  difference_pct: number | null;
  matches: boolean;
  error?: string;
}

async function main() {
  const input = process.argv[2] || 'tmp/categorized_validation_set.json';
  const output = process.argv[3] || 'tmp/categorized_v11_results.json';
  const limit = parseInt(process.argv[4] || '0', 10); // 0 = all

  console.log('='.repeat(80));
  console.log('CATEGORIZED VALIDATION: V11 vs UI');
  console.log('='.repeat(80));
  console.log(`\nInput: ${input}`);
  console.log(`Output: ${output}`);
  if (limit > 0) console.log(`Limit: ${limit} wallets`);

  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  let wallets: CategorizedWallet[] = inputData.wallets;

  if (limit > 0) {
    wallets = wallets.slice(0, limit);
  }

  console.log(`\nProcessing ${wallets.length} wallets...\n`);

  const v11 = createV11Engine();
  const results: ValidationResult[] = [];

  // Process by category for better organization
  const byCategory = new Map<string, CategorizedWallet[]>();
  for (const w of wallets) {
    if (!byCategory.has(w.category)) {
      byCategory.set(w.category, []);
    }
    byCategory.get(w.category)!.push(w);
  }

  for (const [category, categoryWallets] of byCategory) {
    console.log(`\n--- Category: ${category.toUpperCase()} (${categoryWallets.length} wallets) ---\n`);

    for (let i = 0; i < categoryWallets.length; i++) {
      const w = categoryWallets[i];
      const wallet = w.wallet_address;

      console.log(`[${i + 1}/${categoryWallets.length}] ${wallet.slice(0, 12)}...`);

      try {
        const v11Result = await v11.compute(wallet);

        // Count open vs synthetic resolved positions
        let openPositions = 0;
        let openValue = 0;
        let syntheticRealized = 0;

        for (const pos of v11Result.positions) {
          if (pos.amount > 0.01) {
            // Position still has shares
            // Check if it's at 0¢ or 100¢ (synthetic resolved)
            if (pos.avgPrice <= 0.01 || pos.avgPrice >= 0.99) {
              // This is a "zombie" position - resolved but not redeemed
              syntheticRealized += pos.realized_pnl || 0;
            } else {
              // Truly open position
              openPositions++;
              openValue += pos.amount * pos.avgPrice;
            }
          }
        }

        results.push({
          wallet,
          category: w.category,
          tags: w.tags,
          v11_realized_pnl: v11Result.realized_pnl,
          v11_total_gain: v11Result.total_gain,
          v11_total_loss: v11Result.total_loss,
          v11_open_positions: openPositions,
          v11_open_value: openValue,
          v11_synthetic_realized: syntheticRealized,
          ui_pnl: null,
          difference: null,
          difference_pct: null,
          matches: false,
        });

        console.log(`  V11: $${v11Result.realized_pnl.toFixed(2)} (open: ${openPositions} pos @ $${openValue.toFixed(0)})`);

      } catch (err: any) {
        results.push({
          wallet,
          category: w.category,
          tags: w.tags,
          v11_realized_pnl: 0,
          v11_total_gain: 0,
          v11_total_loss: 0,
          v11_open_positions: 0,
          v11_open_value: 0,
          v11_synthetic_realized: 0,
          ui_pnl: null,
          difference: null,
          difference_pct: null,
          matches: false,
          error: err.message,
        });
        console.log(`  Error: ${err.message}`);
      }
    }
  }

  // Generate summary by category
  const summary: Record<string, {
    total: number;
    computed: number;
    errors: number;
    avg_realized: number;
    avg_open_positions: number;
  }> = {};

  for (const [category, categoryWallets] of byCategory) {
    const categoryResults = results.filter(r => r.category === category);
    const computed = categoryResults.filter(r => !r.error);

    summary[category] = {
      total: categoryWallets.length,
      computed: computed.length,
      errors: categoryResults.filter(r => r.error).length,
      avg_realized: computed.length > 0
        ? computed.reduce((sum, r) => sum + r.v11_realized_pnl, 0) / computed.length
        : 0,
      avg_open_positions: computed.length > 0
        ? computed.reduce((sum, r) => sum + r.v11_open_positions, 0) / computed.length
        : 0,
    };
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY BY CATEGORY');
  console.log('='.repeat(80));

  for (const [category, stats] of Object.entries(summary)) {
    console.log(`\n${category.toUpperCase()}:`);
    console.log(`  Wallets: ${stats.computed}/${stats.total} computed (${stats.errors} errors)`);
    console.log(`  Avg Realized PnL: $${stats.avg_realized.toFixed(2)}`);
    console.log(`  Avg Open Positions: ${stats.avg_open_positions.toFixed(1)}`);
  }

  // Save results
  const outputData = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: input,
      total_wallets: results.length,
      status: 'v11_computed_awaiting_ui_scrape',
      summary,
    },
    results,
    // Generate URLs for Playwright scraping
    scrape_urls: results.map(r => ({
      wallet: r.wallet,
      url: `https://polymarket.com/profile/${r.wallet}`,
      category: r.category,
    })),
  };

  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));
  console.log(`\n\nResults saved to: ${output}`);

  // Generate a simplified list for Playwright
  const urlList = results.map(r => `${r.wallet},${r.category}`).join('\n');
  fs.writeFileSync('tmp/categorized_wallets_to_scrape.csv', urlList);
  console.log('Wallet list for scraping: tmp/categorized_wallets_to_scrape.csv');

  console.log('\nNext steps:');
  console.log('1. Run Playwright scraper to get UI P/L values');
  console.log('2. Merge UI values into results');
  console.log('3. Generate comparison report');

  process.exit(0);
}

main().catch(console.error);
