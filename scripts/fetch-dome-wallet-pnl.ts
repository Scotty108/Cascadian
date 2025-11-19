#!/usr/bin/env npx tsx

/**
 * Fetch Dome Wallet P&L Baselines
 *
 * Pulls realized P&L for 14 benchmark wallets from Dome API
 * and saves to tmp/dome-baseline-wallets.json for validation
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const BASE_URL = process.env.DOME_API_BASE_URL!;
const KEY = process.env.DOME_API_KEY!;

// 14 benchmark wallets from docs/reports/wallet-benchmark-delta.md
const WALLETS = [
  { address: '0x7f3c8979d0afa00007bae4747d5347122af05613', label: 'Wallet 1' },
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', label: 'Wallet 2' },
  { address: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', label: 'Wallet 3' },
  { address: '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397', label: 'Wallet 4' },
  { address: '0xd748c701ad93cfec32a3420e10f3b08e68612125', label: 'Wallet 5' },
  { address: '0xd06f0f7719df1b3b75b607923536b3250825d4a6', label: 'Wallet 6' },
  { address: '0x3b6fd06a595d71c70afb3f44414be1c11304340b', label: 'Wallet 7' },
  { address: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', label: 'Wallet 8' },
  { address: '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', label: 'Wallet 9' },
  { address: '0x662244931c392df70bd064fa91f838eea0bfd7a9', label: 'Wallet 10' },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', label: 'Wallet 11' },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', label: 'Wallet 12' },
  { address: '0x2e0b70d482e6b389e81dea528be57d825dd48070', label: 'Wallet 13' },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', label: 'Wallet 14 (baseline)' }
];

interface WalletPnL {
  address: string;
  label: string;
  expected_pnl: number;
}

async function fetchWalletPnl(address: string, label: string): Promise<WalletPnL> {
  const url = `${BASE_URL}/polymarket/wallet/pnl/${address}?granularity=all`;

  console.log(`Fetching ${address.substring(0, 12)}... (${label})`);

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: any = await response.json();

    // Get the latest P&L value from pnl_over_time array
    const pnlOverTime = data.pnl_over_time || [];
    const latest = pnlOverTime[pnlOverTime.length - 1];

    if (!latest || latest.pnl_to_date === undefined) {
      console.warn(`  ⚠️  No P&L data found for ${address}`);
      return {
        address,
        label,
        expected_pnl: 0
      };
    }

    const pnl = Number(latest.pnl_to_date);
    console.log(`  ✅ P&L: $${pnl.toLocaleString()}`);

    return {
      address,
      label,
      expected_pnl: pnl
    };
  } catch (error: any) {
    console.error(`  ❌ Error: ${error.message}`);
    return {
      address,
      label,
      expected_pnl: 0
    };
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('FETCHING DOME WALLET P&L BASELINES');
  console.log('═'.repeat(80));
  console.log(`API: ${BASE_URL}`);
  console.log(`Wallets: ${WALLETS.length}\n`);

  const results: WalletPnL[] = [];

  for (const wallet of WALLETS) {
    const result = await fetchWalletPnl(wallet.address, wallet.label);
    results.push(result);

    // Be polite to API (500ms delay between requests)
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Ensure tmp directory exists
  try {
    mkdirSync('tmp', { recursive: true });
  } catch {
    // Directory already exists
  }

  // Save results to JSON
  const outputPath = 'tmp/dome-baseline-wallets.json';
  writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log();
  console.log('═'.repeat(80));
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(80));
  console.log();
  console.table(results.map(r => ({
    Address: r.address.substring(0, 12) + '...',
    Label: r.label,
    'Expected P&L': `$${r.expected_pnl.toLocaleString()}`
  })));
  console.log();
  console.log(`✅ Saved to: ${outputPath}`);
  console.log('═'.repeat(80));
}

main().catch(console.error);
