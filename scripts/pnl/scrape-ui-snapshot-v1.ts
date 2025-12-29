/**
 * Scrape UI Snapshot V1
 *
 * Time-synced scraper that captures:
 * 1. UI total PnL from Polymarket profile page (Playwright)
 * 2. Positions from data-api (immediately after UI scrape)
 *
 * Stores both in pm_ui_snapshot_v1 table for TOTAL identity validation.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { chromium, Browser, Page } from 'playwright';
import { clickhouse } from '../../lib/clickhouse/client';

const SAMPLE_SIZE = 30;
const DELAY_BETWEEN_WALLETS_MS = 2000;

interface PositionData {
  openValue: number;
  positionsCount: number;
  proxyWallet: string | null;
}

interface SnapshotResult {
  wallet_address: string;
  scraped_at: Date;
  ui_total_pnl: number | null;
  ui_open_value: number;
  proxy_wallet_from_positions: string | null;
  positions_count: number;
  raw_ui_text: string | null;
  scrape_status: 'success' | 'error';
  error_message: string | null;
}

async function fetchPositions(wallet: string): Promise<PositionData> {
  try {
    const url = `https://data-api.polymarket.com/positions?user=${wallet}`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { openValue: 0, positionsCount: 0, proxyWallet: null };
    }

    const positions = await response.json() as any[];
    if (!Array.isArray(positions)) {
      return { openValue: 0, positionsCount: 0, proxyWallet: null };
    }

    let openValue = 0;
    let proxyWallet: string | null = null;

    for (const pos of positions) {
      openValue += Number(pos.currentValue) || 0;
      if (!proxyWallet && pos.proxyWallet) {
        proxyWallet = pos.proxyWallet.toLowerCase();
      }
    }

    return {
      openValue,
      positionsCount: positions.length,
      proxyWallet,
    };
  } catch (e: any) {
    console.error(`  Positions API error: ${e.message}`);
    return { openValue: 0, positionsCount: 0, proxyWallet: null };
  }
}

async function scrapeUiPnl(page: Page, wallet: string): Promise<{ pnl: number | null; rawText: string | null; error?: string }> {
  try {
    const url = `https://polymarket.com/profile/${wallet}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for profile to load
    await page.waitForTimeout(2000);

    // Look for PnL value - try multiple selectors
    const selectors = [
      'text=/\\$[\\d,]+\\.?\\d*/',  // Match dollar amounts
      '[data-testid="pnl"]',
      '.pnl-value',
    ];

    let pnlText: string | null = null;

    // Try to find "Profit" or "Loss" section
    const pageContent = await page.content();

    // Look for dollar amounts near "Profit" or "P&L"
    const pnlMatch = pageContent.match(/(?:Profit|P&L|PnL)[^$]*(\$[\d,]+(?:\.\d{2})?)/i);
    if (pnlMatch) {
      pnlText = pnlMatch[1];
    }

    // Alternative: look for the main PnL display
    if (!pnlText) {
      const allText = await page.textContent('body');
      // Find dollar amounts that look like PnL (larger amounts, not prices)
      const dollarMatches = allText?.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
      // Filter for amounts > $1 (skip prices like $0.50)
      const largeDollars = dollarMatches.filter(d => {
        const val = parseFloat(d.replace(/[$,]/g, ''));
        return val > 1;
      });
      if (largeDollars.length > 0) {
        // The first large dollar amount is often the PnL
        pnlText = largeDollars[0];
      }
    }

    if (!pnlText) {
      return { pnl: null, rawText: null, error: 'Could not find PnL on page' };
    }

    // Parse the dollar amount
    const cleanText = pnlText.replace(/[$,]/g, '');
    const pnlValue = parseFloat(cleanText);

    if (isNaN(pnlValue)) {
      return { pnl: null, rawText: pnlText, error: 'Could not parse PnL value' };
    }

    // Check if it's negative (look for minus sign or "Loss")
    const isNegative = pageContent.toLowerCase().includes('loss') || pnlText.includes('-');

    return {
      pnl: isNegative ? -Math.abs(pnlValue) : pnlValue,
      rawText: pnlText,
    };
  } catch (e: any) {
    return { pnl: null, rawText: null, error: e.message?.slice(0, 100) };
  }
}

