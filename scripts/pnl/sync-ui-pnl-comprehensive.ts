/**
 * Comprehensive Per-Market PnL Benchmark Scraper (V2)
 *
 * Scrapes BOTH Closed AND Active positions from Polymarket UI.
 * This captures the full picture of a wallet's PnL including unrealized gains/losses.
 *
 * Output: pm_ui_pnl_by_market_v2 ClickHouse table
 *
 * Improvements over v1:
 * - Scrapes both "Closed" (realized) and "Active" (unrealized) positions
 * - Dynamic scroll depth (default 100 pages, or until no new data for 5 consecutive scrolls)
 * - Better parsing for diverse market formats
 * - Captures position_type (closed/active)
 * - V3: Deep scraper with aggressive scrolling to capture Missing Millions
 *
 * Usage:
 *   npx tsx scripts/pnl/sync-ui-pnl-comprehensive.ts
 *   npx tsx scripts/pnl/sync-ui-pnl-comprehensive.ts --wallet 0x123...
 *   npx tsx scripts/pnl/sync-ui-pnl-comprehensive.ts --limit 5
 *   npx tsx scripts/pnl/sync-ui-pnl-comprehensive.ts --set fresh_2025_12_04_alltime
 *   npx tsx scripts/pnl/sync-ui-pnl-comprehensive.ts --scroll-depth 30
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
  position_type: 'closed' | 'active';
  result: 'won' | 'lost' | 'pending' | 'unknown';
  outcome_label: string;
  shares: number;
  avg_price: number;
  current_price: number;
  total_bet: number;
  amount_won: number;
  current_value: number;
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
    CREATE TABLE IF NOT EXISTS pm_ui_pnl_by_market_v2 (
      wallet String,
      market_slug String,
      market_title String,
      position_type String,
      result String,
      outcome_label String,
      shares Float64,
      avg_price Float64,
      current_price Float64,
      total_bet Float64,
      amount_won Float64,
      current_value Float64,
      pnl Float64,
      pnl_pct Float64,
      scraped_at DateTime,
      benchmark_set String
    ) ENGINE = ReplacingMergeTree()
    ORDER BY (wallet, market_slug, position_type, benchmark_set)
    SETTINGS index_granularity = 8192
  `;

  await clickhouse.command({ query: createTableQuery });
  console.log('Table pm_ui_pnl_by_market_v2 ready');
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

async function scrapePositions(
  page: Page,
  wallet: string,
  benchmarkSet: string,
  positionType: 'closed' | 'active',
  scrollDepth: number
): Promise<MarketPnLEntry[]> {
  const url = `https://polymarket.com/profile/${wallet}`;

  // Only navigate if we're on a different page
  if (!page.url().includes(wallet)) {
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

  // Click on the appropriate filter (Closed or Active)
  const filterButtonText = positionType === 'closed' ? 'Closed' : 'Active';
  try {
    const filterButton = page.locator(`button:has-text("${filterButtonText}")`);
    if ((await filterButton.count()) > 0) {
      await filterButton.click();
      await page.waitForTimeout(2000);
    } else {
      console.log(`  No "${filterButtonText}" filter found`);
      return [];
    }
  } catch (e) {
    console.log(`  Could not click ${filterButtonText} filter: ${e}`);
    return [];
  }

  const scrapedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
  let pageNum = 1;
  let allEntries: MarketPnLEntry[] = [];
  let hasMore = true;
  let lastCount = 0;
  let noNewDataCount = 0;

  while (hasMore && pageNum <= scrollDepth) {
    console.log(`  Scraping ${positionType} page ${pageNum}...`);

    // Use page.evaluate to extract data from DOM
    const pageEntries = await page.evaluate(
      (args: { wallet: string; scrapedAt: string; benchmarkSet: string; positionType: string }) => {
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
            // Look for a row with multiple dollar values or percentage
            const dollarMatches = text.match(/\$[\d,]+(?:\.\d+)?/g);
            const hasPercentage = text.includes('%');
            if ((dollarMatches && dollarMatches.length >= 2) || hasPercentage) {
              break;
            }
            row = row.parentElement;
          }

          if (!row) return;

          const rowText = row.textContent || '';

          // Extract market title from the link text
          const linkText = link.textContent?.trim() || '';
          const marketTitle = linkText || slug;

          // Determine result (Won/Lost/Pending)
          let result = 'unknown';
          if (args.positionType === 'closed') {
            if (rowText.toLowerCase().includes('won') || rowText.includes('circle check')) {
              result = 'won';
            } else if (rowText.toLowerCase().includes('lost')) {
              result = 'lost';
            }
          } else {
            result = 'pending'; // Active positions are pending
          }

          // Parse shares and price: "13,175,255.2 Yes at 37¢" or "120,469.4 Republican 63¢ avg"
          const sharesMatch = rowText.match(/([\d,]+(?:\.\d+)?)\s+(Yes|No|Republican|Democrat|[\w]+)\s+(?:at\s+)?([\d.]+)¢/i);
          let shares = 0;
          let avgPrice = 0;
          let outcomeLabel = 'unknown';

          if (sharesMatch) {
            shares = parseFloat(sharesMatch[1].replace(/,/g, ''));
            outcomeLabel = sharesMatch[2];
            avgPrice = parseFloat(sharesMatch[3]) / 100; // Convert cents to decimal
          }

          // For active positions, try to find current price
          let currentPrice = 0;
          const currentPriceMatch = rowText.match(/(\d+)¢\s+avg/i) || rowText.match(/(\d+)¢/);
          if (currentPriceMatch) {
            currentPrice = parseFloat(currentPriceMatch[1]) / 100;
          }

          // Get dollar values
          const dollarValues = rowText.match(/\$[\d,]+(?:\.\d+)?/g) || [];

          // Parse PnL with percentage: "$8,303,171.23 (170.38%)" or "+$123.45 (+12.3%)"
          const pnlMatch = rowText.match(/([+-])?\$([\d,]+(?:\.\d+)?)\s*\(([+-]?[\d.]+)%\)/);

          let amountWon = 0;
          let currentValue = 0;
          let pnl = 0;
          let pnlPct = 0;
          let totalBet = 0;

          if (pnlMatch) {
            const sign = pnlMatch[1] === '-' ? -1 : 1;
            pnl = sign * parseFloat(pnlMatch[2].replace(/,/g, ''));
            pnlPct = parseFloat(pnlMatch[3]);
          }

          if (args.positionType === 'closed') {
            // For closed positions: first dollar value is Amount Won
            if (dollarValues.length >= 1) {
              amountWon = parseFloat(dollarValues[0].replace(/[$,]/g, ''));
              totalBet = amountWon - pnl;
            }
          } else {
            // For active positions: look for current value and invested
            // Typical format: "$123.45 Current Value" and "$100.00 Invested"
            if (dollarValues.length >= 1) {
              currentValue = parseFloat(dollarValues[0].replace(/[$,]/g, ''));
            }
            if (dollarValues.length >= 2) {
              // Second dollar might be invested amount
              const secondVal = parseFloat(dollarValues[1].replace(/[$,]/g, ''));
              // If second value is smaller, it's probably invested
              if (secondVal < currentValue) {
                totalBet = secondVal;
              } else {
                totalBet = currentValue - pnl;
              }
            } else {
              totalBet = currentValue - pnl;
            }
          }

          results.push({
            wallet: args.wallet.toLowerCase(),
            market_slug: slug,
            market_title: marketTitle.substring(0, 200),
            position_type: args.positionType,
            result,
            outcome_label: outcomeLabel,
            shares,
            avg_price: avgPrice,
            current_price: currentPrice,
            total_bet: totalBet,
            amount_won: amountWon,
            current_value: currentValue,
            pnl,
            pnl_pct: pnlPct,
            scraped_at: args.scrapedAt,
            benchmark_set: args.benchmarkSet,
          });
        });

        return results;
      },
      { wallet, scrapedAt, benchmarkSet, positionType }
    );

    // Merge with existing entries (avoid duplicates)
    const existingSlugs = new Set(allEntries.map((e) => e.market_slug));
    let newEntriesThisPage = 0;
    for (const entry of pageEntries) {
      if (!existingSlugs.has(entry.market_slug)) {
        allEntries.push(entry as MarketPnLEntry);
        existingSlugs.add(entry.market_slug);
        newEntriesThisPage++;
      }
    }

    // Check if we got new entries
    if (allEntries.length === lastCount) {
      noNewDataCount++;
      if (noNewDataCount >= 5) {
        // Stop after 5 consecutive pages with no new data (aggressive)
        hasMore = false;
      }
    } else {
      lastCount = allEntries.length;
      noNewDataCount = 0;

      // Try to load more by scrolling
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
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
    table: 'pm_ui_pnl_by_market_v2',
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
  let scrollDepth = 100; // Default to 100 pages - aggressive deep scrape

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
    } else if (args[i] === '--scroll-depth' && args[i + 1]) {
      scrollDepth = parseInt(args[i + 1]);
      i++;
    }
  }

  console.log('='.repeat(100));
  console.log('COMPREHENSIVE PER-MARKET PnL SCRAPER (V2)');
  console.log('='.repeat(100));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Benchmark Set: ${benchmarkSet}`);
  console.log(`Scroll Depth: ${scrollDepth} pages per filter`);
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

  let totalClosedMarkets = 0;
  let totalActiveMarkets = 0;
  let successfulWallets = 0;
  let failedWallets = 0;

  try {
    for (let i = 0; i < wallets.length; i++) {
      const { wallet, note } = wallets[i];
      console.log(`\n[${i + 1}/${wallets.length}] ${wallet.substring(0, 14)}... (${note})`);

      try {
        // Scrape CLOSED positions first
        console.log(`  --- CLOSED POSITIONS ---`);
        const closedEntries = await scrapePositions(page, wallet, benchmarkSet, 'closed', scrollDepth);

        if (closedEntries.length > 0) {
          await saveToClickHouse(closedEntries);
          totalClosedMarkets += closedEntries.length;

          // Show top 3 by PnL
          const sortedClosed = [...closedEntries].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
          console.log(`  Top closed markets (${closedEntries.length} total):`);
          for (const e of sortedClosed.slice(0, 3)) {
            const sign = e.pnl >= 0 ? '+' : '';
            console.log(`    ${sign}$${e.pnl.toLocaleString()} | ${e.market_title.substring(0, 50)}...`);
          }
        } else {
          console.log(`  No closed positions found`);
        }

        // Scrape ACTIVE positions
        console.log(`  --- ACTIVE POSITIONS ---`);
        const activeEntries = await scrapePositions(page, wallet, benchmarkSet, 'active', scrollDepth);

        if (activeEntries.length > 0) {
          await saveToClickHouse(activeEntries);
          totalActiveMarkets += activeEntries.length;

          // Show top 3 by value
          const sortedActive = [...activeEntries].sort((a, b) => Math.abs(b.current_value) - Math.abs(a.current_value));
          console.log(`  Top active positions (${activeEntries.length} total):`);
          for (const e of sortedActive.slice(0, 3)) {
            console.log(`    $${e.current_value.toLocaleString()} | ${e.market_title.substring(0, 50)}...`);
          }
        } else {
          console.log(`  No active positions found`);
        }

        if (closedEntries.length > 0 || activeEntries.length > 0) {
          successfulWallets++;
        } else {
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
  console.log(`Total CLOSED markets:    ${totalClosedMarkets}`);
  console.log(`Total ACTIVE markets:    ${totalActiveMarkets}`);
  console.log(`Total all markets:       ${totalClosedMarkets + totalActiveMarkets}`);
  console.log(`Benchmark set:           ${benchmarkSet}`);
  console.log('');

  // Verify data in ClickHouse
  const verifyQuery = `
    SELECT
      position_type,
      count() as total_entries,
      uniq(wallet) as unique_wallets,
      uniq(market_slug) as unique_markets,
      sum(pnl) as total_pnl,
      sum(current_value) as total_value
    FROM pm_ui_pnl_by_market_v2
    WHERE benchmark_set = '${benchmarkSet}'
    GROUP BY position_type
    ORDER BY position_type
  `;

  const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
  const stats = (await verifyResult.json()) as any[];

  console.log('ClickHouse Stats by Position Type:');
  for (const s of stats) {
    console.log(`  ${s.position_type.toUpperCase()}:`);
    console.log(`    Entries:       ${s.total_entries}`);
    console.log(`    Wallets:       ${s.unique_wallets}`);
    console.log(`    Markets:       ${s.unique_markets}`);
    console.log(`    Total PnL:     $${Number(s.total_pnl).toLocaleString()}`);
    console.log(`    Total Value:   $${Number(s.total_value).toLocaleString()}`);
  }

  // Calculate gap
  const gapQuery = `
    SELECT
      sum(pnl) as scraped_pnl,
      (SELECT sum(pnl_value) FROM pm_ui_pnl_benchmarks_v1 WHERE benchmark_set = '${benchmarkSet}') as ui_total_pnl
    FROM pm_ui_pnl_by_market_v2
    WHERE benchmark_set = '${benchmarkSet}'
  `;

  const gapResult = await clickhouse.query({ query: gapQuery, format: 'JSONEachRow' });
  const gap = (await gapResult.json()) as any[];

  if (gap.length > 0) {
    const scrapedPnl = Number(gap[0].scraped_pnl);
    const uiTotalPnl = Number(gap[0].ui_total_pnl);
    const gapValue = uiTotalPnl - scrapedPnl;
    const gapPct = uiTotalPnl !== 0 ? ((gapValue / uiTotalPnl) * 100).toFixed(1) : 'N/A';

    console.log('');
    console.log('GAP ANALYSIS:');
    console.log(`  UI Total PnL:      $${uiTotalPnl.toLocaleString()}`);
    console.log(`  Scraped PnL:       $${scrapedPnl.toLocaleString()}`);
    console.log(`  Gap (unmapped):    $${gapValue.toLocaleString()} (${gapPct}%)`);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('COMPREHENSIVE SCRAPING COMPLETE');
  console.log('='.repeat(100));
}

main().catch(console.error);
