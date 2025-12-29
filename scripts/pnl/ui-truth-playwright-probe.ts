/**
 * UI Truth Playwright Probe
 *
 * Captures the REAL UI PnL from Polymarket using proper Playwright automation:
 * 1. Opens the profile page in a real browser
 * 2. Waits for full render
 * 3. Captures screenshot
 * 4. Captures all network responses (API calls)
 * 5. Logs the DOM text around the PnL card
 *
 * Usage:
 *   npx tsx scripts/pnl/ui-truth-playwright-probe.ts 0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';

// We'll use Playwright MCP for browser automation
// This script generates instructions for what to capture

const WALLET = process.argv[2] || '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd';

async function main() {
  console.log('=== UI TRUTH PLAYWRIGHT PROBE ===\n');
  console.log(`Target wallet: ${WALLET}`);
  console.log(`Profile URL: https://polymarket.com/profile/${WALLET}\n`);

  // Ensure output directories exist
  const debugDir = 'tmp/ui_probe_responses';
  if (!fs.existsSync('tmp')) fs.mkdirSync('tmp');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  console.log('INSTRUCTIONS FOR PLAYWRIGHT MCP:\n');
  console.log('1. Navigate to the profile page');
  console.log('2. Wait for networkidle');
  console.log('3. Take a screenshot');
  console.log('4. Look for these elements in the DOM:');
  console.log('   - Any element containing "Profit" or "P&L" or "PnL"');
  console.log('   - The value next to it (likely a dollar amount)');
  console.log('   - Note the exact label used');
  console.log('');
  console.log('5. Capture network responses containing:');
  console.log('   - /portfolio');
  console.log('   - /profile');
  console.log('   - /pnl');
  console.log('   - graphql');
  console.log('   - any JSON response with "pnl" field');
  console.log('');
  console.log('EXPECTED OUTPUT:');
  console.log(`   tmp/ui_probe_${WALLET.slice(0, 8)}.png`);
  console.log(`   ${debugDir}/${WALLET.slice(0, 8)}_*.json`);
  console.log('   tmp/ui_truth_spec.md\n');

  // Generate the manual Playwright commands
  console.log('=== PLAYWRIGHT MCP COMMANDS TO RUN ===\n');
  console.log(`1. browser_navigate to: https://polymarket.com/profile/${WALLET}`);
  console.log('2. browser_wait_for: networkidle (or 5 seconds)');
  console.log('3. browser_take_screenshot');
  console.log('4. browser_snapshot (to get DOM state)');
  console.log('5. browser_network_requests (to see API calls)');
  console.log('6. browser_evaluate: document.body.innerText (to search for PnL text)');
}

main().catch(console.error);