async function getSampleWallets(): Promise<string[]> {
  // Get wallets from existing benchmark, prioritizing ones with activity
  const query = `
    SELECT DISTINCT wallet_address
    FROM pm_ui_pnl_benchmarks_v2
    WHERE status = 'success'
    ORDER BY abs(ui_pnl_value) DESC
    LIMIT ${SAMPLE_SIZE}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => r.wallet_address.toLowerCase());
}

async function insertSnapshot(snapshot: SnapshotResult): Promise<void> {
  const query = `
    INSERT INTO pm_ui_snapshot_v1 (
      wallet_address,
      scraped_at,
      ui_total_pnl,
      ui_open_value,
      proxy_wallet_from_positions,
      positions_count,
      raw_ui_text,
      scrape_status,
      error_message
    ) VALUES (
      '${snapshot.wallet_address}',
      '${snapshot.scraped_at.toISOString().replace('T', ' ').replace('Z', '')}',
      ${snapshot.ui_total_pnl === null ? 'NULL' : snapshot.ui_total_pnl},
      ${snapshot.ui_open_value},
      ${snapshot.proxy_wallet_from_positions ? `'${snapshot.proxy_wallet_from_positions}'` : 'NULL'},
      ${snapshot.positions_count},
      ${snapshot.raw_ui_text ? `'${snapshot.raw_ui_text.replace(/'/g, "''")}'` : 'NULL'},
      '${snapshot.scrape_status}',
      ${snapshot.error_message ? `'${snapshot.error_message.replace(/'/g, "''")}'` : 'NULL'}
    )
  `;

  await clickhouse.command({ query });
}

async function main() {
  console.log('='.repeat(80));
  console.log('SCRAPE UI SNAPSHOT V1 - Time-Synced');
  console.log('='.repeat(80));
  console.log('');

  // Get sample wallets
  console.log(`Getting ${SAMPLE_SIZE} wallets from benchmarks...`);
  const wallets = await getSampleWallets();
  console.log(`Found ${wallets.length} wallets\n`);

  // Launch browser
  console.log('Launching Playwright browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\n # | wallet       | UI PnL      | Open Val   | Positions | Proxy   | Status');
  console.log('-'.repeat(85));

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const scrapedAt = new Date();

    // 1. Scrape UI PnL
    const uiResult = await scrapeUiPnl(page, wallet);

    // 2. IMMEDIATELY fetch positions (time-synced)
    const posData = await fetchPositions(wallet);

    // 3. Build snapshot
    const snapshot: SnapshotResult = {
      wallet_address: wallet,
      scraped_at: scrapedAt,
      ui_total_pnl: uiResult.pnl,
      ui_open_value: posData.openValue,
      proxy_wallet_from_positions: posData.proxyWallet,
      positions_count: posData.positionsCount,
      raw_ui_text: uiResult.rawText,
      scrape_status: uiResult.pnl !== null ? 'success' : 'error',
      error_message: uiResult.error || null,
    };

    // 4. Insert into table
    await insertSnapshot(snapshot);

    // 5. Log progress
    const pnlStr = snapshot.ui_total_pnl !== null
      ? (snapshot.ui_total_pnl >= 0 ? `$${snapshot.ui_total_pnl.toFixed(0)}` : `-$${Math.abs(snapshot.ui_total_pnl).toFixed(0)}`)
      : 'N/A';
    const openStr = `$${posData.openValue.toFixed(0)}`;
    const proxyStr = posData.proxyWallet ? posData.proxyWallet.slice(0, 8) + '...' : 'none';

    console.log(
      `${(i + 1).toString().padStart(2)} | ${wallet.slice(0, 10)}... | ${pnlStr.padStart(10)} | ${openStr.padStart(10)} | ${posData.positionsCount.toString().padStart(9)} | ${proxyStr.padStart(7)} | ${snapshot.scrape_status}`
    );

    if (snapshot.scrape_status === 'success') successCount++;
    else errorCount++;

    // Rate limiting
    if (i < wallets.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_WALLETS_MS));
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n  Success: ${successCount}/${wallets.length}`);
  console.log(`  Errors:  ${errorCount}/${wallets.length}`);
  console.log(`\n  Data stored in: pm_ui_snapshot_v1`);
}

main().catch(console.error);
