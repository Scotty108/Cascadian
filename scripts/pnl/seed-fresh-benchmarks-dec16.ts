/**
 * Seed fresh UI PnL benchmarks from Dec 16, 2025 Playwright scrape
 *
 * Run with: npx tsx scripts/pnl/seed-fresh-benchmarks-dec16.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const BENCHMARK_SET = 'fresh_dec16_2025';
const CAPTURED_AT = '2025-12-16T10:00:00Z';

// Fresh benchmarks scraped via Playwright MCP on Dec 16, 2025
const FRESH_BENCHMARKS = [
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934.00, name: 'Theo4' },
  { wallet: '0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf', ui_pnl: 16620028.00, name: 'Fredi9999' },
  { wallet: '0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76', ui_pnl: 8709973.00, name: 'Len9311238' },
  { wallet: '0x863134d00841b2e200492805a01e1e2f5defaa53', ui_pnl: 7532409.50, name: 'RepTrump' },
  { wallet: '0x8119010a6e589062aa03583bb3f39ca632d9f887', ui_pnl: 6083643.00, name: 'PrincessCaro' },
  { wallet: '0x23786fdad0073692157c6d7dc81f281843a35fcb', ui_pnl: 5147998.50, name: 'mikatrade77' },
  { wallet: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', ui_pnl: 2518019.80, name: 'primm' },
  { wallet: '0xe74a4446efd66a4de690962938f550d8921a40ee', ui_pnl: 181865.05, name: 'anon' },
  { wallet: '0x91463565743be18f6b71819234ba5aaaf3845f30', ui_pnl: -23578.32, name: 'smoughshammer' },
];

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   SEED FRESH BENCHMARKS - Dec 16, 2025                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Benchmark set: ${BENCHMARK_SET}`);
  console.log(`Captured at: ${CAPTURED_AT}`);
  console.log(`Wallets: ${FRESH_BENCHMARKS.length}\n`);

  // Insert benchmarks
  for (const b of FRESH_BENCHMARKS) {
    const insertQuery = `
      INSERT INTO pm_ui_pnl_benchmarks_v1 (wallet, pnl_value, benchmark_set, captured_at)
      VALUES ('${b.wallet.toLowerCase()}', ${b.ui_pnl}, '${BENCHMARK_SET}', '${CAPTURED_AT}')
    `;

    await client.command({ query: insertQuery });
    const pnlStr = b.ui_pnl >= 0
      ? '$' + b.ui_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : '-$' + Math.abs(b.ui_pnl).toLocaleString(undefined, { maximumFractionDigits: 2 });
    console.log(`  ✓ ${b.name.padEnd(20)} ${b.wallet.slice(0, 10)}... ${pnlStr}`);
  }

  console.log('\n✅ Inserted all benchmarks');

  // Verify
  const verifyQuery = `
    SELECT count() as cnt, sum(pnl_value) as total_pnl
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${BENCHMARK_SET}'
  `;
  const result = await client.query({ query: verifyQuery, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{ cnt: string; total_pnl: string }>;

  console.log(`\nVerification: ${rows[0].cnt} rows, total PnL: $${Number(rows[0].total_pnl).toLocaleString()}`);
}

main().catch(console.error);
