/**
 * Phase 0: Validate SQL Formula vs Polymarket UI
 *
 * CRITICAL: This script must pass before proceeding with V1 implementation.
 * Tests the existing SQL views against the 9 test wallets.
 *
 * Pass criteria:
 * - Simple wallets (W1-W6): ALL must be <5% error
 * - Complex wallets (EGG, WHALE, NEW): Document why they fail
 *
 * Terminal: Claude 1
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// Test wallets with UI PnL values
const TEST_WALLETS = [
  // In-scope: Must pass <5% tolerance
  { label: 'W2', address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', uiPnl: 4404.92, tolerance: 0.05, inScope: true },
  { label: 'W1', address: '0x9d36c904930a7d06c5403f9e16996e919f586486', uiPnl: -6138.90, tolerance: 0.05, inScope: true },
  { label: 'W3', address: '0x418db17eaa8f25eaf2085657d0becd82462c6786', uiPnl: 5.44, tolerance: 0.05, inScope: true },
  { label: 'W4', address: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', uiPnl: -294.61, tolerance: 0.05, inScope: true },
  { label: 'W5', address: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', uiPnl: 146.90, tolerance: 0.05, inScope: true },
  { label: 'W6', address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', uiPnl: 470.40, tolerance: 0.05, inScope: true },

  // Out-of-scope: Document failure reason, don't require pass
  { label: 'EGG', address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', uiPnl: 95976, tolerance: null, inScope: false, reason: 'AMM-heavy' },
  { label: 'WHALE', address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', uiPnl: 22053934, tolerance: null, inScope: false, reason: 'Holdings-dominated' },
  { label: 'NEW', address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', uiPnl: -10021172, tolerance: null, inScope: false, reason: 'Mixed complexity' },
];

interface WalletResult {
  label: string;
  address: string;
  uiPnl: number;
  ourPnl: number | null;
  difference: number | null;
  percentError: number | null;
  passed: boolean | null;
  inScope: boolean;
  reason?: string;
}

async function validateWallet(wallet: typeof TEST_WALLETS[0]): Promise<WalletResult> {
  try {
    // Query the existing view for this wallet
    const result = await client.query({
      query: `
        SELECT
          SUM(realized_pnl) as total_pnl
        FROM vw_pm_realized_pnl_v5
        WHERE wallet_address = {wallet:String}
          AND is_resolved = 1
      `,
      query_params: { wallet: wallet.address },
      format: 'JSONEachRow'
    });

    const rows = await result.json() as any[];
    const ourPnl = rows[0]?.total_pnl ?? null;

    if (ourPnl === null) {
      return {
        label: wallet.label,
        address: wallet.address,
        uiPnl: wallet.uiPnl,
        ourPnl: null,
        difference: null,
        percentError: null,
        passed: null,
        inScope: wallet.inScope,
        reason: wallet.inScope ? 'No data found' : (wallet as any).reason,
      };
    }

    const difference = ourPnl - wallet.uiPnl;
    const percentError = Math.abs(difference / wallet.uiPnl);

    let passed: boolean | null = null;
    if (wallet.inScope && wallet.tolerance !== null) {
      passed = percentError <= wallet.tolerance;
    }

    return {
      label: wallet.label,
      address: wallet.address,
      uiPnl: wallet.uiPnl,
      ourPnl,
      difference,
      percentError,
      passed,
      inScope: wallet.inScope,
      reason: wallet.inScope ? undefined : (wallet as any).reason,
    };
  } catch (error) {
    return {
      label: wallet.label,
      address: wallet.address,
      uiPnl: wallet.uiPnl,
      ourPnl: null,
      difference: null,
      percentError: null,
      passed: false,
      inScope: wallet.inScope,
      reason: `Query error: ${error}`,
    };
  }
}

function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  if (value === null) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

async function main() {
  console.log('');
  console.log('='.repeat(100));
  console.log('PHASE 0: SQL FORMULA VALIDATION');
  console.log('='.repeat(100));
  console.log('');
  console.log('Testing vw_pm_realized_pnl_v5 against 9 test wallets');
  console.log('In-scope wallets must pass <5% error threshold');
  console.log('');

  const results: WalletResult[] = [];

  // Test each wallet sequentially to avoid rate limits
  for (const wallet of TEST_WALLETS) {
    const result = await validateWallet(wallet);
    results.push(result);
  }

  // Print results table
  console.log('Label  | Scope    | UI PnL       | Our PnL      | Error     | Status');
  console.log('-'.repeat(80));

  let inScopePassed = 0;
  let inScopeFailed = 0;

  for (const r of results) {
    const scopeStr = r.inScope ? 'IN-SCOPE' : 'OUT';
    const statusStr = r.inScope
      ? (r.passed === true ? 'PASS' : r.passed === false ? 'FAIL' : 'ERROR')
      : r.reason || 'N/A';

    if (r.inScope) {
      if (r.passed) inScopePassed++;
      else inScopeFailed++;
    }

    console.log(
      `${r.label.padEnd(7)}| ${scopeStr.padEnd(9)}| ${formatCurrency(r.uiPnl).padStart(12)} | ${formatCurrency(r.ourPnl).padStart(12)} | ${formatPercent(r.percentError).padStart(9)} | ${statusStr}`
    );
  }

  console.log('-'.repeat(80));
  console.log('');

  // Summary
  console.log('=== PHASE 0 SUMMARY ===');
  console.log('');
  console.log(`In-scope wallets: ${inScopePassed + inScopeFailed}`);
  console.log(`  Passed (<5% error): ${inScopePassed}`);
  console.log(`  Failed (>5% error): ${inScopeFailed}`);
  console.log('');

  if (inScopeFailed === 0 && inScopePassed > 0) {
    console.log('PHASE 0 PASSED - All in-scope wallets within tolerance');
    console.log('Proceeding to Phase 1 is safe.');
    process.exit(0);
  } else if (inScopeFailed > 0) {
    console.log('PHASE 0 FAILED - Some in-scope wallets exceeded tolerance');
    console.log('');
    console.log('STOP: Fix the SQL formula before proceeding to Phase 1.');
    console.log('');
    console.log('Failed wallets:');
    for (const r of results) {
      if (r.inScope && r.passed === false) {
        console.log(`  - ${r.label}: ${formatPercent(r.percentError)} error (${r.reason || 'threshold exceeded'})`);
      }
    }
    process.exit(1);
  } else {
    console.log('PHASE 0 INCONCLUSIVE - No data returned for in-scope wallets');
    console.log('');
    console.log('Check if vw_pm_realized_pnl_v5 has data for these wallets.');
    process.exit(1);
  }

  await client.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
