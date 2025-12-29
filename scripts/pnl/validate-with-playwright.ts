/**
 * Validate PnL using Playwright to fetch UI total + Data API for positions
 *
 * 1. Use Playwright to navigate to Polymarket profile and get displayed total PnL
 * 2. Fetch open positions from Data API
 * 3. Compute: UI_implied_realized = UI_total - sum(open_positions.currentValue)
 * 4. Compare against our V11_POLY realized
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';

interface PolymarketPosition {
  currentValue: number;
  curPrice: number;
  size: number;
  title: string;
}

async function fetchOpenPositions(wallet: string): Promise<{ positions: PolymarketPosition[]; openValue: number }> {
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
      return { positions: [], openValue: 0 };
    }

    const positions: PolymarketPosition[] = await response.json();

    // Open positions are those with curPrice > 0 (not resolved)
    const openPositions = positions.filter(p => p.curPrice > 0);
    const openValue = openPositions.reduce((sum, p) => sum + p.currentValue, 0);

    return { positions: openPositions, openValue };
  } catch (e: any) {
    console.log(`  Positions fetch error: ${e.message}`);
    return { positions: [], openValue: 0 };
  }
}

async function getUITotalViaPlaywright(wallet: string): Promise<number | null> {
  // This would use Playwright MCP to:
  // 1. Navigate to https://polymarket.com/profile/${wallet}
  // 2. Wait for the PnL element to load
  // 3. Extract the displayed total PnL value

  // For now, return known values from manual testing
  const knownValues: Record<string, number> = {
    '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838': 4404.92, // W2
    '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a': 604472.00, // darkrider11
  };

  return knownValues[wallet.toLowerCase()] || null;
}

async function computeOurRealized(wallet: string) {
  try {
    const loadResult = await loadPolymarketPnlEventsForWallet(wallet, {
      includeSyntheticRedemptions: true,
    });
    const pnlResult = computeWalletPnlFromEvents(wallet, loadResult.events);

    return {
      realized: pnlResult.realizedPnl,
      volume: pnlResult.volume,
      events: loadResult.events.length,
      eventCounts: pnlResult.eventCounts,
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

  // Step 1: Get UI total (would use Playwright)
  console.log('\n1. Getting UI Total PnL...');
  const uiTotal = await getUITotalViaPlaywright(wallet);
  if (uiTotal === null) {
    console.log('   SKIP: No known UI value (would use Playwright here)');
    return null;
  }
  console.log(`   UI Total: $${uiTotal.toLocaleString()}`);

  // Step 2: Get open positions value
  console.log('\n2. Fetching open positions from Data API...');
  const { positions, openValue } = await fetchOpenPositions(wallet);
  console.log(`   Open positions: ${positions.length}`);
  console.log(`   Open value: $${openValue.toFixed(2)}`);

  // Step 3: Compute UI implied realized
  const uiImpliedRealized = uiTotal - openValue;
  console.log(`\n3. UI Implied Realized: $${uiTotal.toLocaleString()} - $${openValue.toFixed(2)} = $${uiImpliedRealized.toFixed(2)}`);

  // Step 4: Get our realized
  console.log('\n4. Computing our V11_POLY realized...');
  const ourResult = await computeOurRealized(wallet);
  if (!ourResult) {
    console.log('   FAILED: Could not compute our PnL');
    return null;
  }
  console.log(`   Our Realized: $${ourResult.realized.toFixed(2)}`);
  console.log(`   Our Volume: $${ourResult.volume.toFixed(2)}`);
  console.log(`   Events: ${ourResult.events}`);

  // Step 5: Compare
  console.log('\n5. Comparison:');
  const delta = ourResult.realized - uiImpliedRealized;
  const pctError = uiImpliedRealized !== 0
    ? (Math.abs(delta) / Math.abs(uiImpliedRealized) * 100)
    : (delta === 0 ? 0 : Infinity);

  console.log(`   UI Implied Realized: $${uiImpliedRealized.toFixed(2)}`);
  console.log(`   Our Realized: $${ourResult.realized.toFixed(2)}`);
  console.log(`   Delta: $${delta.toFixed(2)}`);
  console.log(`   Error: ${pctError.toFixed(1)}%`);

  const signMatch = (ourResult.realized >= 0) === (uiImpliedRealized >= 0);
  const withinTolerance = Math.abs(delta) <= Math.max(100, Math.abs(uiImpliedRealized) * 0.1);

  if (signMatch && withinTolerance) {
    console.log(`\n   PASS`);
  } else if (!signMatch) {
    console.log(`\n   FAIL: Sign mismatch`);
  } else {
    console.log(`\n   WARN: Delta exceeds tolerance`);
  }

  return {
    wallet,
    name,
    uiTotal,
    openValue,
    uiImpliedRealized,
    ourRealized: ourResult.realized,
    delta,
    pctError,
    pass: signMatch && withinTolerance,
  };
}

const TEST_WALLETS = [
  { address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', name: 'W2 (benchmark)' },
  { address: '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', name: 'darkrider11' },
];

async function main() {
  console.log('='.repeat(80));
  console.log('VALIDATE PNL: UI Total - Open Value = Implied Realized');
  console.log('='.repeat(80));

  const results = [];

  for (const wallet of TEST_WALLETS) {
    const result = await validateWallet(wallet.address, wallet.name);
    if (result) results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  console.log('\nwallet | UI Total | Open Value | UI Implied | Ours | Delta | Status');
  console.log('-'.repeat(100));

  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `${r.wallet.slice(0, 10)}... | $${r.uiTotal.toLocaleString().padStart(10)} | $${r.openValue.toFixed(0).padStart(8)} | $${r.uiImpliedRealized.toFixed(0).padStart(10)} | $${r.ourRealized.toFixed(0).padStart(10)} | $${r.delta.toFixed(0).padStart(10)} | ${status}`
    );
  }
}

main().catch(console.error);
