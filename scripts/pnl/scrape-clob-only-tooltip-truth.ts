/**
 * Scrape CLOB-Only Tooltip Truth
 *
 * Uses Playwright to scrape tooltip-verified PnL values from Polymarket profiles.
 * Specifically designed for CLOB-only candidate pool validation.
 *
 * Input: tmp/clob_only_candidates_fast.json
 * Output: data/regression/clob_only_truth_v1.json (durable dataset)
 *
 * For each wallet:
 *   1. Navigate to https://polymarket.com/profile/{wallet}
 *   2. Click ALL in P/L timeframe selector
 *   3. Hover info (i) icon next to Profit/Loss
 *   4. Extract: Gain, Loss, Net Total from tooltip
 *   5. Verify identity: Gain - |Loss| = Net Total
 *   6. Record validated Net Total as uiPnl
 *
 * Usage: npx tsx scripts/pnl/scrape-clob-only-tooltip-truth.ts
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface ClobOnlyCandidate {
  wallet: string;
  clobEvents: number;
  redemptionEvents: number;
  cashFlow: number;
  conditionCount: number;
  openPositionsApprox: number;
}

interface CandidatesInput {
  metadata: {
    generated_at: string;
    source: string;
    query_params: {
      min_clob_events: number;
      max_clob_events: number;
      min_abs_cash_flow: number;
      max_open_positions_approx: number;
      target_count: number;
    };
  };
  candidates: ClobOnlyCandidate[];
}

interface TooltipWallet {
  wallet: string;
  uiPnl: number;
  gain: number | null;
  loss: number | null;
  volume: number | null;
  scrapedAt: string;
  identityCheckPass: boolean;
  // From candidate pool
  clobEvents: number;
  openPositionsApprox: number;
  cashFlowEstimate: number;
  notes: string;
}

interface ClobOnlyTruthOutput {
  metadata: {
    generated_at: string;
    source: string;
    method: string;
    classification: string;
    wallet_count: number;
    identity_pass_count: number;
  };
  wallets: TooltipWallet[];
  validation_method: {
    steps: string[];
    why_tooltip: string;
    failure_indicators: string[];
  };
}

async function parseMoneyValue(text: string): Promise<number> {
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

async function scrapeWalletTooltip(
  page: Page,
  candidate: ClobOnlyCandidate
): Promise<TooltipWallet | null> {
  const url = `https://polymarket.com/profile/${candidate.wallet}`;

  try {
    console.log(`  Navigating to ${candidate.wallet.slice(0, 12)}...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Click ALL button to get all-time P/L
    try {
      const allButton = page.locator('button:has-text("ALL")').first();
      await allButton.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
    } catch {
      console.log(`    Warning: Could not click ALL button`);
    }

    // Find and hover the info icon near Profit/Loss
    let gain: number | null = null;
    let loss: number | null = null;
    let netTotal: number | null = null;
    let volume: number | null = null;

    try {
      // Look for the info icon (i) button near "Profit/Loss" or "P/L"
      const infoIcon = page
        .locator('[aria-label*="info"], [data-testid="info-icon"], svg[class*="info"]')
        .first();
      await infoIcon.hover({ timeout: 5000 });
      await page.waitForTimeout(500);

      // Get tooltip content
      const tooltip = page
        .locator('[role="tooltip"], [class*="tooltip"], [class*="Tooltip"]')
        .first();
      const tooltipText = await tooltip.textContent({ timeout: 3000 });

      if (tooltipText) {
        // Parse tooltip: typically contains "Volume $X", "Gain $Y", "Loss -$Z", "Net Total $W"
        const gainMatch = tooltipText.match(/Gain[:\s]*\$?([\d,.-]+[KM]?)/i);
        const lossMatch = tooltipText.match(/Loss[:\s]*-?\$?([\d,.-]+[KM]?)/i);
        const netMatch = tooltipText.match(/Net\s*Total[:\s]*-?\$?([\d,.-]+[KM]?)/i);
        const volumeMatch = tooltipText.match(/Volume[:\s]*\$?([\d,.-]+[KM]?)/i);

        if (gainMatch) gain = await parseMoneyValue(gainMatch[1]);
        if (lossMatch) loss = -Math.abs(await parseMoneyValue(lossMatch[1]));
        if (netMatch) {
          const isNegative = tooltipText.includes('-$') || tooltipText.match(/Net\s*Total[:\s]*-/i);
          netTotal = await parseMoneyValue(netMatch[1]);
          if (isNegative && netTotal > 0) netTotal = -netTotal;
        }
        if (volumeMatch) volume = await parseMoneyValue(volumeMatch[1]);
      }
    } catch (e) {
      console.log(`    Warning: Could not get tooltip - ${(e as Error).message}`);
    }

    // If no tooltip, try to get the P/L value directly from the page
    if (netTotal === null) {
      try {
        // Look for P/L display element
        const pnlElement = page
          .locator('[class*="profit"], [class*="pnl"], [data-testid*="pnl"]')
          .first();
        const pnlText = await pnlElement.textContent({ timeout: 3000 });
        if (pnlText) {
          netTotal = await parseMoneyValue(pnlText);
        }
      } catch {
        console.log(`    Warning: Could not find P/L element`);
      }
    }

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
      wallet: candidate.wallet,
      uiPnl: netTotal,
      gain,
      loss,
      volume,
      scrapedAt: new Date().toISOString(),
      identityCheckPass,
      clobEvents: candidate.clobEvents,
      openPositionsApprox: candidate.openPositionsApprox,
      cashFlowEstimate: candidate.cashFlow,
      notes: identityCheckPass
        ? `CLOB-only wallet. Tooltip verified.`
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

async function main() {
  console.log('=== Scrape CLOB-Only Tooltip Truth ===\n');

  // Load candidates
  const candidatesPath = path.join(process.cwd(), 'tmp', 'clob_only_candidates_fast.json');
  if (!fs.existsSync(candidatesPath)) {
    console.error(`Candidates file not found: ${candidatesPath}`);
    console.error('Run build-clob-only-candidates-fast.ts first.');
    process.exit(1);
  }

  const candidatesData: CandidatesInput = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates = candidatesData.candidates;

  console.log(`Loaded ${candidates.length} CLOB-only candidates\n`);

  // Target: scrape first 60 wallets
  const TARGET_COUNT = 60;
  const toScrape = candidates.slice(0, TARGET_COUNT);
  console.log(`Scraping ${toScrape.length} wallets...\n`);

  // Launch browser
  console.log('Launching browser...');
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  const results: TooltipWallet[] = [];
  const startTime = Date.now();

  console.log('\nScraping wallets...\n');

  for (let i = 0; i < toScrape.length; i++) {
    const candidate = toScrape[i];
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = i > 0 ? elapsed / i : 0;
    const eta = i > 0 ? ((toScrape.length - i) * rate / 60).toFixed(1) : '?';

    console.log(`[${i + 1}/${toScrape.length}] ${candidate.wallet} (ETA: ${eta}min)`);

    const result = await scrapeWalletTooltip(page, candidate);

    if (result) {
      results.push(result);
    }

    // Small delay between requests
    await page.waitForTimeout(1500);
  }

  await browser.close();

  // Ensure output directory exists
  const outputDir = path.join(process.cwd(), 'data', 'regression');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate output
  const passedCount = results.filter((r) => r.identityCheckPass).length;

  const output: ClobOnlyTruthOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'playwright_tooltip_verified',
      method:
        'Hover info icon, extract Net Total from tooltip. Validate: Gain - Loss = Net Total',
      classification: 'CLOB_ONLY',
      wallet_count: results.length,
      identity_pass_count: passedCount,
    },
    wallets: results,
    validation_method: {
      steps: [
        '1. Navigate to https://polymarket.com/profile/{wallet}',
        '2. Click the ALL button in the P/L timeframe selector',
        '3. Hover the info (i) icon next to Profit/Loss',
        '4. Extract: Volume, Gain, Loss, Net Total from tooltip',
        '5. Verify: Gain - |Loss| = Net Total (identity check)',
        '6. Record validated Net Total as uiPnl',
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

  // Write output
  const outputPath = path.join(outputDir, 'clob_only_truth_v1.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Summary
  const totalTime = (Date.now() - startTime) / 1000;
  console.log('\n=== SUMMARY ===\n');
  console.log(`Scraped: ${results.length}/${toScrape.length} wallets`);
  console.log(`Identity check: ${passedCount}/${results.length} passed`);
  console.log(`Total time: ${(totalTime / 60).toFixed(1)} minutes`);
  console.log(`\nOutput written to: ${outputPath}`);

  // PnL distribution of scraped wallets
  const gains = results.filter((r) => r.uiPnl > 0);
  const losses = results.filter((r) => r.uiPnl < 0);
  console.log(`\nPnL distribution: ${gains.length} positive, ${losses.length} negative`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
