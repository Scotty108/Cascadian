/**
 * Per-Market PnL Benchmark Scraper
 *
 * Scrapes the Polymarket UI "Closed" positions view to capture per-market PnL
 * for benchmark wallets. This granular data enables debugging which specific
 * markets are causing PnL calculation errors.
 *
 * Output: pm_ui_pnl_by_market_v1 ClickHouse table
 *
 * Usage:
 *   npx tsx scripts/pnl/sync-ui-pnl-by-market.ts                    # All benchmark wallets
 *   npx tsx scripts/pnl/sync-ui-pnl-by-market.ts --wallet 0x123...  # Single wallet
 *   npx tsx scripts/pnl/sync-ui-pnl-by-market.ts --limit 5          # First 5 wallets
 *   npx tsx scripts/pnl/sync-ui-pnl-by-market.ts --set fresh_2025_12_04_alltime
 *
 * Terminal: Claude 1 (Auditor Track)
 * Date: 2025-12-04
 */

import { chromium, Browser, Page } from 'playwright';
import { clickhouse } from '../../lib/clickhouse/client';

interface MarketPnLEntry {
  wallet: string;
  market_slug: string;
  market_title: string;
  result: 'won' | 'lost' | 'unknown';
  outcome_label: string;
  shares: number;
  avg_price: number;
  total_bet: number;
  amount_won: number;
  pnl: number;
  pnl_pct: number;
  scraped_at: string;
  benchmark_set: string;
}

interface BenchmarkWallet {
  wallet: string;
  pnl_value: number;
  note: string;
}

async function ensureTableExists(): Promise<void> {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS pm_ui_pnl_by_market_v1 (
      wallet String,
      market_slug String,
      market_title String,
      result String,
      outcome_label String,
      shares Float64,
      avg_price Float64,
      total_bet Float64,
      amount_won Float64,
      pnl Float64,
      pnl_pct Float64,
      scraped_at DateTime,
      benchmark_set String
    ) ENGINE = ReplacingMergeTree()
    ORDER BY (wallet, market_slug, benchmark_set)
    SETTINGS index_granularity = 8192
  `;

  await clickhouse.command({ query: createTableQuery });
  console.log('Table pm_ui_pnl_by_market_v1 ready');
}

async function loadBenchmarkWallets(benchmarkSet: string): Promise<BenchmarkWallet[]> {
  const query = `
    SELECT wallet, pnl_value, note
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${benchmarkSet}'
    ORDER BY pnl_value DESC
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as BenchmarkWallet[];
}

function parseUSDValue(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/[$,\s]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) ? 0 : value;
}

function parsePnLValue(text: string): { pnl: number; pnl_pct: number } {
  // Parse patterns like "+$8,303,171.23 (170.38%)" or "-$21.35 (-5.2%)"
  const pnlMatch = text.match(/([+-])\$?([\d,]+(?:\.\d+)?)/);
  const pctMatch = text.match(/\(([+-]?[\d.]+)%\)/);

  let pnl = 0;
  let pnl_pct = 0;

  if (pnlMatch) {
    const sign = pnlMatch[1] === '-' ? -1 : 1;
    pnl = sign * parseFloat(pnlMatch[2].replace(/,/g, ''));
  }

  if (pctMatch) {
    pnl_pct = parseFloat(pctMatch[1]);
  }

  return { pnl, pnl_pct };
}

function parseSharesAndPrice(text: string): { shares: number; avg_price: number } {
  // Parse patterns like "13,175,255.2 Yes at 37¢" or "9,686,804.6 No at 37¢"
  const sharesMatch = text.match(/([\d,]+(?:\.\d+)?)\s+(Yes|No)/i);
  const priceMatch = text.match(/at\s+([\d.]+)¢/i);

  let shares = 0;
  let avg_price = 0;

  if (sharesMatch) {
    shares = parseFloat(sharesMatch[1].replace(/,/g, ''));
  }

  if (priceMatch) {
    avg_price = parseFloat(priceMatch[1]) / 100; // Convert cents to dollars
  }

  return { shares, avg_price };
}

