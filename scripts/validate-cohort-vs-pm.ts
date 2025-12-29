#!/usr/bin/env npx tsx
/**
 * Clean validation: Compare cohort table values vs Polymarket API
 * Only tests wallets that exist in our cohort with real data
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function getPmPnl(wallet: string): Promise<{ pnl: number; trades: number; limited: boolean } | null> {
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
  console.log('='.repeat(100));
  console.log('COHORT TABLE vs POLYMARKET API VALIDATION');
  console.log('='.repeat(100));

  // Get wallets from cohort with significant PnL and moderate trade counts
  // Avoid very high trade counts where PM API limit (10k) would truncate
  console.log('\n1. Selecting wallets from cohort (moderate traders, significant PnL)...');

  const q = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl_usd as our_pnl, total_trades, omega
      FROM pm_cohort_pnl_active_v1
      WHERE abs(realized_pnl_usd) > 200
        AND total_trades >= 20
        AND total_trades <= 500  -- Avoid PM API truncation
        AND omega > 0.5 AND omega < 100
      ORDER BY rand()
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });
  const wallets = await q.json() as any[];
  console.log(`   Selected ${wallets.length} wallets\n`);

  console.log('2. Fetching Polymarket data...\n');

  const results: any[] = [];
  let processed = 0;

  for (const w of wallets) {
    processed++;
    if (processed % 20 === 0) console.log(`   Processed ${processed}/${wallets.length}...`);

    const pm = await getPmPnl(w.wallet);
    if (!pm || pm.limited) continue;  // Skip if no data or truncated

    const ratio = pm.pnl !== 0 ? w.our_pnl / pm.pnl : null;
    results.push({
      wallet: w.wallet,
      ourPnl: w.our_pnl,
      pmPnl: pm.pnl,
      ratio,
      ourTrades: w.total_trades,
      pmTrades: pm.trades,
    });

    await new Promise(r => setTimeout(r, 100));
  }

  // Filter to meaningful comparisons (PM PnL > $50)
  const valid = results.filter(r => Math.abs(r.pmPnl) > 50 && r.ratio !== null);

  console.log('\n' + '='.repeat(100));
  console.log('RESULTS');
  console.log('='.repeat(100));
  console.log(`\nWallets with valid comparison: ${valid.length}`);

  const ratios = valid.map(r => r.ratio);
  const matches = ratios.filter(r => r >= 0.85 && r <= 1.15).length;
  const close = ratios.filter(r => r >= 0.7 && r <= 1.3).length;
  const around2x = ratios.filter(r => r >= 1.8 && r <= 2.2).length;

  const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];

  console.log(`\nRatio (Our PnL / PM PnL):`);
  console.log(`  Median:     ${median.toFixed(2)}x`);
  console.log(`  Average:    ${avg.toFixed(2)}x`);
  console.log(`  25th pctl:  ${p25.toFixed(2)}x`);
  console.log(`  75th pctl:  ${p75.toFixed(2)}x`);

  console.log(`\nMatch quality:`);
  console.log(`  Match (0.85-1.15x):  ${matches}/${valid.length} (${(matches/valid.length*100).toFixed(1)}%)`);
  console.log(`  Close (0.7-1.3x):    ${close}/${valid.length} (${(close/valid.length*100).toFixed(1)}%)`);
  console.log(`  ~2x (still buggy):   ${around2x}/${valid.length} (${(around2x/valid.length*100).toFixed(1)}%)`);

  // Distribution
  console.log('\nDistribution:');
  const buckets = [
    { name: '< 0.5x', min: -Infinity, max: 0.5 },
    { name: '0.5-0.7x', min: 0.5, max: 0.7 },
    { name: '0.7-0.85x', min: 0.7, max: 0.85 },
    { name: '0.85-1.15x', min: 0.85, max: 1.15 },
    { name: '1.15-1.3x', min: 1.15, max: 1.3 },
    { name: '1.3-1.8x', min: 1.3, max: 1.8 },
    { name: '1.8-2.2x', min: 1.8, max: 2.2 },
    { name: '> 2.2x', min: 2.2, max: Infinity },
  ];

  for (const b of buckets) {
    const count = ratios.filter(r => r >= b.min && r < b.max).length;
    const pct = (count / ratios.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / ratios.length * 30));
    console.log(`  ${b.name.padEnd(12)} ${count.toString().padStart(3)} (${pct.padStart(5)}%) ${bar}`);
  }

  // Show samples
  console.log('\n' + '='.repeat(100));
  console.log('SAMPLE MATCHES (0.85-1.15x ratio)');
  console.log('='.repeat(100));
  const goodMatches = valid.filter(r => r.ratio >= 0.85 && r.ratio <= 1.15).slice(0, 10);
  console.log('Wallet                                     | Our PnL    | PM PnL     | Ratio');
  console.log('-'.repeat(80));
  goodMatches.forEach(r => {
    console.log(`${r.wallet} | $${r.ourPnl.toFixed(0).padStart(9)} | $${r.pmPnl.toFixed(0).padStart(9)} | ${r.ratio.toFixed(2)}x`);
  });

  console.log('\n' + '='.repeat(100));
  console.log('WORST MISMATCHES (outside 0.7-1.3x)');
  console.log('='.repeat(100));
  const bad = valid.filter(r => r.ratio < 0.7 || r.ratio > 1.3)
    .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1))
    .slice(0, 10);
  console.log('Wallet                                     | Our PnL    | PM PnL     | Ratio');
  console.log('-'.repeat(80));
  bad.forEach(r => {
    console.log(`${r.wallet} | $${r.ourPnl.toFixed(0).padStart(9)} | $${r.pmPnl.toFixed(0).padStart(9)} | ${r.ratio.toFixed(2)}x`);
  });

  await clickhouse.close();
}

main().catch(console.error);
