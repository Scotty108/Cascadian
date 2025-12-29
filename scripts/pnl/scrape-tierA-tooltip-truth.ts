#!/usr/bin/env npx tsx
/**
 * SCRAPE TIER A UI TOOLTIP TRUTH
 * ============================================================================
 *
 * Uses Playwright to scrape PnL tooltip values from Polymarket profile pages
 * for Tier A wallet samples. This creates the ground truth for validation.
 *
 * Metrics captured:
 * - Total PnL (from tooltip hover on balance)
 * - Profit/Gains
 * - Loss
 * - Volume
 * - Positions (active/closed counts)
 *
 * Inputs:
 * - tmp/tierA_ui_tooltip_sample_top_volume_200.json (or specify)
 * - tmp/tierA_ui_tooltip_sample_random_200.json
 *
 * Outputs:
 * - tmp/ui_tooltip_truth_tierA_top200.json
 * - tmp/ui_tooltip_truth_tierA_rand200.json
 *
 * Usage:
 *   npx tsx scripts/pnl/scrape-tierA-tooltip-truth.ts --sample=top
 *   npx tsx scripts/pnl/scrape-tierA-tooltip-truth.ts --sample=random
 *   npx tsx scripts/pnl/scrape-tierA-tooltip-truth.ts --sample=combined --limit=50
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import * as fs from 'fs';

// Playwright types
interface BrowserSnapshot {
  role: string;
  name?: string;
  children?: BrowserSnapshot[];
  ref?: string;
}

interface TooltipMetrics {
  wallet_address: string;
  scraped_at: string;
  success: boolean;
  error?: string;
  metrics?: {
    profit_loss?: number;
    volume?: number;
    positions_won?: number;
    positions_lost?: number;
    // Additional fields from tooltip
    raw_pnl_text?: string;
    raw_volume_text?: string;
    raw_positions_text?: string;
  };
}

interface Config {
  sampleType: 'top' | 'random' | 'combined';
  limit: number;
  inputFile: string;
  outputFile: string;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let sampleType: 'top' | 'random' | 'combined' = 'top';
  let limit = 200;

  for (const arg of args) {
    if (arg.startsWith('--sample=')) {
      const val = arg.split('=')[1];
      if (val === 'top' || val === 'random' || val === 'combined') {
        sampleType = val;
      }
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1]) || 200;
    }
  }

  const inputFiles: Record<string, string> = {
    top: 'tmp/tierA_ui_tooltip_sample_top_volume_200.json',
    random: 'tmp/tierA_ui_tooltip_sample_random_200.json',
    combined: 'tmp/tierA_ui_tooltip_sample_combined_400.json'
  };

  const outputFiles: Record<string, string> = {
    top: 'tmp/ui_tooltip_truth_tierA_top200.json',
    random: 'tmp/ui_tooltip_truth_tierA_rand200.json',
    combined: 'tmp/ui_tooltip_truth_tierA_combined.json'
  };

  return {
    sampleType,
    limit,
    inputFile: inputFiles[sampleType],
    outputFile: outputFiles[sampleType]
  };
}

function parseMoneyValue(text: string): number | undefined {
  if (!text) return undefined;
  // Remove $, commas, and parse
  const cleaned = text.replace(/[$,]/g, '').trim();
  // Handle negative values like ($1,234) or -$1,234
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return -parseFloat(cleaned.slice(1, -1));
  }
  return parseFloat(cleaned);
}

async function main() {
  const config = parseArgs();

  console.log('═'.repeat(80));
  console.log('SCRAPING TIER A UI TOOLTIP TRUTH');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Sample type: ${config.sampleType}`);
  console.log(`Limit: ${config.limit}`);
  console.log(`Input: ${config.inputFile}`);
  console.log(`Output: ${config.outputFile}`);
  console.log('');

  // Load input file
  if (!fs.existsSync(config.inputFile)) {
    console.error(`ERROR: Input file not found: ${config.inputFile}`);
    console.error('Run generate-tierA-tooltip-samples.ts first');
    process.exit(1);
  }

  const sampleData = JSON.parse(fs.readFileSync(config.inputFile, 'utf-8'));
  const wallets = sampleData.wallets.slice(0, config.limit);
  console.log(`Loaded ${wallets.length} wallets to scrape\n`);

  // Results array
  const results: TooltipMetrics[] = [];

  console.log('Starting Playwright scraping...');
  console.log('─'.repeat(80));
  console.log('');
  console.log('NOTE: This script requires Playwright MCP server to be running.');
  console.log('The actual scraping will use browser_navigate and browser_snapshot.');
  console.log('');
  console.log('For each wallet, the script will:');
  console.log('  1. Navigate to https://polymarket.com/profile/{wallet}');
  console.log('  2. Wait for page load');
  console.log('  3. Hover over PnL stat card to trigger tooltip');
  console.log('  4. Extract tooltip values');
  console.log('  5. Parse and store metrics');
  console.log('');

  // Since we're using MCP tools, we'll need to interact via the assistant
  // This script prepares the data and saves a "to-scrape" list

  const toScrape = {
    metadata: {
      generated_at: new Date().toISOString(),
      sample_type: config.sampleType,
      total_wallets: wallets.length,
      status: 'pending_scrape'
    },
    wallets: wallets.map((w: any) => ({
      wallet_address: w.wallet_address,
      profile_url: `https://polymarket.com/profile/${w.wallet_address}`,
      clob_usdc_volume: w.clob_usdc_volume
    }))
  };

  // Save the to-scrape list
  const toScrapeFile = config.outputFile.replace('.json', '_pending.json');
  fs.writeFileSync(toScrapeFile, JSON.stringify(toScrape, null, 2));
  console.log(`Saved to-scrape list: ${toScrapeFile}`);

  console.log('\n' + '═'.repeat(80));
  console.log('MANUAL SCRAPING INSTRUCTIONS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('To scrape tooltip truth for these wallets:');
  console.log('');
  console.log('1. For each wallet in the to-scrape list:');
  console.log('   a. Use mcp__playwright__browser_navigate to go to profile URL');
  console.log('   b. Use mcp__playwright__browser_snapshot to get page state');
  console.log('   c. Find the PnL stat card and hover over it');
  console.log('   d. Capture tooltip values');
  console.log('');
  console.log('2. Alternatively, run the batch scraper:');
  console.log('   npx tsx scripts/pnl/batch-scrape-tooltip-truth.ts');
  console.log('');
  console.log('3. Or use the interactive scraper for a smaller sample:');
  console.log('   npx tsx scripts/pnl/interactive-tooltip-scraper.ts --wallet=0x...');
  console.log('');
}

main().catch(console.error);
