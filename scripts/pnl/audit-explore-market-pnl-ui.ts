/**
 * Explore Polymarket UI for Per-Market PnL Data
 *
 * This script explores the portfolio/positions tabs on Polymarket profile pages
 * to understand what per-market PnL data is available for scraping.
 *
 * Terminal: Claude 1 (Auditor Track)
 * Date: 2025-12-04
 */

import { chromium, Browser, Page } from 'playwright';

const TEST_WALLET = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'; // Theo4 (top wallet)

interface MarketPosition {
  market_title: string;
  condition_id?: string;
  outcome?: string;
  shares?: number;
  avg_price?: number;
  current_price?: number;
  value?: number;
  pnl?: number;
  pnl_pct?: number;
  status?: 'open' | 'resolved';
}

async function exploreWalletPortfolio(page: Page, wallet: string): Promise<void> {
  const url = `https://polymarket.com/profile/${wallet}`;
  console.log(`\nNavigating to: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Ensure ALL timeframe is selected
  try {
    await page.click('text=ALL');
    await page.waitForTimeout(1500);
    console.log('Selected ALL timeframe');
  } catch (e) {
    console.log('Could not click ALL button - may already be selected');
  }

  // Get username
  let username = 'Unknown';
  try {
    const usernameEl = await page.locator('p').first();
    username = await usernameEl.textContent() || 'Unknown';
    console.log(`Username: ${username}`);
  } catch (e) {}

  // Take initial screenshot
  await page.screenshot({ path: '/tmp/pnl-audit-profile.png', fullPage: false });
  console.log('Screenshot saved to /tmp/pnl-audit-profile.png');

  // Look for Portfolio/Positions tab
  console.log('\n--- EXPLORING TABS ---');

  const tabs = await page.locator('[role="tablist"] button, [role="tab"]').all();
  console.log(`Found ${tabs.length} tab elements`);

  for (let i = 0; i < tabs.length; i++) {
    const text = await tabs[i].textContent();
    console.log(`  Tab ${i}: ${text?.trim()}`);
  }

  // Try to click on Portfolio tab
  console.log('\n--- CLICKING PORTFOLIO TAB ---');
  try {
    const portfolioTab = page.getByRole('tab', { name: /Portfolio/i });
    if (await portfolioTab.isVisible()) {
      await portfolioTab.click();
      await page.waitForTimeout(2000);
      console.log('Clicked Portfolio tab');

      // Take screenshot
      await page.screenshot({ path: '/tmp/pnl-audit-portfolio.png', fullPage: false });
      console.log('Screenshot saved to /tmp/pnl-audit-portfolio.png');

      // Look for position cards/rows
      await explorePortfolioContent(page);
    } else {
      console.log('Portfolio tab not visible');
    }
  } catch (e) {
    console.log(`Portfolio tab error: ${e}`);
  }

  // Try Activity tab (for resolved positions with PnL)
  console.log('\n--- CLICKING ACTIVITY TAB ---');
  try {
    const activityTab = page.getByRole('tab', { name: /Activity/i });
    if (await activityTab.isVisible()) {
      await activityTab.click();
      await page.waitForTimeout(2000);
      console.log('Clicked Activity tab');

      // Take screenshot
      await page.screenshot({ path: '/tmp/pnl-audit-activity.png', fullPage: false });
      console.log('Screenshot saved to /tmp/pnl-audit-activity.png');

      // Look for trade/resolution rows
      await exploreActivityContent(page);
    }
  } catch (e) {
    console.log(`Activity tab error: ${e}`);
  }

  // Try clicking on "Positions" tab first, then "Closed" filter
  console.log('\n--- EXPLORING POSITIONS VIEW ---');
  try {
    // First ensure we're on Positions tab
    const positionsTab = page.getByRole('tab', { name: /Positions/i });
    if (await positionsTab.isVisible()) {
      await positionsTab.click();
      await page.waitForTimeout(1500);
      console.log('Clicked Positions tab');
    }

    // Then explore the Closed positions (resolved markets with PnL)
    await exploreResolvedPositions(page);
  } catch (e) {
    console.log(`Positions view error: ${e}`);
  }
}

async function explorePortfolioContent(page: Page): Promise<void> {
  console.log('\n--- PORTFOLIO CONTENT ANALYSIS ---');

  // Look for cards or rows with market data
  const cards = await page.locator('[class*="card"], [class*="position"], [class*="market"]').all();
  console.log(`Found ${cards.length} potential position elements`);

  // Get all links to markets
  const marketLinks = await page.locator('a[href*="/event/"]').all();
  console.log(`Found ${marketLinks.length} market links`);

  for (let i = 0; i < Math.min(5, marketLinks.length); i++) {
    const href = await marketLinks[i].getAttribute('href');
    const text = await marketLinks[i].textContent();
    console.log(`  Market ${i}: ${text?.substring(0, 50)}... | ${href}`);
  }

  // Look for dollar values
  const dollarEls = await page.locator('text=/\\$[\\d,]+/').all();
  console.log(`Found ${dollarEls.length} dollar value elements`);

  for (let i = 0; i < Math.min(10, dollarEls.length); i++) {
    const text = await dollarEls[i].textContent();
    const parent = await dollarEls[i].locator('..').textContent();
    console.log(`  Value ${i}: ${text} | Context: ${parent?.substring(0, 60)?.replace(/\s+/g, ' ')}`);
  }
}

async function exploreActivityContent(page: Page): Promise<void> {
  console.log('\n--- ACTIVITY CONTENT ANALYSIS ---');

  // Look for table rows
  const rows = await page.locator('tr').all();
  console.log(`Found ${rows.length} table rows`);

  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const text = await rows[i].textContent();
    if (text && text.trim().length > 5) {
      console.log(`  Row ${i}: ${text.substring(0, 120).replace(/\s+/g, ' ')}...`);
    }
  }

  // Look for "Sold" or "Bought" or "Redeemed" entries
  const tradeEls = await page.locator('text=/Bought|Sold|Redeemed/i').all();
  console.log(`Found ${tradeEls.length} trade/redemption entries`);
}

async function exploreResolvedPositions(page: Page): Promise<void> {
  console.log('\n--- RESOLVED POSITIONS ANALYSIS ---');

  // Click on "Closed" to see resolved positions with PnL
  try {
    const closedButton = page.locator('button:has-text("Closed")');
    if (await closedButton.count() > 0) {
      await closedButton.click();
      await page.waitForTimeout(2000);
      console.log('Clicked "Closed" filter');
      await page.screenshot({ path: '/tmp/pnl-audit-closed-positions.png', fullPage: false });
    }
  } catch (e) {
    console.log(`Could not click Closed: ${e}`);
  }

  // Use page.evaluate to get the actual DOM structure of position rows
  console.log('\n--- EXTRACTING POSITION ROW DATA ---');

  const positionData = await page.evaluate(() => {
    const results: any[] = [];

    // Find all links to events
    const links = document.querySelectorAll('a[href*="/event/"]');
    const processedSlugs = new Set<string>();

    links.forEach((link) => {
      const href = link.getAttribute('href');
      const slugMatch = href?.match(/\/event\/([^/?]+)/);
      if (!slugMatch) return;

      const slug = slugMatch[1];
      if (processedSlugs.has(slug)) return;
      processedSlugs.add(slug);

      // Navigate up to find the row container
      let row = link.parentElement;
      for (let i = 0; i < 10 && row; i++) {
        // Look for a row that contains dollar values
        const text = row.textContent || '';
        if (text.includes('$') && text.match(/\$[\d,]+/g)?.length >= 2) {
          break;
        }
        row = row.parentElement;
      }

      if (!row) return;

      // Get all text content from the row
      const rowText = row.textContent || '';

      // Get all dollar values
      const dollarValues = rowText.match(/\$[\d,]+(?:\.\d+)?/g) || [];

      // Get PnL with percentage (green/red text)
      const pnlMatch = rowText.match(/([+-]?\$[\d,]+(?:\.\d+)?)\s*\(([+-]?[\d.]+)%\)/);

      results.push({
        slug,
        title: link.textContent?.trim().substring(0, 100),
        rowText: rowText.substring(0, 300).replace(/\s+/g, ' '),
        dollarValues,
        pnlMatch: pnlMatch ? { value: pnlMatch[1], pct: pnlMatch[2] } : null,
      });
    });

    return results.slice(0, 10); // First 10 for analysis
  });

  console.log(`\nExtracted ${positionData.length} position rows:`);
  for (const p of positionData) {
    console.log(`\n  Slug: ${p.slug}`);
    console.log(`  Title: ${p.title}`);
    console.log(`  Dollar values: ${JSON.stringify(p.dollarValues)}`);
    console.log(`  PnL match: ${JSON.stringify(p.pnlMatch)}`);
    console.log(`  Row text: ${p.rowText}`);
  }
}

async function main() {
  console.log('='.repeat(100));
  console.log('POLYMARKET UI EXPLORATION - PER-MARKET PnL DATA');
  console.log('='.repeat(100));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Test Wallet: ${TEST_WALLET}`);
  console.log('');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });

  const page = await context.newPage();

  try {
    await exploreWalletPortfolio(page, TEST_WALLET);
  } finally {
    await browser.close();
  }

  console.log('\n');
  console.log('='.repeat(100));
  console.log('EXPLORATION COMPLETE');
  console.log('='.repeat(100));
  console.log('\nScreenshots saved to /tmp/pnl-audit-*.png');
  console.log('Review these to understand the UI structure for per-market PnL scraping.');
}

main().catch(console.error);
