/**
 * Verify PnL with ALL timeframe selected
 */

import { chromium } from 'playwright';

const WALLET = process.argv[2] || '0xd16896480f5768b7b34696a1f888f36ae109f3cf'; // JohnnyCash7

async function main() {
  console.log(`Verifying ALL timeframe for: ${WALLET}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const url = `https://polymarket.com/profile/${WALLET}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // First get the 1M (default) value
  console.log('\n1. DEFAULT (1M) VIEW:');

  try {
    const infoIcon = page.locator('.text-text-secondary\\/60').first();
    await infoIcon.hover();
    await page.waitForTimeout(500);
    const tooltip = page.getByRole('tooltip');
    const tooltipText = await tooltip.textContent({ timeout: 2000 });
    console.log('1M Tooltip:', tooltipText);
  } catch (e) {
    console.log('Could not get 1M tooltip');
  }

  // Now click ALL
  console.log('\n2. CLICKING ALL TIMEFRAME:');

  // Try different approaches to click ALL
  const allSelectors = [
    'text=ALL',
    '[role="button"]:has-text("ALL")',
    'button:has-text("ALL")',
    ':text("ALL")',
  ];

  let clicked = false;
  for (const selector of allSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible()) {
        console.log(`Found ALL with selector: ${selector}`);
        await el.click();
        await page.waitForTimeout(1500);
        clicked = true;
        break;
      }
    } catch (e) {
      // Try next selector
    }
  }

  if (!clicked) {
    console.log('Trying text-based click...');
    try {
      await page.click('text="ALL"');
      await page.waitForTimeout(1500);
      clicked = true;
    } catch (e) {
      console.log('Could not click ALL');
    }
  }

  // Get the ALL timeframe tooltip
  console.log('\n3. ALL TIMEFRAME TOOLTIP:');

  try {
    const infoIcon = page.locator('.text-text-secondary\\/60').first();
    await infoIcon.hover();
    await page.waitForTimeout(500);
    const tooltip = page.getByRole('tooltip');
    const tooltipText = await tooltip.textContent({ timeout: 2000 });
    console.log('ALL Tooltip:', tooltipText);
  } catch (e) {
    console.log('Could not get ALL tooltip');
  }

  // Take screenshot
  await page.screenshot({ path: 'data/johnny-all-timeframe.png' });
  console.log('\nScreenshot saved to data/johnny-all-timeframe.png');

  // Get the main PnL display value
  console.log('\n4. MAIN PNL DISPLAY:');
  try {
    // Look for the big PnL number
    const pnlDisplay = await page.locator('.text-3xl, .text-4xl, .text-2xl').first().textContent();
    console.log('Main PnL display:', pnlDisplay);
  } catch (e) {
    console.log('Could not get main PnL display');
  }

  // Keep browser open for manual inspection
  console.log('\nBrowser will close in 5 seconds...');
  await page.waitForTimeout(5000);
  await browser.close();
}

main().catch(console.error);
