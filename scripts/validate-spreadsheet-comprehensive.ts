#!/usr/bin/env npx tsx
/**
 * Comprehensive validation of taker-only PnL fix
 * Compares: OLD values (spreadsheet) vs NEW values (cohort) vs Polymarket API
 *
 * Expected result: NEW values should be ~0.5x of OLD values and ~1.0x of PM API
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

// Wallets from spreadsheet with their OLD (2x buggy) values
// These were calculated BEFORE the taker-only fix
const SPREADSHEET_DATA = [
  { wallet: '0x2826c943697778f624cd46b6a488e8ee4fae3f4f', oldPnl: 1266.38 },
  { wallet: '0x97e1e8027dd31b5db1467bb870c4bc0d1637ae74', oldPnl: 57902.15 },
  { wallet: '0x007f4b02cf6b8c3477c80a1578d934e39fe831df', oldPnl: 2988.56 },
  { wallet: '0x8bd749f13798d86463656f7acbce405ef5bc96af', oldPnl: 10065.47 },
  { wallet: '0xa17e1db825c0d288424da08bad4a76636f70c99c', oldPnl: 1287.39 },
  { wallet: '0xb6c9665a6d0f7a1875ba6c2d271776ff422b932f', oldPnl: 10117.74 },
  { wallet: '0x03810001a1df8ab8bd8683173a8290d9a6baf770', oldPnl: 12868.25 },
  { wallet: '0x069acf9916370eef6c6a541f12cd96632ed44634', oldPnl: 78309.86 },
  { wallet: '0x533597c509d5e8a3816a360109903c9af3a8ac49', oldPnl: 642.27 },
  { wallet: '0x149bba5afb8107fd463f54ac041c62d450985336', oldPnl: 549.05 },
  { wallet: '0x4f3409d127b0a8b3da47a7b98dceb31df4f62284', oldPnl: 2259.71 },
  { wallet: '0xf484e2915aa4db8c20ef1fe8edf3771e70fb96ec', oldPnl: 3982.62 },
  { wallet: '0x7ad3c8810c872f0ead69ddce048a027813474144', oldPnl: 2623.49 },
  { wallet: '0xfd301a53ed9291fcbf904e13d3b7c620b0b5e95e', oldPnl: 3987.43 },
  { wallet: '0x8f8fde5327fb5a3975970dbc5740052d257a3d8d', oldPnl: 554.51 },
  { wallet: '0xe207abd721184d72816aea3dc65c79a3a3817b29', oldPnl: 5473.98 },
  { wallet: '0x0636d1127ccc33aad51d5658a7d90506db92ae31', oldPnl: 4606.08 },
  { wallet: '0xabf8af4f5e8d5c32646e6ac834be448eef56976a', oldPnl: 1121.24 },
  { wallet: '0x109039853f962815c3484a49e63b6b4a5219f6b1', oldPnl: 1292.03 },
  { wallet: '0xb27da8097b1decefb6cde87e476214c141128337', oldPnl: 1293.72 },
  { wallet: '0xad8a01eea5b7dbe3bf96e09d69b7622fd3edbb3d', oldPnl: 29557.72 },
  { wallet: '0x94e558d3ed900b2df4c1067a1aa00eacb434a46c', oldPnl: 4214.01 },
  { wallet: '0xfabbb6fe4122a6735c39b0804b3bf5f5c6af35e6', oldPnl: 9998.36 },
  { wallet: '0x2cf0282b9f7294fa84b96d341c8f731d11747707', oldPnl: 2572.88 },
  { wallet: '0xf5fe66aad11eee5ceef6e11aa0c3ca21b2ac6bbe', oldPnl: 42168.78 },
  { wallet: '0x25b7ed2ea10b8315a74797e3c832d78365dc876c', oldPnl: 785.79 },
  { wallet: '0x4ae50cae2e708a7e702a3724e55c0657ed7b116f', oldPnl: 5926.76 },
  { wallet: '0x2e62aeeccade02cd50aae7fc150012690304bb34', oldPnl: 13007.23 },
  { wallet: '0x75f1b498edac8d2d0b2a7c14019c9215d9f63091', oldPnl: 1985.63 },
  { wallet: '0x3ac62f9d34b5df80fbea995b121be6b5c77822ce', oldPnl: 22099.07 },
];

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
  console.log('='.repeat(120));
  console.log('COMPREHENSIVE VALIDATION: OLD (spreadsheet) vs NEW (cohort) vs PM API');
  console.log('='.repeat(120));
  console.log('\nExpected: NEW/OLD ≈ 0.5x (fix halves the value), NEW/PM ≈ 1.0x (matches Polymarket)\n');

  const results: any[] = [];
  let processed = 0;

  console.log('Fetching data...\n');

  for (const item of SPREADSHEET_DATA) {
    processed++;
    process.stdout.write(`Processing ${processed}/${SPREADSHEET_DATA.length}...\r`);

    // Get NEW value from cohort table
    const cohortQ = await clickhouse.query({
      query: `SELECT realized_pnl_usd, total_trades FROM pm_cohort_pnl_active_v1 WHERE wallet = '${item.wallet}'`,
      format: 'JSONEachRow'
    });
    const cohortRows = await cohortQ.json() as any[];
    const newPnl = cohortRows.length > 0 ? cohortRows[0].realized_pnl_usd : null;
    const ourTrades = cohortRows.length > 0 ? cohortRows[0].total_trades : 0;

    // Get PM API value
    const pm = await getPolymarketPnl(item.wallet);

    results.push({
      wallet: item.wallet,
      oldPnl: item.oldPnl,
      newPnl,
      pmPnl: pm?.pnl ?? null,
      pmTrades: pm?.trades ?? 0,
      ourTrades,
      pmLimited: pm?.limited ?? false,
    });

    await new Promise(r => setTimeout(r, 150));
  }

  console.log('\n\n');

  // Display results
  console.log('='.repeat(120));
  console.log('RESULTS');
  console.log('='.repeat(120));
  console.log('Wallet                                     | OLD (sheet) | NEW (cohort)| PM API     | NEW/OLD | NEW/PM  | Status');
  console.log('-'.repeat(120));

  let matchCount = 0;
  let halfCount = 0;
  let validComparisons = 0;

  for (const r of results) {
    const oldStr = `$${r.oldPnl.toFixed(0)}`.padStart(11);
    const newStr = r.newPnl !== null ? `$${r.newPnl.toFixed(0)}`.padStart(11) : 'N/A'.padStart(11);
    const pmStr = r.pmPnl !== null ? `$${r.pmPnl.toFixed(0)}`.padStart(10) : 'N/A'.padStart(10);

    let newOldRatio = r.newPnl !== null ? r.newPnl / r.oldPnl : null;
    let newPmRatio = (r.newPnl !== null && r.pmPnl !== null && r.pmPnl !== 0) ? r.newPnl / r.pmPnl : null;

    const newOldStr = newOldRatio !== null ? `${newOldRatio.toFixed(2)}x`.padStart(7) : 'N/A'.padStart(7);
    const newPmStr = newPmRatio !== null ? `${newPmRatio.toFixed(2)}x`.padStart(7) : 'N/A'.padStart(7);

    let status = '';
    if (newOldRatio !== null && newPmRatio !== null) {
      validComparisons++;
      const isHalved = newOldRatio >= 0.45 && newOldRatio <= 0.55;
      const matchesPm = newPmRatio >= 0.85 && newPmRatio <= 1.15;

      if (isHalved) halfCount++;
      if (matchesPm) matchCount++;

      if (isHalved && matchesPm) status = '✓ PERFECT';
      else if (matchesPm) status = '~ PM match';
      else if (isHalved) status = '~ halved';
      else status = '✗ check';
    } else if (r.pmLimited) {
      status = '⚠ PM limit';
    } else if (r.newPnl === null) {
      status = '⚠ no cohort';
    } else {
      status = '⚠ no PM';
    }

    console.log(`${r.wallet} | ${oldStr} | ${newStr} | ${pmStr} | ${newOldStr} | ${newPmStr} | ${status}`);
  }

  // Summary
  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));
  console.log(`\nTotal wallets:           ${results.length}`);
  console.log(`Valid comparisons:       ${validComparisons}`);
  console.log(`NEW/OLD ≈ 0.5x (halved): ${halfCount}/${validComparisons} (${(halfCount/validComparisons*100).toFixed(1)}%)`);
  console.log(`NEW/PM ≈ 1.0x (match):   ${matchCount}/${validComparisons} (${(matchCount/validComparisons*100).toFixed(1)}%)`);

  // Detailed ratio analysis
  const validResults = results.filter(r => r.newPnl !== null && r.pmPnl !== null && r.pmPnl !== 0);
  if (validResults.length > 0) {
    const newOldRatios = validResults.map(r => r.newPnl / r.oldPnl);
    const newPmRatios = validResults.map(r => r.newPnl / r.pmPnl);

    const avgNewOld = newOldRatios.reduce((s, r) => s + r, 0) / newOldRatios.length;
    const avgNewPm = newPmRatios.reduce((s, r) => s + r, 0) / newPmRatios.length;

    const sortedNewOld = [...newOldRatios].sort((a, b) => a - b);
    const sortedNewPm = [...newPmRatios].sort((a, b) => a - b);
    const medianNewOld = sortedNewOld[Math.floor(sortedNewOld.length / 2)];
    const medianNewPm = sortedNewPm[Math.floor(sortedNewPm.length / 2)];

    console.log(`\nRatio Statistics:`);
    console.log(`  NEW/OLD - Median: ${medianNewOld.toFixed(3)}x, Average: ${avgNewOld.toFixed(3)}x`);
    console.log(`  NEW/PM  - Median: ${medianNewPm.toFixed(3)}x, Average: ${avgNewPm.toFixed(3)}x`);

    console.log(`\nInterpretation:`);
    if (medianNewOld >= 0.45 && medianNewOld <= 0.55) {
      console.log(`  ✓ NEW/OLD median ${medianNewOld.toFixed(2)}x confirms the 2x bug fix (values halved)`);
    } else {
      console.log(`  ✗ NEW/OLD median ${medianNewOld.toFixed(2)}x - unexpected (should be ~0.5x)`);
    }

    if (medianNewPm >= 0.85 && medianNewPm <= 1.15) {
      console.log(`  ✓ NEW/PM median ${medianNewPm.toFixed(2)}x confirms match with Polymarket`);
    } else {
      console.log(`  ? NEW/PM median ${medianNewPm.toFixed(2)}x - some variance from PM (may be realized vs total PnL)`);
    }
  }

  console.log('\n' + '='.repeat(120));
  console.log('KEY INSIGHT');
  console.log('='.repeat(120));
  console.log(`
The spreadsheet contains OLD values from BEFORE the taker-only fix.
Those values were ~2x what Polymarket shows because we were counting both
taker (-t) and maker (-m) fills for each trade.

With the taker-only fix:
- NEW values should be ~0.5x of OLD values (halved)
- NEW values should be ~1.0x of PM API values (match)

If you see NEW/OLD ≈ 0.5x and NEW/PM ≈ 1.0x, the fix is working correctly!
`);

  await clickhouse.close();
}

main().catch(console.error);
