/**
 * Golden Wallet Test Harness
 *
 * Tests V13 PnL engine against known wallet PnL values from Polymarket UI.
 * Goal: <0.1% error for ALL test wallets with no sign mismatches.
 *
 * Known wallets and their UI PnL values:
 * - aenews (0xbbac67aae8e17eb44dae3e68aed0a2eb2ecd5fe3): ~$116K
 * - Theo4 (0x56687bf447db6ffa42ffe2204a05edaa20f55839): ~$22M
 * - plus additional wallets from leaderboard
 *
 * @author Claude Code
 * @version 1.0
 * @date 2025-11-29
 */

import { calculateWalletPnlV13, calculateWalletPnlV13Debug } from '../../lib/pnl/uiPnlEngineV13';
import { computeWalletActivityPnlV3 } from '../../lib/pnl/uiActivityEngineV3';
import { clickhouse } from '../../lib/clickhouse/client';

// =============================================================================
// GOLDEN WALLET SET
// =============================================================================

interface GoldenWallet {
  name: string;
  address: string;
  ui_pnl: number;        // From Polymarket UI
  ui_source: string;     // When/how UI value was obtained
  wallet_type: string;   // retail, market_maker, hedger, bot
}

// Known golden wallets with verified UI PnL values
// NOTE: aenews was removed - doesn't exist in our database
// Using wallets that actually exist in pm_trader_events_v2
const GOLDEN_WALLETS: GoldenWallet[] = [
  {
    name: 'Theo4',
    address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
    ui_pnl: 22053934,
    ui_source: '2025-11-28 investigation',
    wallet_type: 'hedger',
  },
  {
    name: 'TopTrader1',
    address: '0xc5d563a36ae78145c45a50134d48a1215220f80a',
    ui_pnl: 0,  // Unknown - needs verification
    ui_source: 'top by volume, UI PnL TBD',
    wallet_type: 'unknown',
  },
  {
    name: 'TopTrader2',
    address: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    ui_pnl: 0,  // Unknown - needs verification
    ui_source: 'top by volume, UI PnL TBD',
    wallet_type: 'unknown',
  },
];

// =============================================================================
// FETCH FRESH UI VALUES (for reference)
// =============================================================================

interface PolyculeProfile {
  pnl?: number;
  volume?: number;
  positions?: number;
}

async function fetchPolyculeProfile(address: string): Promise<PolyculeProfile | null> {
  try {
    const response = await fetch(`https://www.polycule.xyz/api/profile/${address.toLowerCase()}`);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      pnl: data.pnl,
      volume: data.volume,
      positions: data.positions,
    };
  } catch (e) {
    return null;
  }
}

interface PolymarketProfile {
  profitLoss?: number;
  volume?: number;
}

async function fetchPolymarketProfile(address: string): Promise<PolymarketProfile | null> {
  try {
    // Note: This might not work without proper auth
    const response = await fetch(`https://gamma-api.polymarket.com/profiles/${address.toLowerCase()}`);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      profitLoss: data.profitLoss,
      volume: data.volume,
    };
  } catch (e) {
    return null;
  }
}

// =============================================================================
// TEST RUNNER
// =============================================================================

interface TestResult {
  wallet: GoldenWallet;
  v3_pnl: number;
  v13_pnl: number;
  v3_error_pct: number;
  v13_error_pct: number;
  v3_sign_match: boolean;
  v13_sign_match: boolean;
  netting_impact: number;
  conditions_with_both_sides: number;
  polycule_pnl?: number;
  polymarket_pnl?: number;
}

async function testWallet(wallet: GoldenWallet): Promise<TestResult> {
  console.log(`\nTesting ${wallet.name} (${wallet.address.substring(0, 10)}...)...`);

  // Run both engines
  const [v3Result, v13Result] = await Promise.all([
    computeWalletActivityPnlV3(wallet.address),
    calculateWalletPnlV13Debug(wallet.address),
  ]);

  // Calculate errors
  const v3Pnl = v3Result.pnl_activity_total;
  const v13Pnl = v13Result.pnl_total;
  const uiPnl = wallet.ui_pnl;

  const v3Error = uiPnl !== 0 ? ((v3Pnl - uiPnl) / Math.abs(uiPnl)) * 100 : 0;
  const v13Error = uiPnl !== 0 ? ((v13Pnl - uiPnl) / Math.abs(uiPnl)) * 100 : 0;

  const v3SignMatch = Math.sign(v3Pnl) === Math.sign(uiPnl);
  const v13SignMatch = Math.sign(v13Pnl) === Math.sign(uiPnl);

  // Try to fetch live values
  const polycule = await fetchPolyculeProfile(wallet.address);
  const polymarket = await fetchPolymarketProfile(wallet.address);

  return {
    wallet,
    v3_pnl: v3Pnl,
    v13_pnl: v13Pnl,
    v3_error_pct: v3Error,
    v13_error_pct: v13Error,
    v3_sign_match: v3SignMatch,
    v13_sign_match: v13SignMatch,
    netting_impact: v13Result.netting_impact,
    conditions_with_both_sides: v13Result.conditions_with_both_sides,
    polycule_pnl: polycule?.pnl,
    polymarket_pnl: polymarket?.profitLoss,
  };
}

function formatPnl(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  } else {
    return `$${value.toFixed(0)}`;
  }
}

