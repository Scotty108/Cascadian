#!/usr/bin/env npx tsx
/**
 * Scrape actual P/L values from Polymarket Gamma API
 *
 * This captures the REAL P/L values that match the UI,
 * which V11 should match.
 */

import fs from 'fs';

interface WalletPnL {
  wallet_address: string;
  ui_pnl: number | null;
  scraped_at: string;
  error?: string;
}

async function scrapeWalletPnL(wallet: string): Promise<WalletPnL> {
  try {
    const apiUrl = `https://gamma-api.polymarket.com/users/${wallet}`;

    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        wallet_address: wallet,
        ui_pnl: null,
        scraped_at: new Date().toISOString(),
        error: `API returned ${response.status}`,
      };
    }

    const data = await response.json();

    // The Gamma API returns pnl directly
    const pnl = data.pnl ?? data.realizedPnl ?? null;

    return {
      wallet_address: wallet,
      ui_pnl: typeof pnl === 'number' ? pnl : null,
      scraped_at: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      wallet_address: wallet,
      ui_pnl: null,
      scraped_at: new Date().toISOString(),
      error: err.message,
    };
  }
}

async function main() {
  const input = process.argv[2] || 'tmp/clob_10_wallets.json';
  const output = process.argv[3] || 'tmp/ui_pnl_scraped.json';

  console.log('Scraping P/L from Polymarket Gamma API...\n');
  console.log(`Input: ${input}`);
  console.log(`Output: ${output}\n`);

  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const wallets = inputData.wallets || inputData;

  const results: WalletPnL[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i].wallet_address;
    process.stdout.write(`[${i + 1}/${wallets.length}] ${wallet.slice(0, 10)}...`);

    const result = await scrapeWalletPnL(wallet);
    results.push(result);

    if (result.ui_pnl !== null) {
      console.log(` $${result.ui_pnl.toFixed(2)}`);
    } else {
      console.log(` Error: ${result.error}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  // Save results
  const outputData = {
    metadata: {
      scraped_at: new Date().toISOString(),
      source: 'gamma-api',
      total_wallets: results.length,
      successful: results.filter(r => r.ui_pnl !== null).length,
    },
    wallets: results,
  };

  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));
  console.log(`\nResults saved to: ${output}`);
}

main().catch(console.error);
