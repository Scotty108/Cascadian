/**
 * Scrape detailed wallet info from Polymarket using Playwright
 */

import { chromium } from 'playwright';

const WALLET = process.argv[2] || '0xd4ef7f53b0f26f578bc49b85cd172715884d5787'; // gudmf

async function main() {
  console.log(`Scraping wallet: ${WALLET}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const url = `https://polymarket.com/profile/${WALLET}`;
  console.log(`Navigating to: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Get the page snapshot
  console.log('\n1. TAKING PAGE SNAPSHOT...\n');

  // Try to get the main PnL display
  const snapshot = await page.accessibility.snapshot();

  // Print the profile stats
  console.log('Looking for stats on the page...');

  // Get all text content
  const pageText = await page.textContent('body');

  // Look for common patterns
  const patterns = [
    /Profit\s*\/\s*Loss[:\s]*(-?\$?[\d,]+\.?\d*)/i,
    /P\s*&\s*L[:\s]*(-?\$?[\d,]+\.?\d*)/i,
    /Volume[:\s]*\$?([\d,]+\.?\d*)/i,
    /Positions[:\s]*(\d+)/i,
    /Markets traded[:\s]*(\d+)/i,
    /Net total[:\s]*(-?\$?[\d,]+\.?\d*)/i,
  ];

  // Hover on the info icon to get tooltip
  console.log('2. HOVERING ON INFO ICON TO GET TOOLTIP...');

  try {
    const infoIcon = page.locator('.text-text-secondary\\/60').first();
    if (await infoIcon.isVisible()) {
      await infoIcon.hover();
      await page.waitForTimeout(500);

      const tooltip = page.getByRole('tooltip');
      const tooltipText = await tooltip.textContent({ timeout: 2000 });
      console.log('TOOLTIP TEXT:', tooltipText);
    }
  } catch (e) {
    console.log('Could not get tooltip:', e);
  }

  // Now check the Activity tab
  console.log('\n3. CLICKING ACTIVITY TAB...');

  try {
    const activityTab = page.getByRole('tab', { name: /Activity/i });
    if (await activityTab.isVisible()) {
      await activityTab.click();
      await page.waitForTimeout(2000);

      // Get activity items
      console.log('Getting activity items...');

      // Look for trade rows
      const activityItems = await page.locator('[class*="activity"]').all();
      console.log(`Found ${activityItems.length} activity elements`);

      // Get first few items' text
      const rows = await page.locator('tr').all();
      console.log(`Found ${rows.length} table rows`);

      if (rows.length > 0) {
        console.log('\nFirst 10 activity rows:');
        for (let i = 0; i < Math.min(10, rows.length); i++) {
          const text = await rows[i].textContent();
          if (text && text.trim().length > 0) {
            console.log(`  ${i}: ${text.substring(0, 100)}...`);
          }
        }
      }
    }
  } catch (e) {
    console.log('Could not find activity tab:', e);
  }

  // Take a screenshot
  console.log('\n4. TAKING SCREENSHOT...');
  await page.screenshot({ path: 'data/gudmf-profile.png', fullPage: false });
  console.log('Screenshot saved to data/gudmf-profile.png');

  // Check for USDC deposits/withdrawals in their history
  console.log('\n5. LOOKING FOR DEPOSIT/WITHDRAWAL INFO...');

  // Navigate to portfolio tab
  try {
    const portfolioTab = page.getByRole('tab', { name: /Portfolio/i });
    if (await portfolioTab.isVisible()) {
      await portfolioTab.click();
      await page.waitForTimeout(1500);
      console.log('Switched to Portfolio tab');

      // Check for balance info
      const balanceElements = await page.locator('text=USDC').all();
      console.log(`Found ${balanceElements.length} USDC references`);
    }
  } catch (e) {
    console.log('Could not switch to Portfolio:', e);
  }

  await page.waitForTimeout(2000);
  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
