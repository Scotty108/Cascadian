#!/usr/bin/env npx tsx
/**
 * Validate wallets from user's spreadsheet
 * Compare our new (taker-only) values with Polymarket profile API
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

// Top wallets from the spreadsheet
const SPREADSHEET_WALLETS = [
  '0x2826c943697778f624cd46b6a488e8ee4fae3f4f',
  '0x97e1e8027dd31b5db1467bb870c4bc0d1637ae74',
  '0x3ae04f91fd8dd607659cdae1efe998d20ed811c1',
  '0x007f4b02cf6b8c3477c80a1578d934e39fe831df',
  '0x0b9b15591f5188e7b2acbff1a903361ee67b829d',
  '0x8bd749f13798d86463656f7acbce405ef5bc96af',
  '0xa17e1db825c0d288424da08bad4a76636f70c99c',
  '0x9f249c48c78c02467d32af98de32083fae14801a',
  '0xb6c9665a6d0f7a1875ba6c2d271776ff422b932f',
  '0x03810001a1df8ab8bd8683173a8290d9a6baf770',
];

async function getPolymarketProfile(wallet: string) {
  try {
    // Try profile endpoint first
    const resp = await fetch(`https://data-api.polymarket.com/profile/${wallet}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && (data.pnl !== undefined || data.totalPnL !== undefined)) {
        return {
          pnl: parseFloat(data.pnl || data.totalPnL || '0'),
          volume: parseFloat(data.volume || '0'),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('='.repeat(100));
  console.log('VALIDATING SPREADSHEET WALLETS');
  console.log('='.repeat(100));
  console.log('\nComparing our cohort values vs Polymarket Profile API\n');

  console.log('Wallet'.padEnd(44) + '| Our Cohort  | PM Profile  | Ratio   | Trades');
  console.log('-'.repeat(100));

  let matchCount = 0;
  let closeCount = 0;
  let totalCount = 0;

  for (const wallet of SPREADSHEET_WALLETS) {
    // Get from our cohort table
    const cohortQ = await clickhouse.query({
      query: `SELECT realized_pnl_usd, total_trades FROM pm_cohort_pnl_active_v1 WHERE wallet = '${wallet}'`,
      format: 'JSONEachRow'
    });
    const cohortRows = await cohortQ.json() as any[];

    // Get from Polymarket profile
    const pm = await getPolymarketProfile(wallet);

    const ourPnl = cohortRows.length > 0 ? cohortRows[0].realized_pnl_usd : null;
    const ourTrades = cohortRows.length > 0 ? cohortRows[0].total_trades : 0;
    const pmPnl = pm?.pnl ?? null;

    const ourStr = ourPnl !== null ? `$${ourPnl.toFixed(0)}`.padStart(11) : 'NOT FOUND'.padStart(11);
    const pmStr = pmPnl !== null ? `$${pmPnl.toFixed(0)}`.padStart(11) : 'N/A'.padStart(11);

    let ratio = null;
    let ratioStr = 'N/A'.padStart(7);
    if (ourPnl !== null && pmPnl !== null && pmPnl !== 0) {
      ratio = ourPnl / pmPnl;
      ratioStr = `${ratio.toFixed(2)}x`.padStart(7);
      totalCount++;
      if (ratio >= 0.85 && ratio <= 1.15) matchCount++;
      if (ratio >= 0.7 && ratio <= 1.3) closeCount++;
    }

    console.log(`${wallet} | ${ourStr} | ${pmStr} | ${ratioStr} | ${ourTrades}`);

    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`\nWallets with PM data: ${totalCount}`);
  console.log(`Match (0.85-1.15x):   ${matchCount}/${totalCount}`);
  console.log(`Close (0.7-1.3x):     ${closeCount}/${totalCount}`);

  console.log('\nNote: PM Profile shows TOTAL PnL (realized + unrealized)');
  console.log('Our cohort shows REALIZED PnL only (resolved markets)');
  console.log('Differences are expected for wallets with open positions.');

  await clickhouse.close();
}

main().catch(console.error);
