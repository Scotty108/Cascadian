/**
 * Scrape Polymarket profile UI for verification against CCR-v1 engine
 *
 * Usage: npx tsx scripts/ui-scrape-polymarket-profile.ts <username>
 *
 * Outputs: tmp/polymarket_ui_<username>.json with:
 *   - profileStats: { profitLoss, positionsValue, predictions }
 *   - activePositions: [{ marketTitle, outcome, shares, avgPrice, currentPrice, positionValue, unrealizedPnl, marketUrl }]
 *   - closedPositions: [{ marketTitle, outcome, shares, avgPrice, realizedPnl, marketUrl }]
 *   - activity: [{ timestamp, action, marketTitle, outcome, shares, price, amount, marketUrl }]
 */

import { chromium, Browser, Page, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const USERNAME = process.argv[2] || 'Lheo';
const OUTPUT_DIR = path.join(process.cwd(), 'tmp');
const MAX_LOAD_MORE_CLICKS = 100;
const LOAD_MORE_TIMEOUT = 30000;

interface ProfileStats {
  username: string;
  profitLoss: string;
  positionsValue: string;
  predictions: string;
  scrapedAt: string;
}

interface ActivePosition {
  marketTitle: string;
  outcome: string;
  shares: string;
  avgPrice: string;
  currentPrice: string;
  positionValue: string;
  unrealizedPnl: string;
  unrealizedPnlPct: string;
  marketUrl: string;
}

interface ClosedPosition {
  marketTitle: string;
  outcome: string;
  shares: string;
  avgPrice: string;
  realizedPnl: string;
  won: boolean;
  marketUrl: string;
}

interface ActivityItem {
  timestamp: string;
  action: string;
  marketTitle: string;
  outcome: string;
  shares: string;
  price: string;
  amount: string;
  marketUrl: string;
}

interface ScrapedData {
  profileStats: ProfileStats;
  activePositions: ActivePosition[];
  closedPositions: ClosedPosition[];
  activity: ActivityItem[];
}

/**
 * Reliable "Load more" clicker with retries and stability checks
 */
async function clickLoadMoreUntilDone(
  page: Page,
  containerSelector: string,
  itemSelector: string,
  buttonText: string = 'Load more'
): Promise<number> {
  let prevCount = 0;
  let stableRounds = 0;
  let clicks = 0;

  while (clicks < MAX_LOAD_MORE_CLICKS) {
    // Count current items
    const currentCount = await page.locator(itemSelector).count();
    console.log(`  Items: ${currentCount} (prev: ${prevCount})`);

    // Check if count stabilized
    if (currentCount === prevCount) {
      stableRounds++;
      if (stableRounds >= 2) {
        console.log(`  Load complete - count stabilized at ${currentCount}`);
        break;
      }
    } else {
      stableRounds = 0;
      prevCount = currentCount;
    }

    // Find and click "Load more" button
    const loadMoreButton = page.getByRole('button', { name: buttonText });

    try {
      // Check if button exists and is visible
      const isVisible = await loadMoreButton.isVisible({ timeout: 3000 }).catch(() => false);
      if (!isVisible) {
        console.log(`  No "${buttonText}" button visible - load complete`);
        break;
      }

      // Check if button is disabled
      const isDisabled = await loadMoreButton.isDisabled().catch(() => true);
      if (isDisabled) {
        console.log(`  Button disabled - load complete`);
        break;
      }

      // Scroll button into view
      await loadMoreButton.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(500); // Small wait for scroll to settle

      // Click with retry on stability issues
      let clickSuccess = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await loadMoreButton.click({ timeout: LOAD_MORE_TIMEOUT });
          clickSuccess = true;
          clicks++;
          console.log(`  Clicked "Load more" (${clicks})`);
          break;
        } catch (e: any) {
          if (e.message?.includes('not stable') || e.message?.includes('intercept')) {
            console.log(`  Retry ${attempt + 1}: element not stable, waiting...`);
            await page.waitForTimeout(1000);
          } else {
            throw e;
          }
        }
      }

      if (!clickSuccess) {
        console.log(`  Could not click button after retries`);
        break;
      }

      // Wait for network and DOM to settle
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);

    } catch (e: any) {
      if (e.message?.includes('Timeout') || e.message?.includes('not visible')) {
        console.log(`  Button not found/visible - load complete`);
        break;
      }
      console.log(`  Error: ${e.message}`);
      break;
    }
  }

  return await page.locator(itemSelector).count();
}

/**
 * Parse dollar amount from string like "$123.45" or "-$67.89"
 */
function parseDollarAmount(text: string): string {
  const cleaned = text.replace(/[^0-9.\-+]/g, '');
  return cleaned || '0';
}

