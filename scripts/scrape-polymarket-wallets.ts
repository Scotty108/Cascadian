import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { mkdirSync } from 'fs';

const WALLETS = [
  '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
  '0xd748c701ad93cfec32a3420e10f3b08e68612125',
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0x7f3c8979d0afa00007bae4747d5347122af05613',
  '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8',
  '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397',
  '0xd06f0f7719df1b3b75b607923536b3250825d4a6',
  '0x3b6fd06a595d71c70afb3f44414be1c11304340b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', // baseline
  '0x662244931c392df70bd064fa91f838eea0bfd7a9',
  '0x2e0b70d482e6b389e81dea528be57d825dd48070',
];

interface WalletResult {
  wallet: string;
  polymarket_url: string;
  polymarket_pnl: number | null;
  polymarket_predictions: number | null;
  username: string | null;
  screenshot_path: string | null;
  scraped_at: string;
  status: 'SUCCESS' | 'PARTIAL' | 'PAGE_LOAD_FAILED' | 'WALLET_NOT_FOUND' | 'PNL_NOT_FOUND';
  notes: string;
}

async function scrapeWallet(wallet: string): Promise<WalletResult> {
  const url = `https://polymarket.com/profile/${wallet}`;
  const result: WalletResult = {
    wallet,
    polymarket_url: url,
    polymarket_pnl: null,
    polymarket_predictions: null,
    username: null,
    screenshot_path: null,
    scraped_at: new Date().toISOString(),
    status: 'PAGE_LOAD_FAILED',
    notes: '',
  };

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    console.log(`📊 Scraping ${wallet.slice(0, 10)}...`);

    // Navigate with timeout
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    } catch (e) {
      result.notes = 'Page load timeout after 15s';
      return result;
    }

    // Wait a bit for dynamic content
    await page.waitForTimeout(3000);

    // Get page content
    const content = await page.content();
    const text = await page.textContent('body');

    // Try to extract P&L
    // Look for patterns like "$123,456" or "-$12,345"
    const pnlPatterns = [
      /Net P&L[:\s]+\$?([-]?[\d,]+(?:\.\d{2})?)/i,
      /P&L[:\s]+\$?([-]?[\d,]+(?:\.\d{2})?)/i,
      /Profit[:\s]+\$?([-]?[\d,]+(?:\.\d{2})?)/i,
      /Total[:\s]+\$?([-]?[\d,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of pnlPatterns) {
      const match = text?.match(pattern);
      if (match && match[1]) {
        const pnlStr = match[1].replace(/,/g, '');
        result.polymarket_pnl = parseFloat(pnlStr);
        break;
      }
    }

    // Try to extract prediction count
    const predictionPatterns = [
      /([\d,]+)\s+predictions?/i,
      /([\d,]+)\s+position/i,
      /([\d,]+)\s+market/i,
    ];

    for (const pattern of predictionPatterns) {
      const match = text?.match(pattern);
      if (match && match[1]) {
        const countStr = match[1].replace(/,/g, '');
        result.polymarket_predictions = parseInt(countStr, 10);
        break;
      }
    }

    // Try to extract username
    const usernameMatch = text?.match(/@(\w+)/);
    if (usernameMatch) {
      result.username = usernameMatch[0];
    }

    // Take screenshot
    const screenshotDir = `docs/artifacts/polymarket-wallets/${wallet}`;
    mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = `${screenshotDir}/page.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot_path = screenshotPath;

    // Determine status
    if (result.polymarket_pnl !== null && result.polymarket_predictions !== null) {
      result.status = 'SUCCESS';
    } else if (result.polymarket_pnl !== null || result.polymarket_predictions !== null) {
      result.status = 'PARTIAL';
      result.notes = 'Could not extract all data';
    } else {
      result.status = 'PNL_NOT_FOUND';
      result.notes = 'Could not extract P&L or predictions from page';
    }

    console.log(`  ✅ ${result.status}: PnL=${result.polymarket_pnl}, Predictions=${result.polymarket_predictions}`);

  } catch (error) {
    result.status = 'PAGE_LOAD_FAILED';
    result.notes = error instanceof Error ? error.message : 'Unknown error';
    console.log(`  ❌ FAILED: ${result.notes}`);
  } finally {
    await browser.close();
  }

  return result;
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('POLYMARKET WALLET SCRAPER');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  const results: WalletResult[] = [];

  for (const wallet of WALLETS) {
    const result = await scrapeWallet(wallet);
    results.push(result);

    // Delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Save results
  const outputPath = 'tmp/wallet-validation-ui-results.json';
  writeFileSync(outputPath, JSON.stringify(results, null, 2));

  // Summary
  console.log('\n════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  const successCount = results.filter(r => r.status === 'SUCCESS').length;
  const partialCount = results.filter(r => r.status === 'PARTIAL').length;
  const failedCount = results.filter(r => !['SUCCESS', 'PARTIAL'].includes(r.status)).length;

  console.log(`✅ Success: ${successCount}/14 wallets`);
  console.log(`⚠️  Partial: ${partialCount}/14 wallets`);
  console.log(`❌ Failed: ${failedCount}/14 wallets`);
  console.log(`\n📄 Results saved to: ${outputPath}`);
  console.log(`📸 Screenshots saved to: docs/artifacts/polymarket-wallets/`);
}

main().catch(console.error);
