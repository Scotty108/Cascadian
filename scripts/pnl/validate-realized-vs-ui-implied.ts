/**
 * Validate Realized PnL against Polymarket UI Implied Realized
 *
 * For each wallet:
 * 1. Fetch positions from Polymarket Data-API
 * 2. Compute ui_open_value = sum(currentValue)
 * 3. Compute ui_realized_sum = sum(realizedPnl) + sum(cashPnl where curPrice=0)
 *    Note: Resolved but unredeemed positions show realizedPnl=0, cashPnl=loss
 * 4. Compare against our V11_POLY realized PnL
 *
 * The Polymarket positions API returns:
 * - size: shares held
 * - avgPrice: entry price
 * - currentValue: current market value (size * curPrice)
 * - cashPnl: P&L for this position
 * - realizedPnl: realized portion (from partial closes?)
 * - curPrice: current price (0 for resolved)
 * - redeemable: whether position can be redeemed (resolved)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';

interface PolymarketPosition {
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  realizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  title: string;
  outcome: string;
}

interface UISnapshot {
  wallet: string;
  ts: number;
  positions: PolymarketPosition[];
  ui_open_value: number;
  ui_total_cash_pnl: number; // sum of all cashPnl
  ui_realized_sum: number; // sum of realizedPnl
  resolved_positions: number;
  open_positions: number;
}

async function fetchUISnapshot(wallet: string): Promise<UISnapshot | null> {
  try {
    const response = await fetch(
      `https://data-api.polymarket.com/positions?user=${wallet}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Cascadian-Validation/1.0',
        },
      }
    );

    if (!response.ok) {
      console.log(`  API error: ${response.status}`);
      return null;
    }

    const positions: PolymarketPosition[] = await response.json();

    // Compute metrics
    const ui_open_value = positions
      .filter(p => p.curPrice > 0) // Only open (unresolved) positions
      .reduce((sum, p) => sum + p.currentValue, 0);

    const ui_total_cash_pnl = positions.reduce((sum, p) => sum + p.cashPnl, 0);
    const ui_realized_sum = positions.reduce((sum, p) => sum + p.realizedPnl, 0);

    const resolved_positions = positions.filter(p => p.curPrice === 0 || p.redeemable).length;
    const open_positions = positions.filter(p => p.curPrice > 0 && !p.redeemable).length;

    return {
      wallet,
      ts: Date.now(),
      positions,
      ui_open_value,
      ui_total_cash_pnl,
      ui_realized_sum,
      resolved_positions,
      open_positions,
    };
  } catch (e: any) {
    console.log(`  Fetch error: ${e.message}`);
    return null;
  }
}

async function computeOurRealized(wallet: string): Promise<{ realized: number; volume: number; events: number } | null> {
  try {
    const loadResult = await loadPolymarketPnlEventsForWallet(wallet, {
      includeSyntheticRedemptions: true,
    });
    const pnlResult = computeWalletPnlFromEvents(wallet, loadResult.events);

    return {
      realized: pnlResult.realizedPnl,
      volume: pnlResult.volume,
      events: loadResult.events.length,
    };
  } catch (e: any) {
    console.log(`  V11_POLY error: ${e.message}`);
    return null;
  }
}

async function validateWallet(wallet: string, name?: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`WALLET: ${wallet.slice(0, 20)}... ${name ? `(${name})` : ''}`);
  console.log('='.repeat(80));

  // Fetch UI snapshot
  console.log('\n1. Fetching Polymarket positions...');
  const snapshot = await fetchUISnapshot(wallet);

  if (!snapshot) {
    console.log('   FAILED: Could not fetch UI data');
    return null;
  }

  console.log(`   Positions: ${snapshot.positions.length} total`);
  console.log(`   Resolved: ${snapshot.resolved_positions}, Open: ${snapshot.open_positions}`);
  console.log(`   UI Open Value: $${snapshot.ui_open_value.toFixed(2)}`);
  console.log(`   UI Total Cash PnL: $${snapshot.ui_total_cash_pnl.toFixed(2)}`);
  console.log(`   UI Realized Sum: $${snapshot.ui_realized_sum.toFixed(2)}`);

  // Compute our realized
  console.log('\n2. Computing V11_POLY realized PnL...');
  const ourResult = await computeOurRealized(wallet);

  if (!ourResult) {
    console.log('   FAILED: Could not compute our PnL');
    return null;
  }

  console.log(`   Our Realized: $${ourResult.realized.toFixed(2)}`);
  console.log(`   Our Volume: $${ourResult.volume.toFixed(2)}`);
  console.log(`   Events: ${ourResult.events}`);

  // Compare
  console.log('\n3. Comparison:');

  // The UI total = realized + unrealized
  // For resolved positions, cashPnl IS the realized (even if realizedPnl field is 0)
  // For open positions, cashPnl is unrealized
  const ui_implied_realized = snapshot.positions
    .filter(p => p.curPrice === 0 || p.redeemable)
    .reduce((sum, p) => sum + p.cashPnl, 0);

  console.log(`   UI Implied Realized (resolved cashPnl): $${ui_implied_realized.toFixed(2)}`);
  console.log(`   Our Realized: $${ourResult.realized.toFixed(2)}`);

  const delta = ourResult.realized - ui_implied_realized;
  const pctError = ui_implied_realized !== 0
    ? (Math.abs(delta) / Math.abs(ui_implied_realized) * 100)
    : (delta === 0 ? 0 : Infinity);

  console.log(`   Delta: $${delta.toFixed(2)}`);
  console.log(`   Error: ${pctError.toFixed(1)}%`);

  // Sign match check
  const signMatch = (ourResult.realized >= 0) === (ui_implied_realized >= 0);
  const withinTolerance = Math.abs(delta) <= Math.max(50, Math.abs(ui_implied_realized) * 0.1);

  if (!signMatch && Math.abs(ui_implied_realized) > 100) {
    console.log(`\n   FAIL: Sign flip (ours: ${ourResult.realized >= 0 ? '+' : '-'}, UI: ${ui_implied_realized >= 0 ? '+' : '-'})`);
  } else if (withinTolerance) {
    console.log(`\n   PASS: Within tolerance`);
  } else {
    console.log(`\n   WARN: Delta exceeds 10% tolerance`);
  }

  return {
    wallet,
    name,
    ui_implied_realized,
    our_realized: ourResult.realized,
    delta,
    pct_error: pctError,
    sign_match: signMatch,
    pass: signMatch && withinTolerance,
    positions: snapshot.positions.length,
    resolved: snapshot.resolved_positions,
    open: snapshot.open_positions,
  };
}

// Test wallets
const TEST_WALLETS = [
  { address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', name: 'W2 (benchmark)' },
  { address: '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', name: 'darkrider11 (violating)' },
  // Add more conserving wallets from our sample
  { address: '0x7c034d7431b6a911bd9a1023df2c3fdeb26b2a81', name: 'Top Conserving #1' },
  { address: '0x6c60960f5c9d88c3ca41f12a3a4e1f1cc3cfd08b', name: 'Top Conserving #2' },
  { address: '0x633fab99c8a5f9ae2f50a265e1061c5fae87c5fb', name: 'Top Conserving #3' },
];

async function main() {
  console.log('='.repeat(80));
  console.log('VALIDATE REALIZED PNL VS UI IMPLIED REALIZED');
  console.log('='.repeat(80));
  console.log(`Testing ${TEST_WALLETS.length} wallets`);
  console.log('Acceptance: sign match + within 10% or $50 tolerance');

  const results = [];

  for (const wallet of TEST_WALLETS) {
    const result = await validateWallet(wallet.address, wallet.name);
    if (result) results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log(`\nPass: ${passed}/${results.length}`);
  console.log(`Fail: ${failed}/${results.length}`);

  console.log('\n--- Per-Wallet Results ---');
  console.log('wallet | UI implied | Ours | Delta | Error% | Status');
  console.log('-'.repeat(90));

  for (const r of results) {
    const status = r.pass ? 'PASS' : (r.sign_match ? 'WARN' : 'FAIL');
    const uiStr = r.ui_implied_realized >= 0
      ? `+$${r.ui_implied_realized.toLocaleString()}`
      : `-$${Math.abs(r.ui_implied_realized).toLocaleString()}`;
    const ourStr = r.our_realized >= 0
      ? `+$${r.our_realized.toLocaleString()}`
      : `-$${Math.abs(r.our_realized).toLocaleString()}`;
    const deltaStr = r.delta >= 0
      ? `+$${r.delta.toFixed(0)}`
      : `-$${Math.abs(r.delta).toFixed(0)}`;

    console.log(
      `${r.wallet.slice(0, 10)}... | ${uiStr.padStart(12)} | ${ourStr.padStart(12)} | ${deltaStr.padStart(8)} | ${r.pct_error.toFixed(1).padStart(6)}% | ${status}`
    );
  }
}

main().catch(console.error);
