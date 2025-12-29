#!/usr/bin/env npx tsx
/**
 * Large-scale validation of taker-only PnL fix
 * Tests 200 random wallets from the spreadsheet against cohort table and PM API
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

interface WalletData {
  wallet: string;
  oldPnl: number;
  omega: number;
  totalTrades: number;
}

async function loadSpreadsheetWallets(): Promise<WalletData[]> {
  const csvPath = '.playwright-mcp/Untitled-spreadsheet---Sheet1.csv';
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').slice(1); // Skip header

  const wallets: Map<string, WalletData> = new Map();

  for (const line of lines) {
    if (!line.trim()) continue;

    // Parse CSV - handle quoted values with commas
    const parts = line.match(/(".*?"|[^,]+)/g) || [];
    if (parts.length < 7) continue;

    const wallet = parts[1]?.toLowerCase().trim();
    const pnlStr = parts[2]?.replace(/["\$,]/g, '').trim();
    const omegaStr = parts[5]?.trim();
    const tradesStr = parts[6]?.trim();

    if (!wallet || !wallet.startsWith('0x')) continue;

    const oldPnl = parseFloat(pnlStr) || 0;
    const omega = parseFloat(omegaStr) || 0;
    const totalTrades = parseInt(tradesStr) || 0;

    // Only keep first occurrence (dedupe)
    if (!wallets.has(wallet)) {
      wallets.set(wallet, { wallet, oldPnl, omega, totalTrades });
    }
  }

  return Array.from(wallets.values());
}

async function getPolymarketPnl(wallet: string): Promise<{ pnl: number; trades: number; limited: boolean } | null> {
  try {
    const resp = await fetch(`https://data-api.polymarket.com/activity?user=${wallet}&limit=10000`);
    if (!resp.ok) return null;
    const activities = await resp.json() as any[];
    if (activities.length === 0) return null;

    let spent = 0, received = 0, trades = 0;
    for (const a of activities) {
      if (a.type === 'TRADE') {
        trades++;
        if (a.side === 'BUY') spent += parseFloat(a.usdcSize || 0);
        else if (a.side === 'SELL') received += parseFloat(a.usdcSize || 0);
      } else if (a.type === 'REDEEM') {
        received += parseFloat(a.usdcSize || 0);
      }
    }

    return { pnl: received - spent, trades, limited: activities.length >= 9990 };
  } catch {
    return null;
  }
}

async function main() {
  const SAMPLE_SIZE = 200;

  console.log('='.repeat(120));
  console.log('LARGE-SCALE VALIDATION: Spreadsheet vs Cohort vs PM API');
  console.log('='.repeat(120));

  // Load spreadsheet data
  console.log('\n1. Loading spreadsheet data...');
  const allWallets = await loadSpreadsheetWallets();
  console.log(`   Loaded ${allWallets.length} unique wallets`);

  // Filter to wallets with meaningful PnL and moderate trade counts
  const eligible = allWallets.filter(w =>
    Math.abs(w.oldPnl) > 100 &&
    w.totalTrades >= 10 &&
    w.totalTrades <= 500  // Avoid PM API truncation
  );
  console.log(`   ${eligible.length} wallets eligible (PnL>$100, 10-500 trades)`);

  // Random sample
  const shuffled = eligible.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, SAMPLE_SIZE);
  console.log(`   Sampling ${sample.length} wallets\n`);

  console.log('2. Fetching cohort and PM API data...\n');

  interface Result {
    wallet: string;
    oldPnl: number;
    newPnl: number | null;
    pmPnl: number | null;
    newOldRatio: number | null;
    newPmRatio: number | null;
    pmLimited: boolean;
    category: string;
  }

  const results: Result[] = [];
  let processed = 0;

  for (const w of sample) {
    processed++;
    if (processed % 20 === 0) {
      process.stdout.write(`   Processed ${processed}/${sample.length}...\r`);
    }

    // Get NEW value from cohort
    const cohortQ = await clickhouse.query({
      query: `SELECT realized_pnl_usd FROM pm_cohort_pnl_active_v1 WHERE wallet = '${w.wallet}'`,
      format: 'JSONEachRow'
    });
    const cohortRows = await cohortQ.json() as any[];
    const newPnl = cohortRows.length > 0 ? cohortRows[0].realized_pnl_usd : null;

    // Get PM API value
    const pm = await getPolymarketPnl(w.wallet);
    const pmPnl = pm?.pnl ?? null;

    // Calculate ratios
    let newOldRatio: number | null = null;
    let newPmRatio: number | null = null;

    if (newPnl !== null && w.oldPnl !== 0) {
      newOldRatio = newPnl / w.oldPnl;
    }
    if (newPnl !== null && pmPnl !== null && pmPnl !== 0) {
      newPmRatio = newPnl / pmPnl;
    }

    // Categorize
    let category = 'unknown';
    if (newPnl === null) {
      category = 'no_cohort';
    } else if (pm?.limited) {
      category = 'pm_limited';
    } else if (pmPnl === null) {
      category = 'no_pm_data';
    } else if (newOldRatio !== null && newPmRatio !== null) {
      const isHalved = newOldRatio >= 0.45 && newOldRatio <= 0.55;
      const matchesPm = newPmRatio >= 0.85 && newPmRatio <= 1.15;

      if (isHalved && matchesPm) category = 'perfect';
      else if (matchesPm) category = 'pm_match';
      else if (isHalved) category = 'halved_only';
      else if (newOldRatio >= 0.95 && newOldRatio <= 1.05) category = 'unchanged';
      else category = 'other';
    }

    results.push({
      wallet: w.wallet,
      oldPnl: w.oldPnl,
      newPnl,
      pmPnl,
      newOldRatio,
      newPmRatio,
      pmLimited: pm?.limited ?? false,
      category,
    });

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n3. Analyzing results...\n`);

  // Category counts
  const categories: Record<string, Result[]> = {};
  for (const r of results) {
    if (!categories[r.category]) categories[r.category] = [];
    categories[r.category].push(r);
  }

  console.log('='.repeat(120));
  console.log('CATEGORY BREAKDOWN');
  console.log('='.repeat(120));

  const categoryDescriptions: Record<string, string> = {
    'perfect': 'PERFECT (halved 0.5x AND matches PM 1.0x)',
    'pm_match': 'PM MATCH (matches PM but not halved - likely market maker)',
    'halved_only': 'HALVED (halved 0.5x but PM differs - realized vs total)',
    'unchanged': 'UNCHANGED (NEW ≈ OLD, not halved)',
    'other': 'OTHER (various ratios)',
    'no_cohort': 'NO COHORT DATA',
    'no_pm_data': 'NO PM API DATA',
    'pm_limited': 'PM API TRUNCATED (>10k trades)',
  };

  const order = ['perfect', 'pm_match', 'halved_only', 'unchanged', 'other', 'no_cohort', 'no_pm_data', 'pm_limited'];

  for (const cat of order) {
    const items = categories[cat] || [];
    const pct = (items.length / results.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(items.length / results.length * 40));
    console.log(`${categoryDescriptions[cat] || cat}:`);
    console.log(`  ${items.length.toString().padStart(3)} (${pct.padStart(5)}%) ${bar}`);
  }

  // Detailed stats for valid comparisons
  const validResults = results.filter(r =>
    r.newPnl !== null && r.pmPnl !== null && r.pmPnl !== 0 && !r.pmLimited
  );

  if (validResults.length > 0) {
    console.log('\n' + '='.repeat(120));
    console.log('RATIO STATISTICS (valid comparisons only)');
    console.log('='.repeat(120));

    const newOldRatios = validResults.map(r => r.newOldRatio!).filter(r => r > 0 && r < 10);
    const newPmRatios = validResults.map(r => r.newPmRatio!).filter(r => Math.abs(r) < 10);

    const sortedNewOld = [...newOldRatios].sort((a, b) => a - b);
    const sortedNewPm = [...newPmRatios].sort((a, b) => a - b);

    const median = (arr: number[]) => arr[Math.floor(arr.length / 2)];
    const avg = (arr: number[]) => arr.reduce((s, r) => s + r, 0) / arr.length;
    const p25 = (arr: number[]) => arr[Math.floor(arr.length * 0.25)];
    const p75 = (arr: number[]) => arr[Math.floor(arr.length * 0.75)];

    console.log(`\nNEW/OLD Ratio (should be ~0.5x if halved):`);
    console.log(`  Median: ${median(sortedNewOld).toFixed(3)}x`);
    console.log(`  Mean:   ${avg(newOldRatios).toFixed(3)}x`);
    console.log(`  25th:   ${p25(sortedNewOld).toFixed(3)}x`);
    console.log(`  75th:   ${p75(sortedNewOld).toFixed(3)}x`);

    console.log(`\nNEW/PM Ratio (should be ~1.0x if matches):`);
    console.log(`  Median: ${median(sortedNewPm).toFixed(3)}x`);
    console.log(`  Mean:   ${avg(newPmRatios).toFixed(3)}x`);
    console.log(`  25th:   ${p25(sortedNewPm).toFixed(3)}x`);
    console.log(`  75th:   ${p75(sortedNewPm).toFixed(3)}x`);

    // Distribution buckets for NEW/OLD
    console.log(`\nNEW/OLD Distribution:`);
    const newOldBuckets = [
      { name: '0.45-0.55x (halved)', min: 0.45, max: 0.55 },
      { name: '0.55-0.85x', min: 0.55, max: 0.85 },
      { name: '0.85-1.15x (unchanged)', min: 0.85, max: 1.15 },
      { name: '1.15-2.0x', min: 1.15, max: 2.0 },
      { name: 'other', min: -Infinity, max: Infinity },
    ];

    for (const b of newOldBuckets) {
      if (b.name === 'other') {
        const count = newOldRatios.filter(r => r < 0.45 || r >= 2.0).length;
        console.log(`  ${b.name.padEnd(25)} ${count.toString().padStart(3)} (${(count/newOldRatios.length*100).toFixed(1)}%)`);
      } else {
        const count = newOldRatios.filter(r => r >= b.min && r < b.max).length;
        console.log(`  ${b.name.padEnd(25)} ${count.toString().padStart(3)} (${(count/newOldRatios.length*100).toFixed(1)}%)`);
      }
    }

    // Distribution buckets for NEW/PM
    console.log(`\nNEW/PM Distribution:`);
    const newPmBuckets = [
      { name: '0.85-1.15x (match)', min: 0.85, max: 1.15 },
      { name: '0.7-0.85x', min: 0.7, max: 0.85 },
      { name: '1.15-1.3x', min: 1.15, max: 1.3 },
      { name: 'outside 0.7-1.3x', min: -Infinity, max: Infinity },
    ];

    for (const b of newPmBuckets) {
      if (b.name === 'outside 0.7-1.3x') {
        const count = newPmRatios.filter(r => r < 0.7 || r >= 1.3).length;
        console.log(`  ${b.name.padEnd(25)} ${count.toString().padStart(3)} (${(count/newPmRatios.length*100).toFixed(1)}%)`);
      } else {
        const count = newPmRatios.filter(r => r >= b.min && r < b.max).length;
        console.log(`  ${b.name.padEnd(25)} ${count.toString().padStart(3)} (${(count/newPmRatios.length*100).toFixed(1)}%)`);
      }
    }
  }

  // Show sample perfect matches
  const perfect = categories['perfect'] || [];
  if (perfect.length > 0) {
    console.log('\n' + '='.repeat(120));
    console.log(`SAMPLE PERFECT MATCHES (${perfect.length} total)`);
    console.log('='.repeat(120));
    console.log('Wallet                                     | OLD (sheet) | NEW (cohort)| PM API     | NEW/OLD | NEW/PM');
    console.log('-'.repeat(110));

    for (const r of perfect.slice(0, 15)) {
      const oldStr = `$${r.oldPnl.toFixed(0)}`.padStart(11);
      const newStr = `$${r.newPnl!.toFixed(0)}`.padStart(11);
      const pmStr = `$${r.pmPnl!.toFixed(0)}`.padStart(10);
      const newOldStr = `${r.newOldRatio!.toFixed(2)}x`.padStart(7);
      const newPmStr = `${r.newPmRatio!.toFixed(2)}x`.padStart(6);
      console.log(`${r.wallet} | ${oldStr} | ${newStr} | ${pmStr} | ${newOldStr} | ${newPmStr}`);
    }
  }

  // Export full results
  const csvPath = 'tmp/large_scale_validation.csv';
  const headers = 'wallet,old_pnl,new_pnl,pm_pnl,new_old_ratio,new_pm_ratio,category';
  const csvRows = results.map(r =>
    `${r.wallet},${r.oldPnl.toFixed(2)},${r.newPnl?.toFixed(2) || ''},${r.pmPnl?.toFixed(2) || ''},${r.newOldRatio?.toFixed(3) || ''},${r.newPmRatio?.toFixed(3) || ''},${r.category}`
  );
  fs.writeFileSync(csvPath, [headers, ...csvRows].join('\n'));
  console.log(`\n✅ Full results exported to ${csvPath}`);

  await clickhouse.close();
}

main().catch(console.error);
