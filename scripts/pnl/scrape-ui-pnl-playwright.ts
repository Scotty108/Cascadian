#!/usr/bin/env npx tsx
/**
 * Scrape Polymarket UI P/L Values via Playwright MCP
 *
 * This script:
 * 1. Loads wallets from the categorized V11 results
 * 2. For each wallet, navigates to their Polymarket profile
 * 3. Extracts the P/L value from the UI
 * 4. Merges results back into the validation file
 *
 * REQUIRES: Playwright MCP to be running
 * Run this script manually and use Playwright MCP tools to scrape each wallet.
 */

import fs from 'fs';

interface ValidationResult {
  wallet: string;
  category: string;
  tags: string[];
  v11_realized_pnl: number;
  v11_total_gain: number;
  v11_total_loss: number;
  v11_open_positions: number;
  v11_open_value: number;
  v11_synthetic_realized: number;
  ui_pnl: number | null;
  difference: number | null;
  difference_pct: number | null;
  matches: boolean;
  error?: string;
}

function parseUIPnL(raw: string): number | null {
  // Parse P/L strings like "$1,234.56", "-$456.78", "$102,200"
  if (!raw) return null;

  const cleaned = raw
    .replace(/[$,]/g, '')
    .replace(//g, '-')  // Replace unicode minus
    .trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function main() {
  const input = process.argv[2] || 'tmp/categorized_v11_results.json';
  const output = process.argv[3] || 'tmp/categorized_validation_complete.json';

  console.log('='.repeat(80));
  console.log('UI P/L SCRAPER - MANUAL MODE');
  console.log('='.repeat(80));
  console.log(`\nInput: ${input}`);
  console.log(`Output: ${output}\n`);

  const data = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const results: ValidationResult[] = data.results;

  console.log(`Loaded ${results.length} wallets\n`);

  // If we have UI data already (from manual scraping), skip
  const needsScraping = results.filter(r => r.ui_pnl === null && !r.error);
  console.log(`${needsScraping.length} wallets need UI scraping\n`);

  // Print URLs for manual scraping
  console.log('--- WALLETS TO SCRAPE ---\n');
  for (let i = 0; i < Math.min(20, needsScraping.length); i++) {
    const r = needsScraping[i];
    console.log(`${i + 1}. [${r.category}] ${r.wallet}`);
    console.log(`   URL: https://polymarket.com/profile/${r.wallet}`);
    console.log(`   V11: $${r.v11_realized_pnl.toFixed(2)}`);
    console.log('');
  }

  console.log('\n--- INSTRUCTIONS ---');
  console.log('1. Use Playwright MCP to navigate to each URL');
  console.log('2. Take a snapshot to get the P/L value');
  console.log('3. Update the JSON file with ui_pnl values');
  console.log('4. Re-run this script to compute matches');
  console.log('');
  console.log('Or use the batch scraper below...');

  // If running interactively, we can update the file
  if (process.argv.includes('--update-from-scraped')) {
    const scrapedFile = process.argv[process.argv.indexOf('--update-from-scraped') + 1];
    if (scrapedFile && fs.existsSync(scrapedFile)) {
      console.log(`\nLoading scraped data from: ${scrapedFile}`);
      const scraped = JSON.parse(fs.readFileSync(scrapedFile, 'utf-8'));

      const scrapedMap = new Map<string, number>();
      for (const item of scraped) {
        if (item.wallet && item.ui_pnl !== null) {
          scrapedMap.set(item.wallet.toLowerCase(), item.ui_pnl);
        }
      }

      // Merge scraped data
      let updated = 0;
      for (const r of results) {
        const uiPnl = scrapedMap.get(r.wallet.toLowerCase());
        if (uiPnl !== undefined) {
          r.ui_pnl = uiPnl;
          r.difference = r.v11_realized_pnl - uiPnl;
          r.difference_pct = uiPnl !== 0 ? (r.difference / Math.abs(uiPnl)) * 100 : null;
          r.matches = Math.abs(r.difference) < Math.max(1, Math.abs(uiPnl) * 0.05);
          updated++;
        }
      }
      console.log(`Updated ${updated} wallets with UI data`);
    }
  }

  // Compute summary statistics
  const withUI = results.filter(r => r.ui_pnl !== null);
  const matches = withUI.filter(r => r.matches);

  console.log('\n--- CURRENT STATUS ---');
  console.log(`Total wallets: ${results.length}`);
  console.log(`With UI data: ${withUI.length}`);
  console.log(`Matches: ${matches.length}/${withUI.length} (${((matches.length / withUI.length) * 100).toFixed(1)}%)`);

  // Group by category
  const categories = [...new Set(results.map(r => r.category))];
  console.log('\n--- BY CATEGORY ---');
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catWithUI = catResults.filter(r => r.ui_pnl !== null);
    const catMatches = catWithUI.filter(r => r.matches);
    console.log(`${cat}: ${catMatches.length}/${catWithUI.length} matches (${catWithUI.length}/${catResults.length} scraped)`);
  }

  // Save updated results
  data.results = results;
  data.metadata.updated_at = new Date().toISOString();
  data.metadata.ui_scraped = withUI.length;
  data.metadata.matches = matches.length;

  fs.writeFileSync(output, JSON.stringify(data, null, 2));
  console.log(`\nSaved to: ${output}`);
}

main().catch(console.error);