async function scrapeClosedPositions(
  page: Page,
  wallet: string,
  benchmarkSet: string
): Promise<MarketPnLEntry[]> {
  const url = `https://polymarket.com/profile/${wallet}`;
  console.log(`  Navigating to ${url}...`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Ensure ALL timeframe is selected
  try {
    await page.click('text=ALL');
    await page.waitForTimeout(1000);
  } catch (e) {
    // May already be selected
  }

  // Click on Positions tab
  try {
    const positionsTab = page.getByRole('tab', { name: /Positions/i });
    await positionsTab.click();
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log(`  Could not click Positions tab`);
    return [];
  }

  // Click on "Closed" filter
  try {
    const closedButton = page.locator('button:has-text("Closed")');
    if ((await closedButton.count()) > 0) {
      await closedButton.click();
      await page.waitForTimeout(2000);
    } else {
      console.log(`  No "Closed" filter found`);
      return [];
    }
  } catch (e) {
    console.log(`  Could not click Closed filter: ${e}`);
    return [];
  }

  const scrapedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
  let pageNum = 1;
  let allEntries: MarketPnLEntry[] = [];
  let hasMore = true;
  let lastCount = 0;

  while (hasMore && pageNum <= 20) {
    // Safety limit: 20 pages max
    console.log(`  Scraping page ${pageNum}...`);

    // Use page.evaluate to extract data from DOM
    const pageEntries = await page.evaluate(
      (args: { wallet: string; scrapedAt: string; benchmarkSet: string }) => {
        const results: any[] = [];
        const links = document.querySelectorAll('a[href*="/event/"]');
        const processedSlugs = new Set<string>();

        links.forEach((link) => {
          const href = link.getAttribute('href');
          const slugMatch = href?.match(/\/event\/([^/?]+)/);
          if (!slugMatch) return;

          const slug = slugMatch[1];
          if (processedSlugs.has(slug)) return;
          processedSlugs.add(slug);

          // Navigate up to find the row container with dollar values
          let row = link.parentElement;
          for (let i = 0; i < 15 && row; i++) {
            const text = row.textContent || '';
            // Look for a row with multiple dollar values
            const dollarMatches = text.match(/\$[\d,]+(?:\.\d+)?/g);
            if (dollarMatches && dollarMatches.length >= 2) {
              break;
            }
            row = row.parentElement;
          }

          if (!row) return;

          const rowText = row.textContent || '';

          // Extract market title from the link or nearby text
          // The market title is usually the question text before "Won/Lost"
          const titleMatch = rowText.match(/^(.*?)(?:circle check|Won|Lost)/i);
          const marketTitle = titleMatch ? titleMatch[1].trim() : slug;

          // Determine result (Won/Lost)
          let result = 'unknown';
          if (rowText.toLowerCase().includes('won') || rowText.includes('circle check')) {
            result = 'won';
          } else if (rowText.toLowerCase().includes('lost')) {
            result = 'lost';
          }

          // Parse shares and price: "13,175,255.2 Yes at 37¢"
          const sharesMatch = rowText.match(/([\d,]+(?:\.\d+)?)\s+(Yes|No|Republican|Democrat)\s+at\s+([\d.]+)¢/i);
          let shares = 0;
          let avgPrice = 0;
          let outcomeLabel = 'unknown';

          if (sharesMatch) {
            shares = parseFloat(sharesMatch[1].replace(/,/g, ''));
            outcomeLabel = sharesMatch[2];
            avgPrice = parseFloat(sharesMatch[3]) / 100; // Convert cents to decimal
          }

          // Get dollar values - based on UI structure:
          // First value is Amount Won, second value (with percentage) is PnL
          const dollarValues = rowText.match(/\$[\d,]+(?:\.\d+)?/g) || [];

          // Parse PnL with percentage: "$8,303,171.23 (170.38%)"
          const pnlMatch = rowText.match(/\$([\d,]+(?:\.\d+)?)\s*\(([+-]?[\d.]+)%\)/);

          let amountWon = 0;
          let pnl = 0;
          let pnlPct = 0;
          let totalBet = 0;

          if (pnlMatch) {
            pnl = parseFloat(pnlMatch[1].replace(/,/g, ''));
            pnlPct = parseFloat(pnlMatch[2]);

            // Check if PnL is negative (Lost position)
            if (result === 'lost' || rowText.includes('-$') || pnlPct < 0) {
              pnl = -Math.abs(pnl);
            }
          }

          if (dollarValues.length >= 1) {
            // First dollar value is Amount Won
            amountWon = parseFloat(dollarValues[0].replace(/[$,]/g, ''));

            // Total Bet = Amount Won - PnL
            totalBet = amountWon - pnl;
          }

          results.push({
            wallet: args.wallet.toLowerCase(),
            market_slug: slug,
            market_title: marketTitle.substring(0, 200),
            result,
            outcome_label: outcomeLabel,
            shares,
            avg_price: avgPrice,
            total_bet: totalBet,
            amount_won: amountWon,
            pnl,
            pnl_pct: pnlPct,
            scraped_at: args.scrapedAt,
            benchmark_set: args.benchmarkSet,
          });
        });

        return results;
      },
      { wallet, scrapedAt, benchmarkSet }
    );

    // Merge with existing entries (avoid duplicates)
    const existingSlugs = new Set(allEntries.map((e) => e.market_slug));
    for (const entry of pageEntries) {
      if (!existingSlugs.has(entry.market_slug)) {
        allEntries.push(entry as MarketPnLEntry);
        existingSlugs.add(entry.market_slug);
      }
    }

    // Check if we got new entries
    if (allEntries.length === lastCount) {
      hasMore = false;
    } else {
      lastCount = allEntries.length;

      // Try to load more by scrolling
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        pageNum++;
      } catch (e) {
        hasMore = false;
      }
    }
  }

  return allEntries;
}

