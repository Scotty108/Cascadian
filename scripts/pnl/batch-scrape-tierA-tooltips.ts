#!/usr/bin/env npx tsx
/**
 * BATCH SCRAPE TIER A TOOLTIPS (Using MCP Playwright)
 * ============================================================================
 *
 * This script provides a framework for batch scraping UI tooltip truth
 * from Polymarket profile pages using the Playwright MCP server.
 *
 * Due to MCP tool constraints, this script generates the scraping plan
 * and stores intermediate results. The actual scraping is done via
 * interactive MCP calls.
 *
 * Workflow:
 * 1. Load wallet sample file
 * 2. For each wallet, store the expected scrape URL
 * 3. Track which wallets have been scraped
 * 4. Store scraped results in output file
 *
 * Tooltip Schema (from Polymarket UI):
 * - Volume traded: Total USDC traded
 * - Gain: Total positive PnL from winning positions
 * - Loss: Total negative PnL from losing positions
 * - Net total: Gain + Loss (realized PnL)
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import * as fs from 'fs';

interface TooltipTruth {
  wallet_address: string;
  profile_url: string;
  scraped_at: string;
  metrics: {
    volume_traded: number;
    gain: number;
    loss: number;
    net_total: number;
  };
  raw: {
    volume_traded: string;
    gain: string;
    loss: string;
    net_total: string;
  };
}

interface ScrapeProgress {
  metadata: {
    sample_file: string;
    started_at: string;
    last_updated: string;
    total_wallets: number;
    scraped_count: number;
    remaining_count: number;
  };
  scraped: TooltipTruth[];
  pending: string[];
}

function parseMoneyValue(text: string): number {
  if (!text) return 0;
  // Remove $, commas, + signs
  let cleaned = text.replace(/[$,+]/g, '').trim();
  // Handle parentheses for negative values
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  return parseFloat(cleaned) || 0;
}

function initializeProgress(sampleFile: string): ScrapeProgress {
  const sampleData = JSON.parse(fs.readFileSync(sampleFile, 'utf-8'));
  const wallets = sampleData.wallets.map((w: any) => w.wallet_address);

  return {
    metadata: {
      sample_file: sampleFile,
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      total_wallets: wallets.length,
      scraped_count: 0,
      remaining_count: wallets.length
    },
    scraped: [],
    pending: wallets
  };
}

function loadProgress(progressFile: string): ScrapeProgress | null {
  if (fs.existsSync(progressFile)) {
    return JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
  }
  return null;
}

function saveProgress(progressFile: string, progress: ScrapeProgress): void {
  progress.metadata.last_updated = new Date().toISOString();
  progress.metadata.scraped_count = progress.scraped.length;
  progress.metadata.remaining_count = progress.pending.length;
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

function addScrapedWallet(
  progress: ScrapeProgress,
  wallet: string,
  rawMetrics: {
    volume_traded: string;
    gain: string;
    loss: string;
    net_total: string;
  }
): void {
  const truth: TooltipTruth = {
    wallet_address: wallet,
    profile_url: `https://polymarket.com/profile/${wallet}`,
    scraped_at: new Date().toISOString(),
    metrics: {
      volume_traded: parseMoneyValue(rawMetrics.volume_traded),
      gain: parseMoneyValue(rawMetrics.gain),
      loss: parseMoneyValue(rawMetrics.loss),
      net_total: parseMoneyValue(rawMetrics.net_total)
    },
    raw: rawMetrics
  };

  progress.scraped.push(truth);
  progress.pending = progress.pending.filter(w => w !== wallet);
}

async function main() {
  const args = process.argv.slice(2);
  let sampleType = 'top';
  let action = 'status';

  for (const arg of args) {
    if (arg.startsWith('--sample=')) {
      sampleType = arg.split('=')[1];
    } else if (arg.startsWith('--action=')) {
      action = arg.split('=')[1];
    }
  }

  const sampleFiles: Record<string, string> = {
    top: 'tmp/tierA_ui_tooltip_sample_top_volume_200.json',
    random: 'tmp/tierA_ui_tooltip_sample_random_200.json',
    combined: 'tmp/tierA_ui_tooltip_sample_combined_400.json'
  };

  const progressFiles: Record<string, string> = {
    top: 'tmp/ui_tooltip_scrape_progress_top200.json',
    random: 'tmp/ui_tooltip_scrape_progress_rand200.json',
    combined: 'tmp/ui_tooltip_scrape_progress_combined.json'
  };

  const outputFiles: Record<string, string> = {
    top: 'tmp/ui_tooltip_truth_tierA_top200.json',
    random: 'tmp/ui_tooltip_truth_tierA_rand200.json',
    combined: 'tmp/ui_tooltip_truth_tierA_combined.json'
  };

  const sampleFile = sampleFiles[sampleType];
  const progressFile = progressFiles[sampleType];
  const outputFile = outputFiles[sampleType];

  console.log('═'.repeat(80));
  console.log('TIER A TOOLTIP SCRAPING MANAGER');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Sample: ${sampleType}`);
  console.log(`Action: ${action}`);
  console.log('');

  if (action === 'init') {
    // Initialize new progress file
    if (!fs.existsSync(sampleFile)) {
      console.error(`Sample file not found: ${sampleFile}`);
      process.exit(1);
    }

    const progress = initializeProgress(sampleFile);
    saveProgress(progressFile, progress);
    console.log(`Initialized progress file: ${progressFile}`);
    console.log(`Total wallets to scrape: ${progress.pending.length}`);
    return;
  }

  if (action === 'status') {
    // Show current progress
    const progress = loadProgress(progressFile);
    if (!progress) {
      console.log('No progress file found. Run with --action=init first.');
      return;
    }

    console.log('Progress:');
    console.log(`  Total: ${progress.metadata.total_wallets}`);
    console.log(`  Scraped: ${progress.metadata.scraped_count}`);
    console.log(`  Remaining: ${progress.metadata.remaining_count}`);
    console.log(`  Last updated: ${progress.metadata.last_updated}`);
    console.log('');

    if (progress.pending.length > 0) {
      console.log('Next wallets to scrape:');
      progress.pending.slice(0, 5).forEach((w, i) => {
        console.log(`  ${i + 1}. https://polymarket.com/profile/${w}`);
      });
    }
    return;
  }

  if (action === 'next') {
    // Show next wallet to scrape
    const progress = loadProgress(progressFile);
    if (!progress) {
      console.log('No progress file found. Run with --action=init first.');
      return;
    }

    if (progress.pending.length === 0) {
      console.log('All wallets have been scraped!');
      return;
    }

    const nextWallet = progress.pending[0];
    console.log('Next wallet to scrape:');
    console.log(`  Wallet: ${nextWallet}`);
    console.log(`  URL: https://polymarket.com/profile/${nextWallet}`);
    console.log('');
    console.log('MCP commands to run:');
    console.log(`  1. mcp__playwright__browser_navigate(url: "https://polymarket.com/profile/${nextWallet}")`);
    console.log('  2. Wait for page load');
    console.log('  3. mcp__playwright__browser_hover(element: "Info icon next to Profit/Loss", ref: "<icon ref>")')
    console.log('  4. Read tooltip values from snapshot');
    return;
  }

  if (action === 'finalize') {
    // Export final output file
    const progress = loadProgress(progressFile);
    if (!progress) {
      console.log('No progress file found.');
      return;
    }

    const output = {
      metadata: {
        generated_at: new Date().toISOString(),
        sample_type: sampleType,
        total_wallets: progress.scraped.length,
        source: sampleFile,
        description: `UI tooltip truth for Tier A ${sampleType} sample`
      },
      wallets: progress.scraped
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`Finalized output: ${outputFile}`);
    console.log(`Total wallets: ${progress.scraped.length}`);
    return;
  }

  console.log('Unknown action. Use: --action=init|status|next|finalize');
}

main().catch(console.error);
