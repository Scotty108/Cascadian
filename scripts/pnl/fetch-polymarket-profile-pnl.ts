#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * FETCH LIVE POLYMARKET PROFILE PNL
 * ============================================================================
 *
 * RED ALERT FIX: pm_ui_pnl_benchmarks_v1 has inaccuracies.
 * This script fetches LIVE UI PnL values directly from Polymarket profiles
 * to create a verified V2 benchmark dataset.
 *
 * STRATEGY:
 * - Uses Playwright to scrape profile pages (no clean API available)
 * - Retries with exponential backoff for robustness
 * - Saves snapshots with metadata for audit trail
 *
 * USAGE:
 *   # Single wallet test
 *   npx tsx scripts/pnl/fetch-polymarket-profile-pnl.ts --wallet=0x123...
 *
 *   # Batch mode with concurrency
 *   npx tsx scripts/pnl/fetch-polymarket-profile-pnl.ts \
 *     --wallets-file=tmp/trader_strict_sample_v2_fast.json \
 *     --limit=50 \
 *     --concurrency=3 \
 *     --headless=true \
 *     --output=tmp/ui_pnl_live_snapshot_2025_12_07.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs/promises';
import path from 'path';
import { chromium, Browser, Page } from 'playwright';

// ============================================================================
// Types
// ============================================================================

interface ProfilePnLResult {
  wallet: string;
  uiPnL: number | null;
  scrapedAt: string;
  success: boolean;
  error?: string;
  retries: number;
  screenshotPath?: string;
  rawText?: string;
}

interface SnapshotData {
  metadata: {
    source: 'polymarket_profile_live';
    fetched_at: string;
    total_wallets: number;
    successful: number;
    failed: number;
    nonexistent: number;
  };
  wallets: ProfilePnLResult[];
}

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const [k, v] = a.split('=');
    if (k.startsWith('--')) args.set(k.replace(/^--/, ''), v ?? 'true');
  }
  return {
    walletsFile: args.get('wallets-file'),
    wallet: args.get('wallet'),
    limit: Number(args.get('limit') ?? 999),
    headless: args.get('headless') !== 'false',
    maxRetries: Number(args.get('max-retries') ?? 3),
    concurrency: Number(args.get('concurrency') ?? 1),
    output: args.get('output'),
    navTimeoutMs: Number(args.get('nav-timeout-ms') ?? 15000),
    overallTimeoutMs: Number(args.get('overall-timeout-ms') ?? 25000),
    sleepBetweenBatchesMs: Number(args.get('sleep-between-batches-ms') ?? 500),
  };
}

// ============================================================================
// Wallet Loading
// ============================================================================

async function loadWallets(config: ReturnType<typeof parseArgs>): Promise<string[]> {
  if (config.wallet) {
    return [config.wallet.toLowerCase()];
  }

  if (!config.walletsFile) {
    throw new Error('Must provide --wallets-file or --wallet');
  }

  const fullPath = path.join(process.cwd(), config.walletsFile);
  const raw = await fs.readFile(fullPath, 'utf8');
  const data = JSON.parse(raw);

  let candidates: any[] = [];
  if (Array.isArray(data)) {
    candidates = data;
  } else if (Array.isArray(data.wallets)) {
    candidates = data.wallets;
  } else {
    throw new Error(`Unknown wallet file format: ${config.walletsFile}`);
  }

  const wallets = candidates
    .slice(0, config.limit)
    .map(c => {
      if (typeof c === 'string') return c.toLowerCase();
      if (c.wallet_address) return c.wallet_address.toLowerCase();
      if (c.wallet) return c.wallet.toLowerCase();
      throw new Error('Cannot extract wallet address from candidate');
    });

  return wallets;
}

// ============================================================================
// PnL Parsing
// ============================================================================

function parseUSDValue(text: string): number | null {
  if (!text) return null;

  // Remove currency symbols, commas, and whitespace
  const cleaned = text.replace(/[$,\s]/g, '');

  // Handle negative values (both "-" and parentheses)
  const isNegative = text.includes('-') || text.includes('(');
  const value = parseFloat(cleaned.replace(/[-()]/g, ''));

  if (isNaN(value)) return null;
  return isNegative ? -value : value;
}

// ============================================================================
// Profile Scraping with Timeout Wrapper
// ============================================================================

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}

