#!/usr/bin/env npx tsx
/**
 * PLAYWRIGHT SCRAPE VERIFIED 100 WALLETS
 * ============================================================================
 *
 * Scrapes UI tooltip data for 100 Tier A Verified wallets using Playwright.
 * Outputs to format compatible with validate-v12-against-tooltip-truth.ts
 *
 * Note: This script is designed to be run with manual Playwright MCP interaction
 * or can be adapted for headless automation.
 *
 * For now, we'll process results incrementally and save progress.
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import * as fs from 'fs';

interface ScrapedWallet {
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

interface TruthFile {
  metadata: {
    generated_at: string;
    sample_type: string;
    total_wallets: number;
    description: string;
  };
  wallets: ScrapedWallet[];
}

function parseMoneyString(s: string): number {
  // Remove $, +, commas and parse
  const cleaned = s.replace(/[$,+]/g, '').trim();
  return parseFloat(cleaned);
}

function addScrapedWallet(
  outputFile: string,
  wallet: string,
  volumeTraded: string,
  gain: string,
  loss: string,
  netTotal: string
): void {
  let data: TruthFile;

  if (fs.existsSync(outputFile)) {
    data = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
  } else {
    data = {
      metadata: {
        generated_at: new Date().toISOString(),
        sample_type: 'tierA_verified_100',
        total_wallets: 0,
        description: 'UI tooltip truth from 100 Tier A Verified wallets',
      },
      wallets: [],
    };
  }

  // Check if wallet already exists
  const existingIdx = data.wallets.findIndex(w => w.wallet_address === wallet);
  if (existingIdx >= 0) {
    console.log(`Wallet ${wallet} already scraped, updating...`);
    data.wallets.splice(existingIdx, 1);
  }

  const scrapedWallet: ScrapedWallet = {
    wallet_address: wallet,
    profile_url: `https://polymarket.com/profile/${wallet}`,
    scraped_at: new Date().toISOString(),
    metrics: {
      volume_traded: parseMoneyString(volumeTraded),
      gain: parseMoneyString(gain),
      loss: parseMoneyString(loss),
      net_total: parseMoneyString(netTotal),
    },
    raw: {
      volume_traded: volumeTraded,
      gain: gain,
      loss: loss,
      net_total: netTotal,
    },
  };

  data.wallets.push(scrapedWallet);
  data.metadata.total_wallets = data.wallets.length;
  data.metadata.generated_at = new Date().toISOString();

  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
  console.log(`Added wallet ${wallet}. Total: ${data.wallets.length}`);
}

// Export for use from command line or other scripts
export { addScrapedWallet, parseMoneyString };

// If run directly, show usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 5) {
    console.log('Usage: npx tsx playwright-scrape-verified-100.ts <wallet> <volume> <gain> <loss> <net_total>');
    console.log('');
    console.log('Example:');
    console.log('  npx tsx playwright-scrape-verified-100.ts 0x1234... "$88,989,760.30" "+$689,295.28" "-$468,192.98" "+$221,102.30"');
    process.exit(1);
  }

  const [wallet, volumeTraded, gain, loss, netTotal] = args;
  addScrapedWallet(
    'tmp/ui_tooltip_truth_tierA_verified_100.json',
    wallet,
    volumeTraded,
    gain,
    loss,
    netTotal
  );
}