async function scrapeProfileStats(page: Page): Promise<ProfileStats> {
  console.log('\n[Scraping Profile Stats]');

  // Wait for profile to load
  await page.waitForSelector('[class*="ProfileHeader"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Get the stats - they're usually in a stats section
  const stats: ProfileStats = {
    username: USERNAME,
    profitLoss: '0',
    positionsValue: '0',
    predictions: '0',
    scrapedAt: new Date().toISOString()
  };

  // Try to find profit/loss stat
  const pageText = await page.textContent('body') || '';

  // Look for patterns like "Profit/Loss $702.36"
  const pnlMatch = pageText.match(/Profit\s*\/?\s*Loss\s*[\$\-]?([\d,]+\.?\d*)/i);
  if (pnlMatch) {
    stats.profitLoss = pnlMatch[1].replace(/,/g, '');
  }

  // Look for positions value
  const posValMatch = pageText.match(/Positions?\s*Value\s*\$?([\d,]+\.?\d*)/i);
  if (posValMatch) {
    stats.positionsValue = posValMatch[1].replace(/,/g, '');
  }

  // Look for predictions count
  const predMatch = pageText.match(/(\d+)\s*Predictions?/i);
  if (predMatch) {
    stats.predictions = predMatch[1];
  }

  console.log(`  Profit/Loss: $${stats.profitLoss}`);
  console.log(`  Positions Value: $${stats.positionsValue}`);
  console.log(`  Predictions: ${stats.predictions}`);

  return stats;
}

async function scrapeActivePositions(page: Page): Promise<ActivePosition[]> {
  console.log('\n[Scraping Active Positions]');

  // Navigate to positions tab if not already there
  const positionsTab = page.getByRole('tab', { name: /positions/i });
  if (await positionsTab.isVisible().catch(() => false)) {
    await positionsTab.click();
    await page.waitForTimeout(2000);
  }

  // Click "Active" filter if available
  const activeFilter = page.getByRole('button', { name: /^active$/i });
  if (await activeFilter.isVisible().catch(() => false)) {
    await activeFilter.click();
    await page.waitForTimeout(2000);
  }

  // Load all items
  const itemCount = await clickLoadMoreUntilDone(
    page,
    'body',
    '[data-testid="position-card"], [class*="PositionCard"], [class*="position-row"]',
    'Load more'
  );
  console.log(`  Found ${itemCount} active position cards`);

  const positions: ActivePosition[] = [];

  // Get all position cards - try multiple selectors
  const cards = await page.locator('[data-testid="position-card"], [class*="PositionCard"], [class*="position-row"], [class*="Position_"]').all();

  for (const card of cards) {
    try {
      const cardText = await card.textContent() || '';

      // Skip if this looks like a closed position (has "Won" or "Lost")
      if (/\b(Won|Lost)\b/i.test(cardText)) continue;

      // Extract data from card text
      const position: ActivePosition = {
        marketTitle: '',
        outcome: '',
        shares: '0',
        avgPrice: '0',
        currentPrice: '0',
        positionValue: '0',
        unrealizedPnl: '0',
        unrealizedPnlPct: '0',
        marketUrl: ''
      };

      // Try to get market title (usually first text block)
      const titleEl = await card.locator('h3, h4, [class*="title"], [class*="Title"]').first().textContent().catch(() => '');
      position.marketTitle = titleEl?.trim() || cardText.split('\n')[0]?.trim() || '';

      // Try to get outcome (Yes/No)
      const outcomeMatch = cardText.match(/\b(Yes|No)\b/i);
      position.outcome = outcomeMatch ? outcomeMatch[1] : '';

      // Try to get shares
      const sharesMatch = cardText.match(/([\d,]+\.?\d*)\s*shares?/i);
      position.shares = sharesMatch ? sharesMatch[1].replace(/,/g, '') : '0';

      // Try to get avg price
      const avgPriceMatch = cardText.match(/Avg\.?\s*(?:price)?\s*:?\s*(\d+\.?\d*)¢?/i);
      position.avgPrice = avgPriceMatch ? avgPriceMatch[1] : '0';

      // Try to get current price
      const currentPriceMatch = cardText.match(/(\d+\.?\d*)¢/);
      position.currentPrice = currentPriceMatch ? currentPriceMatch[1] : '0';

      // Try to get position value
      const valueMatch = cardText.match(/\$\s*([\d,]+\.?\d*)/);
      position.positionValue = valueMatch ? valueMatch[1].replace(/,/g, '') : '0';

      // Try to get unrealized PnL
      const pnlMatch = cardText.match(/([+\-])\s*\$\s*([\d,]+\.?\d*)/);
      if (pnlMatch) {
        position.unrealizedPnl = pnlMatch[1] + pnlMatch[2].replace(/,/g, '');
      }

      // Try to get PnL percentage
      const pctMatch = cardText.match(/([+\-]?\d+\.?\d*)%/);
      position.unrealizedPnlPct = pctMatch ? pctMatch[1] : '0';

      // Try to get market URL from link
      const link = await card.locator('a[href*="/event/"]').first().getAttribute('href').catch(() => '');
      position.marketUrl = link ? `https://polymarket.com${link}` : '';

      if (position.marketTitle) {
        positions.push(position);
      }
    } catch (e) {
      // Skip problematic cards
    }
  }

  console.log(`  Extracted ${positions.length} active positions`);
  return positions;
}

async function scrapeClosedPositions(page: Page): Promise<ClosedPosition[]> {
  console.log('\n[Scraping Closed Positions]');

  // Click "Closed" filter
  const closedFilter = page.getByRole('button', { name: /^closed$/i });
  if (await closedFilter.isVisible().catch(() => false)) {
    await closedFilter.click();
    await page.waitForTimeout(2000);
  }

  // Load all items
  const itemCount = await clickLoadMoreUntilDone(
    page,
    'body',
    '[data-testid="position-card"], [class*="PositionCard"], [class*="position-row"]',
    'Load more'
  );
  console.log(`  Found ${itemCount} closed position cards`);

  const positions: ClosedPosition[] = [];

  // Get all position cards
  const cards = await page.locator('[data-testid="position-card"], [class*="PositionCard"], [class*="position-row"], [class*="Position_"]').all();

  for (const card of cards) {
    try {
      const cardText = await card.textContent() || '';

      // Only process closed positions (have "Won" or "Lost")
      const isWon = /\bWon\b/i.test(cardText);
      const isLost = /\bLost\b/i.test(cardText);
      if (!isWon && !isLost) continue;

      const position: ClosedPosition = {
        marketTitle: '',
        outcome: '',
        shares: '0',
        avgPrice: '0',
        realizedPnl: '0',
        won: isWon,
        marketUrl: ''
      };

      // Get market title
      const titleEl = await card.locator('h3, h4, [class*="title"], [class*="Title"]').first().textContent().catch(() => '');
      position.marketTitle = titleEl?.trim() || cardText.split('\n')[0]?.trim() || '';

      // Get outcome
      const outcomeMatch = cardText.match(/\b(Yes|No)\b/i);
      position.outcome = outcomeMatch ? outcomeMatch[1] : '';

      // Get shares
      const sharesMatch = cardText.match(/([\d,]+\.?\d*)\s*shares?/i);
      position.shares = sharesMatch ? sharesMatch[1].replace(/,/g, '') : '0';

      // Get avg price
      const avgPriceMatch = cardText.match(/Avg\.?\s*(?:price)?\s*:?\s*(\d+\.?\d*)¢?/i);
      position.avgPrice = avgPriceMatch ? avgPriceMatch[1] : '0';

      // Get realized PnL - look for dollar amounts with +/-
      const pnlMatch = cardText.match(/([+\-])\s*\$\s*([\d,]+\.?\d*)/);
      if (pnlMatch) {
        position.realizedPnl = pnlMatch[1] + pnlMatch[2].replace(/,/g, '');
      } else {
        // Try without sign
        const dollarMatch = cardText.match(/\$\s*([\d,]+\.?\d*)/);
        position.realizedPnl = dollarMatch ? dollarMatch[1].replace(/,/g, '') : '0';
        if (isLost && !position.realizedPnl.startsWith('-')) {
          position.realizedPnl = '-' + position.realizedPnl;
        }
      }

      // Get market URL
      const link = await card.locator('a[href*="/event/"]').first().getAttribute('href').catch(() => '');
      position.marketUrl = link ? `https://polymarket.com${link}` : '';

      if (position.marketTitle) {
        positions.push(position);
      }
    } catch (e) {
      // Skip problematic cards
    }
  }

  console.log(`  Extracted ${positions.length} closed positions`);
  return positions;
}

async function scrapeActivity(page: Page): Promise<ActivityItem[]> {
  console.log('\n[Scraping Activity]');

  // Click Activity tab
  const activityTab = page.getByRole('tab', { name: /activity/i });
  if (await activityTab.isVisible().catch(() => false)) {
    await activityTab.click();
    await page.waitForTimeout(2000);
  }

  // Load all items
  const itemCount = await clickLoadMoreUntilDone(
    page,
    'body',
    '[data-testid="activity-item"], [class*="ActivityItem"], [class*="activity-row"], [class*="Activity_"]',
    'Load more'
  );
  console.log(`  Found ${itemCount} activity items`);

  const activities: ActivityItem[] = [];

  // Get all activity items
  const items = await page.locator('[data-testid="activity-item"], [class*="ActivityItem"], [class*="activity-row"], [class*="Activity_"], [class*="transaction"]').all();

  for (const item of items) {
    try {
      const itemText = await item.textContent() || '';

      const activity: ActivityItem = {
        timestamp: '',
        action: '',
        marketTitle: '',
        outcome: '',
        shares: '0',
        price: '0',
        amount: '0',
        marketUrl: ''
      };

      // Detect action type
      if (/\bBuy\b/i.test(itemText) || /\bBought\b/i.test(itemText)) {
        activity.action = 'Buy';
      } else if (/\bSell\b/i.test(itemText) || /\bSold\b/i.test(itemText)) {
        activity.action = 'Sell';
      } else if (/\bRedeem/i.test(itemText)) {
        activity.action = 'Redeem';
      } else {
        continue; // Skip unknown actions
      }

      // Get timestamp
      const timeMatch = itemText.match(/(\d+[hmd]\s*ago|\w+\s+\d+,?\s*\d*)/i);
      activity.timestamp = timeMatch ? timeMatch[1] : '';

      // Get market title (usually after action type)
      const titleEl = await item.locator('[class*="title"], [class*="Title"], h3, h4').first().textContent().catch(() => '');
      activity.marketTitle = titleEl?.trim() || '';

      // Get outcome
      const outcomeMatch = itemText.match(/\b(Yes|No)\b/i);
      activity.outcome = outcomeMatch ? outcomeMatch[1] : '';

      // Get shares
      const sharesMatch = itemText.match(/([\d,]+\.?\d*)\s*shares?/i);
      activity.shares = sharesMatch ? sharesMatch[1].replace(/,/g, '') : '0';

      // Get price
      const priceMatch = itemText.match(/(\d+\.?\d*)¢/);
      activity.price = priceMatch ? priceMatch[1] : '0';

      // Get amount
      const amountMatch = itemText.match(/\$\s*([\d,]+\.?\d*)/);
      activity.amount = amountMatch ? amountMatch[1].replace(/,/g, '') : '0';

      // Get market URL
      const link = await item.locator('a[href*="/event/"]').first().getAttribute('href').catch(() => '');
      activity.marketUrl = link ? `https://polymarket.com${link}` : '';

      if (activity.action) {
        activities.push(activity);
      }
    } catch (e) {
      // Skip problematic items
    }
  }

  console.log(`  Extracted ${activities.length} activity items`);
  return activities;
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Scraping Polymarket Profile: ${USERNAME}`);
  console.log(`${'='.repeat(70)}`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  try {
    // Navigate to profile
    const profileUrl = `https://polymarket.com/@${USERNAME}`;
    console.log(`\nNavigating to ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Scrape all sections
    const profileStats = await scrapeProfileStats(page);

    // Go to positions tab
    await page.goto(`${profileUrl}?tab=positions`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const activePositions = await scrapeActivePositions(page);
    const closedPositions = await scrapeClosedPositions(page);

    // Go to activity tab
    await page.goto(`${profileUrl}?tab=activity`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const activity = await scrapeActivity(page);

    // Compile results
    const data: ScrapedData = {
      profileStats,
      activePositions,
      closedPositions,
      activity
    };

    // Save to file
    const outputPath = path.join(OUTPUT_DIR, `polymarket_ui_${USERNAME.toLowerCase()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Saved to: ${outputPath}`);

    // Print summary
    console.log(`\n[Summary]`);
    console.log(`  Profile Stats: P/L=$${profileStats.profitLoss}, Value=$${profileStats.positionsValue}`);
    console.log(`  Active Positions: ${activePositions.length}`);
    console.log(`  Closed Positions: ${closedPositions.length}`);
    console.log(`  Activity Items: ${activity.length}`);

    // Calculate totals from scraped data
    const closedPnlSum = closedPositions.reduce((sum, p) => {
      const pnl = parseFloat(p.realizedPnl) || 0;
      return sum + pnl;
    }, 0);
    console.log(`  Sum of Closed PnL: $${closedPnlSum.toFixed(2)}`);

    const activePnlSum = activePositions.reduce((sum, p) => {
      const pnl = parseFloat(p.unrealizedPnl) || 0;
      return sum + pnl;
    }, 0);
    console.log(`  Sum of Active Unrealized: $${activePnlSum.toFixed(2)}`);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  } finally {
    await browser.close();
  }
}

main();