async function scrapeProfilePnL(
  page: Page,
  wallet: string,
  maxRetries: number,
  navTimeoutMs: number,
  overallTimeoutMs: number
): Promise<ProfilePnLResult> {
  const url = `https://polymarket.com/profile/${wallet}`;
  let lastError: string | undefined;

  // Set page timeouts
  page.setDefaultNavigationTimeout(navTimeoutMs);
  page.setDefaultTimeout(navTimeoutMs);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`   Attempt ${attempt + 1}/${maxRetries + 1}: ${url}`);

      // Wrap entire scraping operation in overall timeout
      const result = await withTimeout(
        (async (): Promise<ProfilePnLResult> => {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
          await page.waitForTimeout(2000); // Let page fully render

          // Check if profile exists (not "anon" with $0)
          const profileStatus = await page.evaluate(() => {
            const allText = document.body.innerText;
            const hasAnon = allText.toLowerCase().includes('anon');
            const hasZeroPnl = allText.match(/\$0\.00/) !== null;
            return { hasAnon, hasZeroPnl };
          });

          // If profile shows "anon" and $0, it doesn't exist
          if (profileStatus.hasAnon && profileStatus.hasZeroPnl) {
            console.log(`   ⚠️  Profile does not exist (anon + $0)`);
            return {
              wallet,
              uiPnL: null,
              scrapedAt: new Date().toISOString(),
              success: false,
              error: 'Profile does not exist (anon)',
              retries: attempt,
            };
          }

          // Try to find PnL via page.evaluate
          const pnlText = await page.evaluate(() => {
            const allText = document.body.innerText;

            // Pattern 1: "Net total\n$123,456"
            const netMatch = allText.match(/Net total[\s\n]*([+-]?\$[\d,]+(?:\.\d+)?)/i);
            if (netMatch) return netMatch[1];

            // Pattern 2: "Profit\n$123,456"
            const profitMatch = allText.match(/Profit[\s\n]*([+-]?\$[\d,]+(?:\.\d+)?)/i);
            if (profitMatch) return profitMatch[1];

            // Pattern 3: Look for largest dollar amount (fallback)
            const dollarMatches = allText.match(/[+-]?\$[\d,]+(?:\.\d+)?/g) || [];
            if (dollarMatches.length > 0) {
              let maxVal = dollarMatches[0];
              let maxAbs = 0;
              for (const m of dollarMatches) {
                const val = parseFloat(m.replace(/[$,+]/g, ''));
                if (!isNaN(val) && Math.abs(val) > maxAbs) {
                  maxAbs = Math.abs(val);
                  maxVal = m;
                }
              }
              return maxVal;
            }
            return null;
          });

          if (pnlText) {
            const uiPnL = parseUSDValue(pnlText);
            console.log(`   ✅ Found PnL: ${pnlText} -> $${uiPnL}`);
            return {
              wallet,
              uiPnL,
              scrapedAt: new Date().toISOString(),
              success: true,
              retries: attempt,
              rawText: pnlText,
            };
          }

          throw new Error('No PnL value found on page');
        })(),
        overallTimeoutMs,
        `Overall timeout (${overallTimeoutMs}ms) exceeded`
      );

      return result;

    } catch (error: any) {
      lastError = error.message;
      console.log(`   ❌ Error on attempt ${attempt + 1}: ${lastError}`);

      // Take screenshot for debugging errors
      try {
        const screenshotDir = path.join(process.cwd(), 'tmp', 'pnl-screenshots');
        await fs.mkdir(screenshotDir, { recursive: true });
        const screenshotPath = path.join(screenshotDir, `${wallet.slice(0, 12)}_error_attempt${attempt}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`   📸 Error screenshot: ${screenshotPath}`);
      } catch (screenshotError) {
        // Ignore screenshot errors
      }

      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const baseWaitMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        const jitter = Math.random() * 500; // Add 0-500ms jitter
        const waitMs = Math.floor(baseWaitMs + jitter);
        console.log(`   ⏳ Waiting ${waitMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  return {
    wallet,
    uiPnL: null,
    scrapedAt: new Date().toISOString(),
    success: false,
    error: lastError,
    retries: maxRetries,
  };
}

// ============================================================================
// Main
// ============================================================================

// ============================================================================
// Concurrent Processing (1 Browser, N Contexts)
// ============================================================================

async function processWalletBatch(
  wallets: string[],
  maxRetries: number,
  headless: boolean,
  concurrency: number,
  navTimeoutMs: number,
  overallTimeoutMs: number,
  sleepBetweenBatchesMs: number
): Promise<ProfilePnLResult[]> {
  const results: ProfilePnLResult[] = [];
  let completed = 0;

  // Launch ONE browser with N contexts
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const pages: Page[] = [];
  for (let i = 0; i < concurrency; i++) {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    pages.push(page);
  }

  // Process wallets in batches
  const batchSize = concurrency;
  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map((wallet, idx) => {
        const pageIdx = idx % pages.length;
        console.log(`\n[${i + idx + 1}/${wallets.length}] Processing ${wallet}...`);
        return scrapeProfilePnL(pages[pageIdx], wallet, maxRetries, navTimeoutMs, overallTimeoutMs);
      })
    );

    results.push(...batchResults);
    completed += batch.length;

    // Progress indicator
    const success = results.filter(r => r.success).length;
    const fail = results.filter(r => !r.success).length;
    const nonexistent = results.filter(r => !r.success && r.error === 'Profile does not exist (anon)').length;
    console.log(`\n   Progress: ${completed}/${wallets.length} | Success: ${success} | Failed: ${fail - nonexistent} | Nonexistent: ${nonexistent}`);

    // Sleep between batches to avoid rate limiting
    if (i + batchSize < wallets.length && sleepBetweenBatchesMs > 0) {
      console.log(`   💤 Sleeping ${sleepBetweenBatchesMs}ms between batches...`);
      await new Promise(resolve => setTimeout(resolve, sleepBetweenBatchesMs));
    }
  }

  // Close browser
  await browser.close();

  return results;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   FETCH LIVE POLYMARKET PROFILE PNL`);
  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Wallets file:         ${config.walletsFile || 'N/A'}`);
  console.log(`   Single wallet:        ${config.wallet || 'N/A'}`);
  console.log(`   Limit:                ${config.limit}`);
  console.log(`   Headless:             ${config.headless}`);
  console.log(`   Max retries:          ${config.maxRetries}`);
  console.log(`   Concurrency:          ${config.concurrency}`);
  console.log(`   Output:               ${config.output || 'auto-generated'}`);
  console.log(`   Nav timeout:          ${config.navTimeoutMs}ms`);
  console.log(`   Overall timeout:      ${config.overallTimeoutMs}ms`);
  console.log(`   Sleep between batch:  ${config.sleepBetweenBatchesMs}ms`);
  console.log(`   Start time:           ${new Date().toISOString()}`);
  console.log();

  // Load wallets
  const wallets = await loadWallets(config);
  console.log(`✅ Loaded ${wallets.length} wallets\n`);

  // Process wallets with concurrency
  console.log(`🚀 Launching 1 browser with ${config.concurrency} context(s) (headless=${config.headless})...`);
  const results = await processWalletBatch(
    wallets,
    config.maxRetries,
    config.headless,
    config.concurrency,
    config.navTimeoutMs,
    config.overallTimeoutMs,
    config.sleepBetweenBatchesMs
  );

  // Generate snapshot
  const nonexistent = results.filter(r => !r.success && r.error === 'Profile does not exist (anon)').length;
  const snapshot: SnapshotData = {
    metadata: {
      source: 'polymarket_profile_live',
      fetched_at: new Date().toISOString(),
      total_wallets: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      nonexistent,
    },
    wallets: results,
  };

  // Save snapshot
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const outputPath = config.output || path.join(
    process.cwd(),
    'tmp',
    `polymarket_profile_pnl_snapshot_${dateStr}.json`
  );

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2));

  // Summary
  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`                    SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`  Total wallets:    ${snapshot.metadata.total_wallets}`);
  console.log(`  Successful:       ${snapshot.metadata.successful} (${((snapshot.metadata.successful / snapshot.metadata.total_wallets) * 100).toFixed(1)}%)`);
  console.log(`  Nonexistent:      ${snapshot.metadata.nonexistent} (anon + $0 - excluded from validation)`);
  console.log(`  Failed:           ${snapshot.metadata.failed - snapshot.metadata.nonexistent} (${(((snapshot.metadata.failed - snapshot.metadata.nonexistent) / snapshot.metadata.total_wallets) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`📄 Snapshot saved to: ${outputPath}`);
  console.log();

  const realFailures = results.filter(r => !r.success && r.error !== 'Profile does not exist (anon)');
  if (realFailures.length > 0) {
    console.log(`⚠️  Failed wallets (real errors):`);
    realFailures.forEach(r => {
      console.log(`   - ${r.wallet}: ${r.error}`);
    });
    console.log();
  }

  console.log(`💡 TIP: Wallets marked "nonexistent" should be excluded from validation comparisons`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