async function saveToClickHouse(entries: MarketPnLEntry[]): Promise<void> {
  if (entries.length === 0) return;

  await clickhouse.insert({
    table: 'pm_ui_pnl_by_market_v1',
    values: entries,
    format: 'JSONEachRow',
  });

  console.log(`  Saved ${entries.length} market entries to ClickHouse`);
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let benchmarkSet = 'fresh_2025_12_04_alltime';
  let singleWallet: string | null = null;
  let limit: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set' && args[i + 1]) {
      benchmarkSet = args[i + 1];
      i++;
    } else if (args[i] === '--wallet' && args[i + 1]) {
      singleWallet = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    }
  }

  console.log('='.repeat(100));
  console.log('PER-MARKET PnL BENCHMARK SCRAPER');
  console.log('='.repeat(100));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Benchmark Set: ${benchmarkSet}`);
  if (singleWallet) console.log(`Single Wallet: ${singleWallet}`);
  if (limit) console.log(`Limit: ${limit} wallets`);
  console.log('');

  // Ensure table exists
  await ensureTableExists();

  // Load benchmark wallets
  let wallets: BenchmarkWallet[];

  if (singleWallet) {
    wallets = [{ wallet: singleWallet, pnl_value: 0, note: 'manual' }];
  } else {
    wallets = await loadBenchmarkWallets(benchmarkSet);
    if (limit) {
      wallets = wallets.slice(0, limit);
    }
  }

  console.log(`Loaded ${wallets.length} wallets to scrape`);
  console.log('');

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  let totalMarkets = 0;
  let successfulWallets = 0;
  let failedWallets = 0;

  try {
    for (let i = 0; i < wallets.length; i++) {
      const { wallet, note } = wallets[i];
      console.log(`\n[${i + 1}/${wallets.length}] ${wallet.substring(0, 14)}... (${note})`);

      try {
        const entries = await scrapeClosedPositions(page, wallet, benchmarkSet);

        if (entries.length > 0) {
          await saveToClickHouse(entries);
          totalMarkets += entries.length;
          successfulWallets++;

          // Show top 3 markets by PnL
          const sorted = [...entries].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
          console.log(`  Top markets by PnL magnitude:`);
          for (const e of sorted.slice(0, 3)) {
            const sign = e.pnl >= 0 ? '+' : '';
            console.log(`    ${sign}$${e.pnl.toLocaleString()} | ${e.market_title.substring(0, 50)}...`);
          }
        } else {
          console.log(`  No closed positions found`);
          failedWallets++;
        }

        // Rate limiting between wallets
        await page.waitForTimeout(2000);
      } catch (err: any) {
        console.log(`  ERROR: ${err.message}`);
        failedWallets++;
      }
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n');
  console.log('='.repeat(100));
  console.log('SCRAPING SUMMARY');
  console.log('='.repeat(100));
  console.log(`Total wallets processed: ${wallets.length}`);
  console.log(`Successful:              ${successfulWallets}`);
  console.log(`Failed/Empty:            ${failedWallets}`);
  console.log(`Total market entries:    ${totalMarkets}`);
  console.log(`Benchmark set:           ${benchmarkSet}`);
  console.log('');

  // Verify data in ClickHouse
  const verifyQuery = `
    SELECT
      count() as total_entries,
      uniq(wallet) as unique_wallets,
      uniq(market_slug) as unique_markets,
      sum(pnl) as total_pnl,
      countIf(result = 'won') as wins,
      countIf(result = 'lost') as losses
    FROM pm_ui_pnl_by_market_v1
    WHERE benchmark_set = '${benchmarkSet}'
  `;

  const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
  const stats = (await verifyResult.json()) as any[];

  if (stats.length > 0) {
    console.log('ClickHouse Stats:');
    console.log(`  Total entries:   ${stats[0].total_entries}`);
    console.log(`  Unique wallets:  ${stats[0].unique_wallets}`);
    console.log(`  Unique markets:  ${stats[0].unique_markets}`);
    console.log(`  Total PnL:       $${Number(stats[0].total_pnl).toLocaleString()}`);
    console.log(`  Wins/Losses:     ${stats[0].wins}/${stats[0].losses}`);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('SCRAPING COMPLETE');
  console.log('='.repeat(100));
}

main().catch(console.error);
