/**
 * Playwright-backed PnL Accuracy Test
 *
 * Scrapes real PnL values from Polymarket UI and compares against V20 engine
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { chromium, Browser, Page } from 'playwright';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

interface WalletTestResult {
  wallet: string;
  name: string;
  ui_pnl: number | null;
  v20_pnl: number;
  error_pct: number | null;
  status: 'pass' | 'fail' | 'error';
  notes: string;
}

// Test wallets - mix of top leaderboard and random wallets
const TEST_WALLETS = [
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo4' },
  { wallet: '0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf', name: 'Fredi9999' },
  { wallet: '0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76', name: 'Len9311238' },
  { wallet: '0xd235973291b2b75ff4070e9c0b01728c520b0f29', name: 'zxgngl' },
  { wallet: '0x863134d00841b2e200492805a01e1e2f5defaa53', name: 'RepTrump' },
];

function parseUSDValue(text: string): number | null {
  if (!text) return null;

  // Remove currency symbols, commas, and whitespace
  const cleaned = text.replace(/[$,\s]/g, '').replace(/[+]/g, '');

  // Handle negative values
  const isNegative = text.includes('-') || text.includes('(');
  const value = parseFloat(cleaned.replace(/[-()]/g, ''));

  if (isNaN(value)) return null;
  return isNegative ? -value : value;
}

async function scrapeWalletPnL(page: Page, wallet: string): Promise<number | null> {
  const url = `https://polymarket.com/profile/${wallet}`;

  try {
    console.log(`   Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the page to load
    await page.waitForTimeout(3000);

    // Try multiple selectors for PnL value
    const selectors = [
      // Look for "Profit" or "Net" sections
      'text=/Net total/i >> xpath=../following-sibling::*[1]',
      'text=/Profit/i >> xpath=../following-sibling::*[1]',
      // Look for gain/loss display
      '[data-testid="profit-value"]',
      '[data-testid="pnl-value"]',
      // Generic approach - find large dollar amounts
      '.c-dhzjXW:has-text("$")',
    ];

    // Take a snapshot for debugging
    const snapshot = await page.accessibility.snapshot();

    // Look for PnL in the accessibility tree
    let pnlValue: number | null = null;

    // Method 1: Look for "Net total" text followed by value
    const pageContent = await page.content();

    // Method 2: Use page.evaluate to find PnL value
    const result = await page.evaluate(() => {
      // Look for elements containing "Net total" or similar
      const allElements = document.querySelectorAll('*');
      let foundValue: string | null = null;

      for (const el of allElements) {
        const text = el.textContent?.trim() || '';

        // Look for patterns like "+$22,053,934" or "$22,053,934"
        const match = text.match(/[+-]?\$[\d,]+(?:\.\d+)?/);
        if (match) {
          // Check if this is in a "profit" or "net" context
          const parent = el.parentElement?.textContent?.toLowerCase() || '';
          if (parent.includes('net') || parent.includes('profit') || parent.includes('gain')) {
            foundValue = match[0];
            break;
          }
        }
      }

      // If not found in context, look for the largest dollar value on the page
      if (!foundValue) {
        const dollarMatches = document.body.textContent?.match(/[+-]?\$[\d,]+(?:\.\d+)?/g) || [];
        let maxValue = 0;
        for (const m of dollarMatches) {
          const val = parseFloat(m.replace(/[$,+]/g, ''));
          if (!isNaN(val) && Math.abs(val) > Math.abs(maxValue)) {
            maxValue = val;
            foundValue = m;
          }
        }
      }

      return foundValue;
    });

    if (result) {
      pnlValue = parseUSDValue(result);
      console.log(`   Found PnL value: ${result} -> ${pnlValue}`);
    }

    // Method 3: Take screenshot and log for manual verification
    const screenshotPath = `/tmp/pnl-test-${wallet.slice(0, 10)}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`   Screenshot saved to ${screenshotPath}`);

    return pnlValue;

  } catch (error) {
    console.log(`   Error scraping wallet: ${error}`);
    return null;
  }
}

async function runTest() {
  console.log('='.repeat(100));
  console.log('PLAYWRIGHT UI PNL ACCURACY TEST');
  console.log('='.repeat(100));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Testing ${TEST_WALLETS.length} wallets`);
  console.log('');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const results: WalletTestResult[] = [];

  try {
    for (const { wallet, name } of TEST_WALLETS) {
      console.log(`\nTesting ${name} (${wallet.slice(0, 10)}...):`);

      // Get V20 PnL
      console.log('   Calculating V20 PnL...');
      const v20Result = await calculateV20PnL(wallet);
      console.log(`   V20 PnL: $${v20Result.total_pnl.toLocaleString()}`);

      // Scrape UI PnL
      console.log('   Scraping UI PnL...');
      const uiPnl = await scrapeWalletPnL(page, wallet);

      // Calculate error
      let errorPct: number | null = null;
      let status: 'pass' | 'fail' | 'error' = 'error';
      let notes = '';

      if (uiPnl !== null) {
        if (uiPnl === 0) {
          errorPct = v20Result.total_pnl === 0 ? 0 : 100;
        } else {
          errorPct = Math.abs((v20Result.total_pnl - uiPnl) / uiPnl) * 100;
        }

        if (errorPct <= 5) {
          status = 'pass';
          notes = 'Within 5% tolerance';
        } else {
          status = 'fail';
          notes = `Error exceeds 5% tolerance`;
        }
      } else {
        notes = 'Could not scrape UI PnL';
      }

      results.push({
        wallet,
        name,
        ui_pnl: uiPnl,
        v20_pnl: v20Result.total_pnl,
        error_pct: errorPct,
        status,
        notes
      });

      // Rate limiting
      await page.waitForTimeout(2000);
    }

  } finally {
    await browser.close();
  }

  // Generate Report
  console.log('\n');
  console.log('='.repeat(100));
  console.log('ACCURACY REPORT');
  console.log('='.repeat(100));
  console.log('');

  console.log('| Wallet Name    | UI PnL           | V20 PnL          | Error %  | Status |');
  console.log('|----------------|------------------|------------------|----------|--------|');

  for (const r of results) {
    const uiStr = r.ui_pnl !== null ? `$${r.ui_pnl.toLocaleString()}` : 'N/A';
    const v20Str = `$${r.v20_pnl.toLocaleString()}`;
    const errStr = r.error_pct !== null ? `${r.error_pct.toFixed(1)}%` : 'N/A';
    const statusEmoji = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️';

    console.log(`| ${r.name.padEnd(14)} | ${uiStr.padStart(16)} | ${v20Str.padStart(16)} | ${errStr.padStart(8)} | ${statusEmoji}     |`);
  }

  // Summary stats
  const validResults = results.filter(r => r.error_pct !== null);
  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  console.log('');
  console.log('-'.repeat(100));
  console.log('SUMMARY');
  console.log('-'.repeat(100));
  console.log(`Total Wallets Tested:  ${results.length}`);
  console.log(`Passed (≤5% error):    ${passCount}/${results.length} (${((passCount/results.length)*100).toFixed(0)}%)`);
  console.log(`Failed (>5% error):    ${failCount}/${results.length}`);
  console.log(`Scrape Errors:         ${errorCount}/${results.length}`);

  if (validResults.length > 0) {
    const avgError = validResults.reduce((sum, r) => sum + (r.error_pct || 0), 0) / validResults.length;
    const medianError = validResults.map(r => r.error_pct || 0).sort((a, b) => a - b)[Math.floor(validResults.length / 2)];

    console.log(`Average Error:         ${avgError.toFixed(2)}%`);
    console.log(`Median Error:          ${medianError.toFixed(2)}%`);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('');

  // Overall verdict
  const overallPass = passCount >= Math.ceil(results.length * 0.8);
  if (overallPass) {
    console.log('🎉 OVERALL RESULT: PASS - V20 engine is accurate within 5% for 80%+ of wallets');
  } else {
    console.log('⚠️  OVERALL RESULT: NEEDS REVIEW - Accuracy below 80% threshold');
  }

  return results;
}

runTest().catch(console.error);