function formatError(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

async function runAllTests() {
  console.log('=== GOLDEN WALLET TEST HARNESS ===\n');
  console.log(`Testing ${GOLDEN_WALLETS.length} wallets...\n`);

  const results: TestResult[] = [];

  for (const wallet of GOLDEN_WALLETS) {
    try {
      const result = await testWallet(wallet);
      results.push(result);
    } catch (e) {
      console.error(`Error testing ${wallet.name}:`, e);
    }
  }

  // Print summary table
  console.log('\n\n=== SUMMARY TABLE ===\n');
  console.log('| Wallet | Type | UI PnL | V3 Calc | V3 Error | V13 Calc | V13 Error | Netting |');
  console.log('|--------|------|--------|---------|----------|----------|-----------|---------|');

  for (const r of results) {
    const v3Status = Math.abs(r.v3_error_pct) < 0.1 ? 'PASS' : (Math.abs(r.v3_error_pct) < 5 ? 'WARN' : 'FAIL');
    const v13Status = Math.abs(r.v13_error_pct) < 0.1 ? 'PASS' : (Math.abs(r.v13_error_pct) < 5 ? 'WARN' : 'FAIL');

    console.log(`| ${r.wallet.name.padEnd(6)} | ${r.wallet.wallet_type.padEnd(4)} | ${formatPnl(r.wallet.ui_pnl).padEnd(6)} | ${formatPnl(r.v3_pnl).padEnd(7)} | ${formatError(r.v3_error_pct).padEnd(8)} | ${formatPnl(r.v13_pnl).padEnd(8)} | ${formatError(r.v13_error_pct).padEnd(9)} | ${formatPnl(r.netting_impact).padEnd(7)} |`);
  }

  // Print detailed results
  console.log('\n\n=== DETAILED RESULTS ===\n');

  for (const r of results) {
    console.log(`${r.wallet.name} (${r.wallet.wallet_type}):`);
    console.log(`  UI PnL:        ${formatPnl(r.wallet.ui_pnl)}`);
    console.log(`  V3 PnL:        ${formatPnl(r.v3_pnl)} (${formatError(r.v3_error_pct)}) ${r.v3_sign_match ? 'SIGN OK' : 'SIGN MISMATCH!'}`);
    console.log(`  V13 PnL:       ${formatPnl(r.v13_pnl)} (${formatError(r.v13_error_pct)}) ${r.v13_sign_match ? 'SIGN OK' : 'SIGN MISMATCH!'}`);
    console.log(`  Netting Impact: ${formatPnl(r.netting_impact)} (${r.conditions_with_both_sides} conditions with both YES/NO)`);
    if (r.polycule_pnl !== undefined) {
      console.log(`  Polycule Live:  ${formatPnl(r.polycule_pnl)}`);
    }
    if (r.polymarket_pnl !== undefined) {
      console.log(`  Polymarket Live: ${formatPnl(r.polymarket_pnl)}`);
    }
    console.log('');
  }

  // Check if we pass the goal
  console.log('\n=== GOAL CHECK ===\n');
  const allV13Pass = results.every(r => Math.abs(r.v13_error_pct) < 0.1);
  const allSignsMatch = results.every(r => r.v13_sign_match);
  const maxV13Error = Math.max(...results.map(r => Math.abs(r.v13_error_pct)));
  const avgV13Error = results.reduce((s, r) => s + Math.abs(r.v13_error_pct), 0) / results.length;

  console.log(`All V13 errors < 0.1%: ${allV13Pass ? 'YES' : 'NO'}`);
  console.log(`All V13 signs match:   ${allSignsMatch ? 'YES' : 'NO'}`);
  console.log(`Max V13 error:         ${maxV13Error.toFixed(2)}%`);
  console.log(`Avg V13 error:         ${avgV13Error.toFixed(2)}%`);
  console.log('');

  if (allV13Pass && allSignsMatch) {
    console.log('GOAL ACHIEVED: V13 engine passes all tests!');
  } else {
    console.log('GOAL NOT MET: Further iteration required.');
    console.log('\nWallets failing criteria:');
    for (const r of results) {
      if (Math.abs(r.v13_error_pct) >= 0.1 || !r.v13_sign_match) {
        console.log(`  - ${r.wallet.name}: ${formatError(r.v13_error_pct)}${!r.v13_sign_match ? ' (SIGN MISMATCH)' : ''}`);
      }
    }
  }

  return results;
}

// =============================================================================
// ADD MORE GOLDEN WALLETS
// =============================================================================

async function discoverMoreWallets(limit: number = 20) {
  console.log('\n=== DISCOVERING TOP WALLETS FROM LEADERBOARD ===\n');

  // Get top wallets by volume from our data
  const query = `
    SELECT
      trader_wallet,
      count(DISTINCT event_id) as trades,
      sum(usdc_amount) / 1e6 as volume
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY trader_wallet
    ORDER BY volume DESC
    LIMIT {limit:UInt32}
  `;

  const result = await clickhouse.query({
    query,
    query_params: { limit },
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];

  console.log('Top wallets by volume:');
  for (const row of rows) {
    const wallet = row.trader_wallet;
    const volume = Number(row.volume);
    console.log(`  ${wallet.substring(0, 42)}: $${volume.toLocaleString()} volume, ${row.trades} trades`);
  }

  return rows;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--discover')) {
    await discoverMoreWallets(20);
  } else {
    await runAllTests();
  }
}

main().catch(console.error);
