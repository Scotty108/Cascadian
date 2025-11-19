#!/usr/bin/env npx tsx
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VALIDATION: Compare Our P&L vs Polymarket UI
 * ═══════════════════════════════════════════════════════════════════════════════
 * Tests all three phases against Polymarket's reported P&L for test wallets.
 * Expected accuracy: Within 10% for "All" tab, closer for "Closed" tab.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const TEST_WALLETS = [
  {
    address: '0x4ce73141dbfce41e65db3723e31059a730f0abad',
    name: 'Burrito338',
    polymarket_closed_pnl: null, // To be filled from Polymarket UI
    polymarket_all_pnl: null,
  },
  {
    address: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144',
    name: 'Wallet B',
    polymarket_closed_pnl: null,
    polymarket_all_pnl: null,
  },
  {
    address: '0x1f0a343513aa6060488fabe96960e6d1e177f7aa',
    name: 'Wallet C',
    polymarket_closed_pnl: null,
    polymarket_all_pnl: null,
  },
];

interface PnLResult {
  wallet: string;
  trading_realized_pnl: number;
  redemption_pnl: number;
  total_realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  closed_positions: number;
  open_positions: number;
  redeemed_positions: number;
}

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('VALIDATION: P&L CALCULATION vs POLYMARKET UI');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Check that all views exist
  console.log('Checking database setup...');
  const tables = await ch.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = 'cascadian_clean'
        AND name LIKE '%pnl%'
      ORDER BY name
    `,
    format: 'JSONEachRow',
  });

  const tableList = await tables.json<{ name: string }[]>();
  console.log(`✓ Found ${tableList.length} P&L tables/views:`);
  tableList.forEach((t) => console.log(`  - ${t.name}`));
  console.log('');

  // Step 2: Get coverage metrics
  console.log('═'.repeat(80));
  console.log('COVERAGE METRICS');
  console.log('═'.repeat(80));
  console.log('');

  const coverage = await ch.query({
    query: `SELECT * FROM cascadian_clean.vw_pnl_coverage_metrics`,
    format: 'JSONEachRow',
  });

  const metrics = await coverage.json<any[]>();
  if (metrics.length > 0) {
    const m = metrics[0];
    console.log(`Resolved markets: ${parseInt(m.resolved_markets).toLocaleString()}`);
    console.log(`Traded markets: ${parseInt(m.traded_markets).toLocaleString()}`);
    console.log(
      `Resolution coverage: ${((parseInt(m.resolved_markets) / parseInt(m.traded_markets)) * 100).toFixed(2)}%`
    );
    console.log('');
    console.log(`Open positions needing prices: ${parseInt(m.open_positions_needing_prices).toLocaleString()}`);
    console.log(`Prices available: ${parseInt(m.prices_available).toLocaleString()}`);
    console.log(
      `Price coverage: ${((parseInt(m.prices_available) / Math.max(1, parseInt(m.open_positions_needing_prices))) * 100).toFixed(2)}%`
    );
    console.log('');
    console.log(`Total Realized P&L: $${parseFloat(m.total_realized_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Total Unrealized P&L: $${parseFloat(m.total_unrealized_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Total All P&L: $${parseFloat(m.total_all_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
    console.log(`Realized %: ${parseFloat(m.realized_pct).toFixed(2)}%`);
    console.log(`Unrealized %: ${parseFloat(m.unrealized_pct).toFixed(2)}%`);
  }

  console.log('');

  // Step 3: Validate each test wallet
  console.log('═'.repeat(80));
  console.log('WALLET VALIDATION');
  console.log('═'.repeat(80));
  console.log('');

  for (const testWallet of TEST_WALLETS) {
    console.log('─'.repeat(80));
    console.log(`WALLET: ${testWallet.name} (${testWallet.address})`);
    console.log('─'.repeat(80));
    console.log('');

    const result = await ch.query({
      query: `
        SELECT
          wallet,
          trading_realized_pnl,
          redemption_pnl,
          total_realized_pnl,
          unrealized_pnl,
          total_pnl,
          closed_positions,
          open_positions,
          redeemed_positions
        FROM cascadian_clean.vw_wallet_pnl_unified
        WHERE lower(wallet) = lower('${testWallet.address}')
      `,
      format: 'JSONEachRow',
    });

    const pnl = await result.json<PnLResult[]>();

    if (pnl.length === 0) {
      console.log('⚠️  No P&L data found for this wallet');
      console.log('');
      continue;
    }

    const p = pnl[0];

    console.log('OUR CALCULATIONS:');
    console.log('');
    console.log('  Realized P&L (Closed):');
    console.log(`    Trading realized: $${p.trading_realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`    Redemption P&L:   $${p.redemption_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`    ────────────────────────────────`);
    console.log(`    Total Realized:   $${p.total_realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
    console.log('  All P&L (Closed + Unrealized):');
    console.log(`    Realized P&L:     $${p.total_realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`    Unrealized P&L:   $${p.unrealized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`    ────────────────────────────────`);
    console.log(`    Total All:        $${p.total_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');
    console.log('  Position Breakdown:');
    console.log(`    Closed positions:   ${p.closed_positions.toLocaleString()}`);
    console.log(`    Open positions:     ${p.open_positions.toLocaleString()}`);
    console.log(`    Redeemed positions: ${p.redeemed_positions.toLocaleString()}`);
    console.log('');

    if (testWallet.polymarket_closed_pnl !== null || testWallet.polymarket_all_pnl !== null) {
      console.log('POLYMARKET UI COMPARISON:');
      console.log('');

      if (testWallet.polymarket_closed_pnl !== null) {
        const diff = p.total_realized_pnl - testWallet.polymarket_closed_pnl;
        const pct = (diff / testWallet.polymarket_closed_pnl) * 100;
        console.log(`  Closed P&L:`);
        console.log(`    Polymarket:  $${testWallet.polymarket_closed_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`    Our calc:    $${p.total_realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`    Difference:  $${diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pct.toFixed(2)}%)`);
        console.log(`    Status:      ${Math.abs(pct) < 10 ? '✅ PASS' : '⚠️  REVIEW'}`);
        console.log('');
      }

      if (testWallet.polymarket_all_pnl !== null) {
        const diff = p.total_pnl - testWallet.polymarket_all_pnl;
        const pct = (diff / testWallet.polymarket_all_pnl) * 100;
        console.log(`  All P&L:`);
        console.log(`    Polymarket:  $${testWallet.polymarket_all_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`    Our calc:    $${p.total_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`    Difference:  $${diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pct.toFixed(2)}%)`);
        console.log(`    Status:      ${Math.abs(pct) < 10 ? '✅ PASS' : '⚠️  REVIEW'}`);
        console.log('');
      }
    } else {
      console.log('📝 TODO: Add Polymarket UI values for comparison');
      console.log('   Visit: https://polymarket.com/profile/' + testWallet.address);
      console.log('');
    }
  }

  console.log('═'.repeat(80));
  console.log('VALIDATION COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log('NEXT STEPS:');
  console.log('  1. Visit Polymarket UI for each test wallet and record P&L values');
  console.log('  2. Update TEST_WALLETS array with actual Polymarket values');
  console.log('  3. Re-run this script to see comparison');
  console.log('  4. If differences > 10%, investigate specific markets');
  console.log('');
  console.log('EXPECTED RESULTS:');
  console.log('  - Closed P&L should match within 5% (fee differences only)');
  console.log('  - All P&L should match within 10% (price timing differences)');
  console.log('');

  await ch.close();
}

main().catch(console.error);
