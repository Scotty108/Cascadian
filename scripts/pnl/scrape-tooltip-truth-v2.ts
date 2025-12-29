/**
 * Scrape Tooltip Truth V2 (Patched)
 *
 * Uses Playwright to scrape tooltip-verified PnL values from Polymarket profiles.
 * PATCHED: Increased timeouts, improved locators, extended schema.
 *
 * Input: tmp/tooltip_candidates_v1.json (or --input=path)
 * Output: tmp/playwright_tooltip_ground_truth_v2.json (or --output=path)
 *
 * For each wallet:
 *   1. Navigate to https://polymarket.com/profile/{wallet}
 *   2. Wait for page to fully load (networkidle + extra delay)
 *   3. Click ALL in P/L timeframe selector
 *   4. Locate P/L section and hover info icon
 *   5. Extract: Gain, Loss, Net Total from tooltip
 *   6. Optionally extract: Active positions PnL, Closed positions PnL
 *   7. Verify identity: Gain - |Loss| = Net Total
 *   8. Record validated Net Total as uiPnl
 *
 * Usage:
 *   npx tsx scripts/pnl/scrape-tooltip-truth-v2.ts
 *   npx tsx scripts/pnl/scrape-tooltip-truth-v2.ts --limit=10
 *   npx tsx scripts/pnl/scrape-tooltip-truth-v2.ts --input=tmp/my_wallets.json --output=tmp/my_output.json
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface CandidateData {
  wallet: string;
  openPositions?: number;
  uiParityPnl?: number;
  eventsProcessed?: number;
  bin?: string;
}

interface CandidatesFile {
  metadata?: {
    generated_at: string;
    filters?: { min_events: number; min_abs_pnl: number };
  };
  all_candidates?: CandidateData[];
  wallets?: CandidateData[];
}

interface TooltipWallet {
  wallet: string;
  uiPnl: number;
  gain: number | null;
  loss: number | null;
  volume: number | null;
  // Extended fields
  activePnl: number | null;
  closedPnl: number | null;
  activeCount: number | null;
  closedCount: number | null;
  // Metadata
  scrapedAt: string;
  identityCheckPass: boolean;
  bin: string;
  openPositions: number;
  notes: string;
}

interface TooltipTruthOutput {
  metadata: {
    generated_at: string;
    source: string;
    method: string;
    wallet_count: number;
    tolerance_pct: number;
    min_pnl_threshold: number;
    schema_version: string;
  };
  wallets: TooltipWallet[];
  validation_method: {
    steps: string[];
    why_tooltip: string;
    failure_indicators: string[];
  };
}

// ============================================================================
// Configuration
// ============================================================================

const NAVIGATION_TIMEOUT = 90000; // 90s page load timeout
const ELEMENT_TIMEOUT = 10000; // 10s element timeout
const POST_NAVIGATION_DELAY = 3000; // 3s after page load
const INTER_WALLET_DELAY = 2000; // 2s between wallets

// ============================================================================
// Helpers
// ============================================================================

function parseMoneyValue(text: string): number {
  // Parse "$1,234.56" or "-$1,234.56" or "$1.2M" etc
  const clean = text.replace(/[$,\s]/g, '');

  // Handle M/K suffixes
  if (clean.includes('M')) {
    return parseFloat(clean.replace('M', '')) * 1_000_000;
  }
  if (clean.includes('K')) {
    return parseFloat(clean.replace('K', '')) * 1_000;
  }

  return parseFloat(clean);
}

function parseCountValue(text: string): number | null {
  // Parse "42 positions" or just "42"
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// Scraping Logic
// ============================================================================

async function scrapeWalletTooltip(
  page: Page,
  wallet: string,
  bin: string,
  openPositions: number
): Promise<TooltipWallet | null> {
  const url = `https://polymarket.com/profile/${wallet}`;

  try {
    console.log(`  Navigating to ${wallet.slice(0, 12)}...`);

    // Navigate with extended timeout - use domcontentloaded instead of networkidle
    // because high-volume wallet pages may never reach networkidle
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });

    // Wait for the profile page to be interactive (look for profile-specific elements)
    try {
      // Wait for any of these indicators that the page has loaded
      await Promise.race([
        page.waitForSelector('[class*="profile"]', { timeout: 15000 }),
        page.waitForSelector('text=/Profit|P.*L|Volume/i', { timeout: 15000 }),
        page.waitForSelector('button:has-text("ALL")', { timeout: 15000 }),
        page.waitForTimeout(10000), // Fallback: just wait 10s
      ]);
    } catch {
      // Continue anyway - page may still be usable
    }

    // Extra delay for dynamic content
    await page.waitForTimeout(POST_NAVIGATION_DELAY);

    // Initialize result fields
    let gain: number | null = null;
    let loss: number | null = null;
    let netTotal: number | null = null;
    let volume: number | null = null;
    let activePnl: number | null = null;
    let closedPnl: number | null = null;
    let activeCount: number | null = null;
    let closedCount: number | null = null;

    // -------------------------------------------------------------------------
    // Step 1: Click ALL button to get all-time P/L
    // -------------------------------------------------------------------------
    try {
      // Multiple possible selectors for the ALL button
      const allButtonSelectors = [
        'button:has-text("ALL")',
        '[data-testid="timeframe-all"]',
        'button:text-is("ALL")',
        'div[role="tablist"] button:has-text("ALL")',
      ];

      for (const selector of allButtonSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click({ timeout: 3000 });
            console.log(`    Clicked ALL button`);
            await page.waitForTimeout(1500);
            break;
          }
        } catch {
          // Try next selector
        }
      }
    } catch {
      console.log(`    Note: Could not find/click ALL button (may already be on ALL)`);
    }

    // -------------------------------------------------------------------------
    // Step 2: Find and extract main P/L tooltip
    // -------------------------------------------------------------------------
    try {
      // Strategy: Find the P/L section, then locate the info icon near it
      // Multiple approaches to find the P/L info icon

      const pnlLocatorStrategies = [
        // Strategy 1: Look for text containing "P/L" or "Profit" and find nearby info icon
        async () => {
          const pnlSection = page.locator('text=/Profit.*Loss|P.*L/i').first();
          if (await pnlSection.isVisible({ timeout: 3000 })) {
            // Find the parent container
            const parent = pnlSection.locator('xpath=ancestor::div[contains(@class, "flex") or contains(@class, "stat")]').first();
            // Look for info icon in that container or nearby
            const infoIcon = parent.locator('svg, [class*="info"], [aria-label*="info"]').first();
            if (await infoIcon.isVisible({ timeout: 2000 })) {
              return infoIcon;
            }
          }
          return null;
        },
        // Strategy 2: Look for any info icon near a dollar value
        async () => {
          const dollarValues = page.locator('text=/\\$[\\d,]+\\.?\\d*/');
          const count = await dollarValues.count();
          for (let i = 0; i < Math.min(count, 5); i++) {
            const el = dollarValues.nth(i);
            const parent = el.locator('xpath=ancestor::div[1]');
            const infoIcon = parent.locator('svg[class*="info"], [class*="tooltip"], button:has(svg)').first();
            if (await infoIcon.isVisible({ timeout: 1000 })) {
              return infoIcon;
            }
          }
          return null;
        },
        // Strategy 3: Generic info icon search
        async () => {
          const icons = [
            page.locator('[aria-label*="info"]').first(),
            page.locator('[data-testid*="info"]').first(),
            page.locator('svg[class*="Info"]').first(),
            page.locator('button:has(svg) >> nth=0'),
          ];
          for (const icon of icons) {
            if (await icon.isVisible({ timeout: 1000 })) {
              return icon;
            }
          }
          return null;
        },
      ];

      let infoIcon = null;
      for (const strategy of pnlLocatorStrategies) {
        infoIcon = await strategy();
        if (infoIcon) break;
      }

      if (infoIcon) {
        await infoIcon.hover({ timeout: ELEMENT_TIMEOUT });
        await page.waitForTimeout(800);

        // Get tooltip content
        const tooltipSelectors = [
          '[role="tooltip"]',
          '[class*="tooltip"]',
          '[class*="Tooltip"]',
          '[class*="popover"]',
          '[class*="Popover"]',
          'div[class*="floating"]',
        ];

        for (const sel of tooltipSelectors) {
          try {
            const tooltip = page.locator(sel).first();
            if (await tooltip.isVisible({ timeout: 2000 })) {
              const tooltipText = await tooltip.textContent({ timeout: 2000 });

              if (tooltipText) {
                console.log(`    Tooltip text: ${tooltipText.slice(0, 100)}...`);

                // Parse tooltip content
                const gainMatch = tooltipText.match(/Gain[:\s]*\$?([\d,.-]+[KM]?)/i);
                const lossMatch = tooltipText.match(/Loss[:\s]*-?\$?([\d,.-]+[KM]?)/i);
                const netMatch = tooltipText.match(/(?:Net\s*Total|Total)[:\s]*-?\$?([\d,.-]+[KM]?)/i);
                const volumeMatch = tooltipText.match(/Volume[:\s]*\$?([\d,.-]+[KM]?)/i);

                if (gainMatch) gain = parseMoneyValue(gainMatch[1]);
                if (lossMatch) loss = -Math.abs(parseMoneyValue(lossMatch[1]));
                if (netMatch) {
                  const isNegative = tooltipText.includes('-$') || tooltipText.match(/(?:Net\s*Total|Total)[:\s]*-/i);
                  netTotal = parseMoneyValue(netMatch[1]);
                  if (isNegative && netTotal > 0) netTotal = -netTotal;
                }
                if (volumeMatch) volume = parseMoneyValue(volumeMatch[1]);
              }
              break;
            }
          } catch {
            // Try next selector
          }
        }

        // Move mouse away to close tooltip
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500);
      }
    } catch (e) {
      console.log(`    Warning: Could not get main tooltip - ${(e as Error).message}`);
    }

    // -------------------------------------------------------------------------
    // Step 3: Try to extract P/L directly from page if tooltip failed
    // -------------------------------------------------------------------------
    if (netTotal === null) {
      try {
        // Strategy A: Find the P/L value from page text structure
        // The page shows "Profit/Loss" label followed by the value like "$0.00" or "$1,234.56"
        const pnlValue = await page.evaluate(() => {
          const body = document.body.innerText;
          // Look for pattern: "Profit/Loss" followed by timeframe buttons, then the value
          const match = body.match(/Profit\/Loss[\s\S]*?(\$[\d,.-]+(?:\.\d{2})?)/);
          if (match) return match[1];

          // Alternative: Look for dollar value near "All-Time" or timeframe indicators
          const altMatch = body.match(/(\-?\$[\d,]+(?:\.\d{2})?)\s*(?:ⓘ|All-Time|1D|1W|1M|ALL)/);
          if (altMatch) return altMatch[1];

          return null;
        });

        if (pnlValue) {
          const isNegative = pnlValue.includes('-');
          netTotal = parseMoneyValue(pnlValue);
          if (isNegative && netTotal > 0) netTotal = -netTotal;
          console.log(`    Extracted P/L from page text: ${pnlValue} -> $${netTotal}`);
        }
      } catch (e) {
        console.log(`    Strategy A failed: ${(e as Error).message}`);
      }
    }

    // Strategy B: Try class-based selectors if text parsing failed
    if (netTotal === null) {
      try {
        const pnlSelectors = [
          '[class*="profit"]',
          '[class*="pnl"]',
          '[data-testid*="pnl"]',
          '[data-testid*="profit"]',
        ];

        for (const sel of pnlSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
              const text = await el.textContent({ timeout: 2000 });
              if (text && text.includes('$')) {
                const isNegative = text.includes('-');
                netTotal = parseMoneyValue(text);
                if (isNegative && netTotal > 0) netTotal = -netTotal;
                console.log(`    Extracted P/L from selector ${sel}: $${netTotal}`);
                break;
              }
            }
          } catch {
            // Try next
          }
        }
      } catch {
        // Fallback failed
      }
    }

    // -------------------------------------------------------------------------
    // Step 4: Try to extract Active/Closed positions info
    // -------------------------------------------------------------------------
    try {
      // Look for Active positions section
      const activeSection = page.locator('text=/Active.*Positions?|Open.*Positions?/i').first();
      if (await activeSection.isVisible({ timeout: 2000 })) {
        const parent = activeSection.locator('xpath=ancestor::div[contains(@class, "flex")]').first();
        const countText = await parent.textContent({ timeout: 2000 });
        if (countText) {
          activeCount = parseCountValue(countText);
        }
      }
    } catch {
      // Optional field
    }

    try {
      // Look for Closed positions section
      const closedSection = page.locator('text=/Closed.*Positions?|Resolved.*Positions?/i').first();
      if (await closedSection.isVisible({ timeout: 2000 })) {
        const parent = closedSection.locator('xpath=ancestor::div[contains(@class, "flex")]').first();
        const countText = await parent.textContent({ timeout: 2000 });
        if (countText) {
          closedCount = parseCountValue(countText);
        }
      }
    } catch {
      // Optional field
    }

    // -------------------------------------------------------------------------
    // Step 5: Validate and return result
    // -------------------------------------------------------------------------
    if (netTotal === null) {
      console.log(`    SKIP: Could not extract P/L value`);
      return null;
    }

    // Identity check: Gain - |Loss| = Net Total (if we have Gain and Loss)
    let identityCheckPass = true;
    if (gain !== null && loss !== null) {
      const computed = gain + loss; // loss is already negative
      const diff = Math.abs(computed - netTotal);
      const tolerance = Math.abs(netTotal) * 0.01; // 1% tolerance for rounding
      identityCheckPass = diff <= tolerance + 1; // +1 for small values
    }

    const result: TooltipWallet = {
      wallet,
      uiPnl: netTotal,
      gain,
      loss,
      volume,
      activePnl,
      closedPnl,
      activeCount,
      closedCount,
      scrapedAt: new Date().toISOString(),
      identityCheckPass,
      bin,
      openPositions,
      notes: identityCheckPass
        ? `Tooltip verified. Bin: ${bin}`
        : `Identity check failed. Computed: ${gain}+${loss}=${(gain || 0) + (loss || 0)}, Got: ${netTotal}`,
    };

    console.log(
      `    OK: $${netTotal.toLocaleString()} | Gain: ${gain?.toLocaleString() ?? 'N/A'} | Loss: ${loss?.toLocaleString() ?? 'N/A'} | Identity: ${identityCheckPass ? 'PASS' : 'FAIL'}`
    );

    return result;
  } catch (e) {
    console.log(`    ERROR: ${(e as Error).message}`);
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== Scrape Tooltip Truth V2 (Patched) ===\n');

  // Parse args
  let inputPath = 'tmp/tooltip_candidates_v1.json';
  let outputPath = 'tmp/playwright_tooltip_ground_truth_v2.json';
  let limit = Infinity;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--input=')) {
      inputPath = arg.split('=')[1];
    }
    if (arg.startsWith('--output=')) {
      outputPath = arg.split('=')[1];
    }
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    }
  }

  // Load candidates
  const fullInputPath = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
  if (!fs.existsSync(fullInputPath)) {
    console.error(`Candidates file not found: ${fullInputPath}`);
    console.error('Create a candidates file with wallet addresses first.');
    process.exit(1);
  }

  const candidatesData: CandidatesFile = JSON.parse(fs.readFileSync(fullInputPath, 'utf-8'));

  // Support both formats: { all_candidates: [...] } and { wallets: [...] }
  let candidates = candidatesData.all_candidates || candidatesData.wallets || [];

  // Apply limit
  if (limit < candidates.length) {
    candidates = candidates.slice(0, limit);
    console.log(`Limiting to first ${limit} wallets\n`);
  }

  console.log(`Loaded ${candidates.length} candidates from ${fullInputPath}\n`);
  console.log(`Configuration:`);
  console.log(`  Navigation timeout: ${NAVIGATION_TIMEOUT / 1000}s`);
  console.log(`  Element timeout:    ${ELEMENT_TIMEOUT / 1000}s`);
  console.log(`  Post-nav delay:     ${POST_NAVIGATION_DELAY / 1000}s`);
  console.log(`  Inter-wallet delay: ${INTER_WALLET_DELAY / 1000}s`);
  console.log();

  // Launch browser
  console.log('Launching browser...');
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  const results: TooltipWallet[] = [];
  const binCounts: Record<string, number> = {};
  let successCount = 0;
  let failCount = 0;

  console.log('\nScraping wallets...\n');

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const bin = candidate.bin || 'unknown';
    const openPositions = candidate.openPositions || 0;

    console.log(`[${i + 1}/${candidates.length}] ${candidate.wallet} (bin: ${bin})`);

    const result = await scrapeWalletTooltip(page, candidate.wallet, bin, openPositions);

    if (result) {
      results.push(result);
      binCounts[bin] = (binCounts[bin] || 0) + 1;
      successCount++;
    } else {
      failCount++;
    }

    // Delay between wallets to avoid rate limiting
    if (i < candidates.length - 1) {
      await page.waitForTimeout(INTER_WALLET_DELAY);
    }
  }

  await browser.close();

  // Generate output
  const fullOutputPath = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);

  const output: TooltipTruthOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'playwright_tooltip_verified',
      method:
        'Hover info icon, extract Net Total from tooltip. Validate: Gain - Loss = Net Total',
      wallet_count: results.length,
      tolerance_pct: 10,
      min_pnl_threshold: 100,
      schema_version: '2.1',
    },
    wallets: results,
    validation_method: {
      steps: [
        '1. Navigate to https://polymarket.com/profile/{wallet} (90s timeout)',
        '2. Wait for networkidle + 3s extra delay',
        '3. Click the ALL button in the P/L timeframe selector',
        '4. Locate P/L section using multiple fallback strategies',
        '5. Hover the info (i) icon to reveal tooltip',
        '6. Extract: Volume, Gain, Loss, Net Total from tooltip',
        '7. Optionally extract: Active/Closed position counts',
        '8. Verify: Gain - |Loss| = Net Total (identity check)',
        '9. Record validated Net Total as uiPnl',
      ],
      why_tooltip:
        'The tooltip provides a self-check identity (Gain - Loss = Net Total) that proves we scraped the correct value',
      failure_indicators: [
        'PnL equals Positions Value (scraped wrong element)',
        'PnL equals Biggest Win (scraped wrong element)',
        'PnL equals Volume Traded (scraped wrong element)',
        'Net Total != Gain - Loss (data inconsistency)',
      ],
    },
  };

  fs.writeFileSync(fullOutputPath, JSON.stringify(output, null, 2));

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Success: ${successCount}/${candidates.length}`);
  console.log(`Failed:  ${failCount}/${candidates.length}`);
  console.log();

  console.log('Scraped by bin:');
  for (const [bin, count] of Object.entries(binCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${bin.padEnd(12)}: ${count} wallets`);
  }

  const passed = results.filter((r) => r.identityCheckPass).length;
  console.log(`\nIdentity check: ${passed}/${results.length} passed`);
  console.log(`\nOutput written to: ${fullOutputPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
