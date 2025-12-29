/**
 * Batch scrape fresh UI PnL benchmarks via Playwright MCP
 *
 * Run with: npx tsx scripts/pnl/batch-scrape-fresh-benchmarks.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

// Top wallets to scrape (mix of big winners and smaller wallets for coverage)
const WALLETS_TO_SCRAPE = [
  // Top 20 all-time
  '0x56687bf447db6ffa42ffe2204a05edaa20f55839', // Theo4
  '0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf', // Fredi9999
  '0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76', // Len9311238
  '0x863134d00841b2e200492805a01e1e2f5defaa53', // RepTrump
  '0x8119010a6e589062aa03583bb3f39ca632d9f887', // PrincessCaro
  '0x23786fdad0073692157c6d7dc81f281843a35fcb', // mikatrade77
  '0xed2239a9150c3920000d0094d28fa51c7db03dd0', // Michie
  '0x2bf64b86b64c315d879571b07a3b76629e467cd0', // BabaTrump
  '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', // primm
  '0xd31a2ea0b5f9a10c2eb78dcc36df016497d5386e', // DarthVooncer
  // Some smaller/test wallets
  '0x99f8d8bad56ed2541d64fbbc3fc6c71873a17dd5',
  '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838',
  '0xe907e229a93738879a4db78d379bd06da14bc114',
  '0xc0297820800c4df9c7b00b3c4ea7e04b246ce277',
  '0xbb49c8d518f71db91f7a0a61bc8a29d3364355bf',
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   BATCH SCRAPE FRESH BENCHMARKS                                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('This script outputs wallet URLs for Playwright MCP scraping.\n');
  console.log('For each wallet, use browser_navigate then browser_snapshot to get PnL.\n');

  console.log('=== WALLETS TO SCRAPE ===\n');

  for (let i = 0; i < WALLETS_TO_SCRAPE.length; i++) {
    const w = WALLETS_TO_SCRAPE[i];
    console.log(`${i + 1}. https://polymarket.com/profile/${w}`);
  }

  console.log('\n=== SCRAPING INSTRUCTIONS ===\n');
  console.log('1. Use mcp__playwright__browser_navigate to go to each URL');
  console.log('2. Use mcp__playwright__browser_snapshot to capture page');
  console.log('3. Extract PnL value from the "Profit/Loss" section');
  console.log('4. PnL is in nested generic elements under heading "Profit/Loss"');
  console.log('\nExample PnL extraction from snapshot:');
  console.log('  Look for: heading "Profit/Loss" [level=2]');
  console.log('  PnL value is in the generic elements below, e.g., $22,053,934.00');

  // Also output as JSON for easy parsing
  const now = new Date().toISOString();
  const benchmarkSetId = `fresh_${now.slice(0, 10).replace(/-/g, '')}_${Date.now()}`;

  console.log('\n=== BENCHMARK SET INFO ===\n');
  console.log(`Benchmark set ID: ${benchmarkSetId}`);
  console.log(`Timestamp: ${now}`);
  console.log(`Wallets: ${WALLETS_TO_SCRAPE.length}`);

  // Template for results
  console.log('\n=== RESULTS TEMPLATE (copy and fill in) ===\n');
  console.log('const SCRAPED_RESULTS = [');
  for (const w of WALLETS_TO_SCRAPE) {
    console.log(`  { wallet: '${w}', ui_pnl: 0 }, // TODO: fill in`);
  }
  console.log('];');
}

main().catch(console.error);
