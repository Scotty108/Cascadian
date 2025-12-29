#!/usr/bin/env npx tsx
/**
 * Validation using Playwright MCP
 *
 * This script generates a list of wallets to validate via Playwright MCP.
 * Use the output with Playwright MCP tools to scrape actual UI values.
 *
 * The script outputs wallets in JSON format for easy processing.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  const SAMPLE_SIZE = 50;

  console.log('='.repeat(80));
  console.log('GENERATING WALLETS FOR PLAYWRIGHT MCP VALIDATION');
  console.log('='.repeat(80));

  // Get random sample from cohort with meaningful PnL
  const q = await clickhouse.query({
    query: `
      SELECT
        wallet,
        realized_pnl_usd as cohort_pnl,
        total_trades,
        omega
      FROM pm_cohort_pnl_active_v1
      WHERE abs(realized_pnl_usd) > 500
        AND total_trades >= 20
        AND total_trades <= 200
        AND omega > 0.5 AND omega < 500
      ORDER BY rand()
      LIMIT ${SAMPLE_SIZE}
    `,
    format: 'JSONEachRow'
  });
  const wallets = await q.json() as any[];

  console.log(`\nSelected ${wallets.length} wallets for validation\n`);

  // Output for Playwright MCP
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      purpose: 'Playwright MCP validation of cohort PnL values',
      instructions: [
        '1. For each wallet, navigate to https://polymarket.com/profile/{wallet}',
        '2. Click the "ALL" timeframe button',
        '3. Extract the P/L value shown in the UI',
        '4. Compare with cohort_pnl value',
        '5. A good match is within ±15% (0.85x - 1.15x ratio)',
      ],
    },
    wallets: wallets.map(w => ({
      wallet: w.wallet,
      url: `https://polymarket.com/profile/${w.wallet}`,
      cohort_pnl: w.cohort_pnl,
      total_trades: w.total_trades,
      omega: w.omega,
      ui_pnl: null, // To be filled by Playwright
      ratio: null,  // cohort / ui
      match: null,  // boolean
    })),
  };

  // Save to file
  const outputPath = 'tmp/playwright_validation_input.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`✅ Saved ${wallets.length} wallets to ${outputPath}`);

  // Print first 10 for quick reference
  console.log('\n--- SAMPLE WALLETS ---\n');
  for (const w of wallets.slice(0, 10)) {
    console.log(`${w.wallet}`);
    console.log(`  URL: https://polymarket.com/profile/${w.wallet}`);
    console.log(`  Cohort PnL: $${w.cohort_pnl.toFixed(2)}`);
    console.log(`  Trades: ${w.total_trades}, Omega: ${w.omega.toFixed(2)}`);
    console.log('');
  }

  console.log('--- PLAYWRIGHT MCP INSTRUCTIONS ---\n');
  console.log('Use these Playwright MCP commands to validate:');
  console.log('1. browser_navigate to the wallet URL');
  console.log('2. browser_snapshot to see the page');
  console.log('3. browser_click on "ALL" button if not selected');
  console.log('4. Read the P/L value from the snapshot');
  console.log('5. Compare with cohort_pnl value above');
  console.log('');

  await clickhouse.close();
}

main().catch(console.error);
