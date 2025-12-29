#!/usr/bin/env npx tsx
/**
 * Large-scale validation of taker-only PnL fix
 * Tests 100+ wallets against Polymarket API
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

interface ValidationResult {
  wallet: string;
  ourPnl: number;
  pmPnl: number | null;
  ratio: number | null;
  pmTrades: number;
  ourTrades: number;
  status: 'match' | 'close' | 'off' | 'no_pm_data';
}

async function getPolymarketData(wallet: string): Promise<{ pnl: number; trades: number } | null> {
  try {
    const resp = await fetch(`https://data-api.polymarket.com/activity?user=${wallet}&limit=10000`);
    if (!resp.ok) return null;
    const activities = await resp.json() as any[];

    if (activities.length === 0) return null;

    let totalSpent = 0;
    let totalReceived = 0;
    let tradeCount = 0;

    for (const a of activities) {
      if (a.type === 'TRADE') {
        tradeCount++;
        if (a.side === 'BUY') {
          totalSpent += parseFloat(a.usdcSize || 0);
        } else if (a.side === 'SELL') {
          totalReceived += parseFloat(a.usdcSize || 0);
        }
      } else if (a.type === 'REDEEM') {
        totalReceived += parseFloat(a.usdcSize || 0);
      }
    }

    return {
      pnl: totalReceived - totalSpent,
      trades: tradeCount,
    };
  } catch {
    return null;
  }
}

async function main() {
  const SAMPLE_SIZE = 150;

  console.log('='.repeat(100));
  console.log(`LARGE-SCALE VALIDATION: ${SAMPLE_SIZE} WALLETS`);
  console.log('='.repeat(100));

  // Get random sample of wallets with meaningful activity
  console.log('\n1. Selecting random wallets from cohort...');
  const walletsQ = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl_usd as our_pnl, total_trades as our_trades
      FROM pm_cohort_pnl_active_v1
      WHERE abs(realized_pnl_usd) > 100
        AND total_trades >= 10
        AND omega < 500
      ORDER BY rand()
      LIMIT ${SAMPLE_SIZE}
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsQ.json() as any[];
  console.log(`   Selected ${wallets.length} wallets\n`);

  console.log('2. Fetching Polymarket data (this may take a few minutes)...\n');

  const results: ValidationResult[] = [];
  let processed = 0;

  for (const w of wallets) {
    processed++;
    if (processed % 10 === 0) {
      process.stdout.write(`   Processed ${processed}/${wallets.length}...\r`);
    }

    const pmData = await getPolymarketData(w.wallet);

    let status: ValidationResult['status'] = 'no_pm_data';
    let ratio: number | null = null;

    if (pmData && pmData.pnl !== 0) {
      ratio = w.our_pnl / pmData.pnl;
      if (ratio >= 0.9 && ratio <= 1.1) {
        status = 'match';
      } else if (ratio >= 0.7 && ratio <= 1.3) {
        status = 'close';
      } else {
        status = 'off';
      }
    }

    results.push({
      wallet: w.wallet,
      ourPnl: w.our_pnl,
      pmPnl: pmData?.pnl || null,
      ratio,
      pmTrades: pmData?.trades || 0,
      ourTrades: w.our_trades,
      status,
    });

    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n3. Analyzing results...\n`);

  // Filter to wallets with PM data
  const withPmData = results.filter(r => r.pmPnl !== null && r.pmPnl !== 0);
  const matches = withPmData.filter(r => r.status === 'match');
  const close = withPmData.filter(r => r.status === 'close');
  const off = withPmData.filter(r => r.status === 'off');

  console.log('='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`Total wallets tested:        ${results.length}`);
  console.log(`Wallets with PM data:        ${withPmData.length}`);
  console.log(`  - Match (0.9-1.1x):        ${matches.length} (${(matches.length/withPmData.length*100).toFixed(1)}%)`);
  console.log(`  - Close (0.7-1.3x):        ${close.length} (${(close.length/withPmData.length*100).toFixed(1)}%)`);
  console.log(`  - Off (outside 0.7-1.3x):  ${off.length} (${(off.length/withPmData.length*100).toFixed(1)}%)`);

  // Ratio distribution
  const ratios = withPmData.map(r => r.ratio!).filter(r => r > 0 && r < 10);
  const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const medianRatio = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)];

  console.log(`\nRatio Statistics (Our PnL / PM PnL):`);
  console.log(`  Average:  ${avgRatio.toFixed(2)}x`);
  console.log(`  Median:   ${medianRatio.toFixed(2)}x`);

  // Check for systematic bias
  const under1 = ratios.filter(r => r < 1).length;
  const over1 = ratios.filter(r => r >= 1).length;
  console.log(`  Under 1x: ${under1} (${(under1/ratios.length*100).toFixed(1)}%)`);
  console.log(`  Over 1x:  ${over1} (${(over1/ratios.length*100).toFixed(1)}%)`);

  // Show worst mismatches
  console.log('\n' + '='.repeat(100));
  console.log('WORST MISMATCHES (for investigation)');
  console.log('='.repeat(100));
  const sorted = [...off].sort((a, b) => Math.abs(a.ratio! - 1) - Math.abs(b.ratio! - 1)).reverse();
  console.log('Wallet                                     | Our PnL    | PM PnL     | Ratio  | Trades (ours/pm)');
  console.log('-'.repeat(100));
  sorted.slice(0, 15).forEach(r => {
    const ourStr = `$${r.ourPnl.toFixed(0)}`.padStart(10);
    const pmStr = `$${r.pmPnl!.toFixed(0)}`.padStart(10);
    const ratioStr = `${r.ratio!.toFixed(2)}x`.padStart(6);
    console.log(`${r.wallet} | ${ourStr} | ${pmStr} | ${ratioStr} | ${r.ourTrades}/${r.pmTrades}`);
  });

  // Show good matches
  console.log('\n' + '='.repeat(100));
  console.log('GOOD MATCHES (validation)');
  console.log('='.repeat(100));
  console.log('Wallet                                     | Our PnL    | PM PnL     | Ratio  | Trades (ours/pm)');
  console.log('-'.repeat(100));
  matches.slice(0, 15).forEach(r => {
    const ourStr = `$${r.ourPnl.toFixed(0)}`.padStart(10);
    const pmStr = `$${r.pmPnl!.toFixed(0)}`.padStart(10);
    const ratioStr = `${r.ratio!.toFixed(2)}x`.padStart(6);
    console.log(`${r.wallet} | ${ourStr} | ${pmStr} | ${ratioStr} | ${r.ourTrades}/${r.pmTrades}`);
  });

  // Export full results
  const csvPath = 'tmp/validation_results.csv';
  const headers = 'wallet,our_pnl,pm_pnl,ratio,our_trades,pm_trades,status';
  const csvRows = results.map(r =>
    `${r.wallet},${r.ourPnl.toFixed(2)},${r.pmPnl?.toFixed(2) || ''},${r.ratio?.toFixed(3) || ''},${r.ourTrades},${r.pmTrades},${r.status}`
  );
  fs.writeFileSync(csvPath, [headers, ...csvRows].join('\n'));
  console.log(`\n✅ Full results exported to ${csvPath}`);

  await clickhouse.close();
}

main().catch(console.error);
