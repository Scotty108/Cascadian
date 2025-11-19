#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const query = `
WITH wallets AS (
  SELECT arrayJoin([
    '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8',
    '0x662244931c392df70bd064fa91f838eea0bfd7a9',
    '0x2e0b70d482e6b389e81dea528be57d825dd48070',
    '0x3b6fd06a595d71c70afb3f44414be1c11304340b',
    '0xd748c701ad93cfec32a3420e10f3b08e68612125',
    '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397',
    '0xd06f0f7719df1b3b75b607923536b3250825d4a6',
    '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
    '0x7f3c8979d0afa00007bae4747d5347122af05613',
    '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
    '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
  ]) AS w
),
traded AS (
  SELECT lower(replaceAll(condition_id_norm_v3,'0x','')) AS cid, lower(wallet_address) AS w
  FROM pm_trades_canonical_v3
  WHERE lower(wallet_address) IN (SELECT w FROM wallets)
  GROUP BY w, cid
),
resolutions AS (
  SELECT lower(replaceAll(condition_id_norm,'0x','')) AS cid
  FROM market_resolutions_final
  WHERE payout_denominator > 0
)
SELECT
  w,
  count()                               AS traded_cids,
  countIf(r.cid IS NOT NULL)            AS with_resolution,
  round(100 * with_resolution / traded_cids, 2) AS coverage_pct
FROM traded t
LEFT JOIN resolutions r ON t.cid = r.cid
GROUP BY w
ORDER BY coverage_pct ASC
`;

async function main() {
  console.log('Checking resolution coverage for 14 wallets...\n');

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows = await result.json<Array<{
    w: string;
    traded_cids: string;
    with_resolution: string;
    coverage_pct: string;
  }>>();

  console.log('Resolution Coverage Report:');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('Wallet                                     | Traded | Resolved | Coverage');
  console.log('-------------------------------------------|--------|----------|----------');

  rows.forEach(row => {
    const wallet = row.w.substring(0, 10) + '...';
    const traded = parseInt(row.traded_cids).toLocaleString();
    const resolved = parseInt(row.with_resolution).toLocaleString();
    const coverage = parseFloat(row.coverage_pct);
    const status = coverage < 50 ? '🔴' : coverage < 80 ? '⚠️' : '✅';

    console.log(`${wallet.padEnd(42)} | ${traded.padStart(6)} | ${resolved.padStart(8)} | ${coverage.toFixed(2).padStart(6)}% ${status}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════');

  // Summary stats
  const totalTraded = rows.reduce((sum, row) => sum + parseInt(row.traded_cids), 0);
  const totalResolved = rows.reduce((sum, row) => sum + parseInt(row.with_resolution), 0);
  const avgCoverage = (totalResolved / totalTraded * 100).toFixed(2);

  console.log(`\nTotal Traded Markets: ${totalTraded.toLocaleString()}`);
  console.log(`Total With Resolution: ${totalResolved.toLocaleString()}`);
  console.log(`Average Coverage: ${avgCoverage}%`);

  if (parseFloat(avgCoverage) < 50) {
    console.log('\n⚠️  LOW COVERAGE DETECTED - This explains the $0 P&L issue!');
    console.log('   Resolution data is not joining correctly with traded markets.');
  }
}

main().catch(console.error);
