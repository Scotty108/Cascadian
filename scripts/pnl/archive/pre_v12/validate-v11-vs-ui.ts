#!/usr/bin/env npx tsx
/**
 * Validate V11 against actual Polymarket UI using Playwright
 *
 * This script:
 * 1. Loads wallets from input file
 * 2. Scrapes actual P/L from Polymarket UI via Playwright MCP
 * 3. Compares to V11 calculation
 * 4. Checks for "zombie" active positions (resolved but showing at 0¢)
 */

import fs from 'fs';
import { createV11Engine } from '../../lib/pnl/uiActivityEngineV11';

interface ValidationResult {
  wallet: string;
  ui_pnl: number | null;
  v11_pnl: number;
  v11_total_gain: number;
  v11_total_loss: number;
  difference: number | null;
  difference_pct: number | null;
  matches: boolean;
  zombie_positions: number;  // Active positions at 0¢
  zombie_value: number;      // Total value of zombie positions
  error?: string;
}

// This will be called by the main orchestrator which uses Playwright MCP
export interface UIScrapedData {
  pnl: number | null;
  pnl_raw: string;
  active_positions: {
    market: string;
    outcome: string;
    shares: number;
    avg_price: number;
    current_price: number;
    value: number;
    pnl: number;
  }[];
  closed_positions_count: number;
}

async function main() {
  const input = process.argv[2] || 'tmp/clob_10_wallets.json';
  const output = process.argv[3] || 'tmp/v11_vs_ui_validation.json';

  console.log('='.repeat(80));
  console.log('V11 vs UI VALIDATION');
  console.log('='.repeat(80));
  console.log(`\nInput: ${input}`);
  console.log(`Output: ${output}\n`);

  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const wallets = inputData.wallets || inputData;

  const v11 = createV11Engine();
  const results: ValidationResult[] = [];

  console.log('Computing V11 for all wallets first...\n');

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const wallet = w.wallet_address;

    console.log(`[${i + 1}/${wallets.length}] ${wallet.slice(0, 10)}...`);

    try {
      const v11Result = await v11.compute(wallet);

      // Count zombie positions (resolved to 0 but still showing as "active")
      let zombiePositions = 0;
      let zombieValue = 0;

      for (const pos of v11Result.positions) {
        // A zombie position is one that:
        // 1. Had tokens bought (avgPrice > 0)
        // 2. Was resolved to 0 (position.amount = 0 after resolution)
        // 3. Shows as a loss
        if (pos.avgPrice > 0 && pos.amount === 0 && pos.realized_pnl < -10) {
          zombiePositions++;
          zombieValue += Math.abs(pos.realized_pnl);
        }
      }

      results.push({
        wallet,
        ui_pnl: null, // Will be filled by Playwright scraper
        v11_pnl: v11Result.realized_pnl,
        v11_total_gain: v11Result.total_gain,
        v11_total_loss: v11Result.total_loss,
        difference: null,
        difference_pct: null,
        matches: false,
        zombie_positions: zombiePositions,
        zombie_value: zombieValue,
      });

      console.log(`  V11: $${v11Result.realized_pnl.toFixed(2)} (gain: $${v11Result.total_gain.toFixed(0)}, loss: $${v11Result.total_loss.toFixed(0)})`);
      console.log(`  Zombies: ${zombiePositions} positions worth $${zombieValue.toFixed(0)}`);
      console.log(`  Dome benchmark: $${w.dome_realized || 'N/A'}`);

      // Check if Dome matches total_gain (our hypothesis)
      if (w.dome_realized && Math.abs(w.dome_realized - v11Result.total_gain) < 10) {
        console.log(`  ⚠️  Dome matches V11 TOTAL_GAIN (not net P/L)!`);
      }

    } catch (err: any) {
      results.push({
        wallet,
        ui_pnl: null,
        v11_pnl: 0,
        v11_total_gain: 0,
        v11_total_loss: 0,
        difference: null,
        difference_pct: null,
        matches: false,
        zombie_positions: 0,
        zombie_value: 0,
        error: err.message,
      });
      console.log(`  Error: ${err.message}`);
    }
  }

  // Save intermediate results (V11 computed, awaiting UI scrape)
  const outputData = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: input,
      total_wallets: results.length,
      status: 'v11_computed_awaiting_ui_scrape',
    },
    results,
  };

  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));
  console.log(`\nIntermediate results saved to: ${output}`);
  console.log('\nNow run the Playwright scraper to get UI P/L values...');
}

main().catch(console.error);
