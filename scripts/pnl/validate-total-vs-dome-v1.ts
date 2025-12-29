/**
 * Validate TOTAL vs DOME V1
 *
 * Uses Dome API as ground truth for total PnL validation.
 *
 * Formula being tested:
 *   our_total = net_cashflow + open_value
 *
 * Ground truth:
 *   dome_total_pnl = pnl_to_date from Dome API
 *
 * We check 3 wallet keys:
 *   1. EOA (scraped address from benchmarks)
 *   2. proxyWallet (from positions API)
 *   3. Both should be checked against Dome
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const SAMPLE_SIZE = 20;
const REQUEST_DELAY_MS = 300;
const DOME_API_KEY = '3850d9ac-1c76-4f94-b987-85c2b2d14c89';

interface DomeData {
  totalPnl: number | null;
  error?: string;
}

interface PositionData {
  openValue: number;
  proxyWallet: string | null;
}

interface ClobData {
  netCashflow: number;
  tradeCount: number;
}

interface ValidationResult {
  inputWallet: string;
  proxyWallet: string | null;
  // Dome truth
  domeTotalPnl: number | null;
  // Position data
  openValue: number;
  // CLOB data
  clobNetCashflowInput: number;
  clobTradeCountInput: number;
  clobNetCashflowProxy: number;
  clobTradeCountProxy: number;
  // Computed
  ourTotalInput: number;
  ourTotalProxy: number;
  // Deltas
  deltaInput: number | null;
  deltaProxy: number | null;
  pctDiffInput: number | null;
  pctDiffProxy: number | null;
  status: 'pass' | 'warn' | 'fail' | 'no_dome';
  betterKey: 'input' | 'proxy' | 'tie' | 'none';
}

async function fetchDomeTotalPnl(wallet: string): Promise<DomeData> {
  try {
    const url = `https://api.domeapi.io/v1/polymarket/wallet/pnl/${wallet}?granularity=all`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${DOME_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { totalPnl: null, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;
    if (!data.pnl_over_time?.length) {
      return { totalPnl: null, error: 'No PnL data' };
    }

    const latestPnl = data.pnl_over_time[data.pnl_over_time.length - 1].pnl_to_date;
    return { totalPnl: Number(latestPnl) || 0 };
  } catch (e: any) {
    return { totalPnl: null, error: e.message };
  }
}

async function fetchPositionData(wallet: string): Promise<PositionData> {
  try {
    const url = `https://data-api.polymarket.com/positions?user=${wallet}`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { openValue: 0, proxyWallet: null };
    }

    const positions = (await response.json()) as any[];
    if (!Array.isArray(positions)) {
      return { openValue: 0, proxyWallet: null };
    }

    let openValue = 0;
    let proxyWallet: string | null = null;

    for (const pos of positions) {
      openValue += Number(pos.currentValue) || 0;
      if (!proxyWallet && pos.proxyWallet) {
        proxyWallet = pos.proxyWallet.toLowerCase();
      }
    }

    return { openValue, proxyWallet };
  } catch {
    return { openValue: 0, proxyWallet: null };
  }
}

async function fetchClobData(wallet: string): Promise<ClobData> {
  const query = `
    SELECT
      sum(
        case
          when side = 'buy'  then -(usdc_amount + fee_amount)
          when side = 'sell' then  (usdc_amount - fee_amount)
          else 0
        end
      ) / 1e6 as net_cashflow,
      count(*) as trade_count
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    if (rows.length === 0) {
      return { netCashflow: 0, tradeCount: 0 };
    }
    return {
      netCashflow: Number(rows[0].net_cashflow) || 0,
      tradeCount: Number(rows[0].trade_count) || 0,
    };
  } catch {
    return { netCashflow: 0, tradeCount: 0 };
  }
}

async function getSampleWallets(): Promise<string[]> {
  const query = `
    SELECT DISTINCT wallet_address
    FROM pm_ui_pnl_benchmarks_v2
    WHERE status = 'success'
    ORDER BY abs(ui_pnl_value) DESC
    LIMIT ${SAMPLE_SIZE}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => r.wallet_address.toLowerCase());
}

function classifyResult(pctDiffInput: number | null, pctDiffProxy: number | null): {
  status: 'pass' | 'warn' | 'fail' | 'no_dome';
  betterKey: 'input' | 'proxy' | 'tie' | 'none';
} {
  if (pctDiffInput === null && pctDiffProxy === null) {
    return { status: 'no_dome', betterKey: 'none' };
  }

  const absInput = pctDiffInput !== null ? Math.abs(pctDiffInput) : Infinity;
  const absProxy = pctDiffProxy !== null ? Math.abs(pctDiffProxy) : Infinity;
  const bestDiff = Math.min(absInput, absProxy);

  let status: 'pass' | 'warn' | 'fail' | 'no_dome';
  if (bestDiff < 5) status = 'pass';
  else if (bestDiff < 20) status = 'warn';
  else status = 'fail';

  let betterKey: 'input' | 'proxy' | 'tie' | 'none';
  if (absInput < 5 && absProxy < 5) betterKey = 'tie';
  else if (absInput < absProxy) betterKey = 'input';
  else if (absProxy < absInput) betterKey = 'proxy';
  else betterKey = 'tie';

  return { status, betterKey };
}

async function main() {
  console.log('='.repeat(80));
  console.log('VALIDATE TOTAL vs DOME V1');
  console.log('='.repeat(80));
  console.log('');
  console.log('Formula: our_total = net_cashflow + open_value');
  console.log('Ground truth: Dome API pnl_to_date');
  console.log('');

  const wallets = await getSampleWallets();
  console.log(`Testing ${wallets.length} wallets\n`);

  const results: ValidationResult[] = [];

  console.log(' # | wallet       | Dome Total | Our(Input) | Our(Proxy) | Diff(I) | Diff(P) | Status');
  console.log('-'.repeat(95));

  for (let i = 0; i < wallets.length; i++) {
    const inputWallet = wallets[i];

    // Fetch all data in parallel
    const [domeData, posData, clobInput] = await Promise.all([
      fetchDomeTotalPnl(inputWallet),
      fetchPositionData(inputWallet),
      fetchClobData(inputWallet),
    ]);

    // Fetch CLOB for proxy wallet if different
    let clobProxy: ClobData = clobInput;
    if (posData.proxyWallet && posData.proxyWallet !== inputWallet) {
      clobProxy = await fetchClobData(posData.proxyWallet);
    }

    // Compute our totals
    const ourTotalInput = clobInput.netCashflow + posData.openValue;
    const ourTotalProxy = clobProxy.netCashflow + posData.openValue;

    // Compute deltas vs Dome
    let deltaInput: number | null = null;
    let deltaProxy: number | null = null;
    let pctDiffInput: number | null = null;
    let pctDiffProxy: number | null = null;

    if (domeData.totalPnl !== null) {
      deltaInput = ourTotalInput - domeData.totalPnl;
      deltaProxy = ourTotalProxy - domeData.totalPnl;
      pctDiffInput =
        Math.abs(domeData.totalPnl) > 1
          ? (deltaInput / Math.abs(domeData.totalPnl)) * 100
          : deltaInput === 0
            ? 0
            : 9999;
      pctDiffProxy =
        Math.abs(domeData.totalPnl) > 1
          ? (deltaProxy / Math.abs(domeData.totalPnl)) * 100
          : deltaProxy === 0
            ? 0
            : 9999;
    }

    const { status, betterKey } = classifyResult(pctDiffInput, pctDiffProxy);

    results.push({
      inputWallet,
      proxyWallet: posData.proxyWallet,
      domeTotalPnl: domeData.totalPnl,
      openValue: posData.openValue,
      clobNetCashflowInput: clobInput.netCashflow,
      clobTradeCountInput: clobInput.tradeCount,
      clobNetCashflowProxy: clobProxy.netCashflow,
      clobTradeCountProxy: clobProxy.tradeCount,
      ourTotalInput,
      ourTotalProxy,
      deltaInput,
      deltaProxy,
      pctDiffInput,
      pctDiffProxy,
      status,
      betterKey,
    });

    // Log progress
    const domeStr = domeData.totalPnl !== null ? `$${domeData.totalPnl.toFixed(0)}`.padStart(10) : 'NO DATA'.padStart(10);
    const ourInputStr = `$${ourTotalInput.toFixed(0)}`.padStart(10);
    const ourProxyStr = `$${ourTotalProxy.toFixed(0)}`.padStart(10);
    const diffIStr = pctDiffInput !== null ? `${pctDiffInput.toFixed(0)}%`.padStart(7) : 'N/A'.padStart(7);
    const diffPStr = pctDiffProxy !== null ? `${pctDiffProxy.toFixed(0)}%`.padStart(7) : 'N/A'.padStart(7);

    console.log(
      `${(i + 1).toString().padStart(2)} | ${inputWallet.slice(0, 10)}... | ${domeStr} | ${ourInputStr} | ${ourProxyStr} | ${diffIStr} | ${diffPStr} | ${status.toUpperCase()}`
    );

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const withDome = results.filter((r) => r.domeTotalPnl !== null);
  const passCount = withDome.filter((r) => r.status === 'pass').length;
  const warnCount = withDome.filter((r) => r.status === 'warn').length;
  const failCount = withDome.filter((r) => r.status === 'fail').length;
  const noDomeCount = results.filter((r) => r.status === 'no_dome').length;

  console.log(`\nValidation Results (N=${withDome.length} with Dome data):`);
  console.log(`  PASS (<5% diff):  ${passCount} (${((passCount / withDome.length) * 100).toFixed(1)}%)`);
  console.log(`  WARN (5-20%):     ${warnCount} (${((warnCount / withDome.length) * 100).toFixed(1)}%)`);
  console.log(`  FAIL (>20%):      ${failCount} (${((failCount / withDome.length) * 100).toFixed(1)}%)`);
  console.log(`  No Dome data:     ${noDomeCount}`);

  // Analyze direction of errors
  const inputBetter = withDome.filter((r) => r.betterKey === 'input').length;
  const proxyBetter = withDome.filter((r) => r.betterKey === 'proxy').length;
  const tie = withDome.filter((r) => r.betterKey === 'tie').length;

  console.log(`\nBetter Wallet Key:`);
  console.log(`  Input EOA:   ${inputBetter}`);
  console.log(`  Proxy:       ${proxyBetter}`);
  console.log(`  Tie:         ${tie}`);

  // Analyze cashflow direction
  const positiveInput = withDome.filter((r) => r.deltaInput !== null && r.deltaInput > 0).length;
  const negativeInput = withDome.filter((r) => r.deltaInput !== null && r.deltaInput < 0).length;

  console.log(`\nDelta Direction (Our vs Dome):`);
  console.log(`  Our > Dome (positive delta): ${positiveInput}`);
  console.log(`  Our < Dome (negative delta): ${negativeInput}`);

  // Sample cases
  console.log('\n--- Sample Cases (3 best, 3 worst) ---');

  const sorted = [...withDome].sort((a, b) => {
    const aMin = Math.min(
      Math.abs(a.pctDiffInput ?? Infinity),
      Math.abs(a.pctDiffProxy ?? Infinity)
    );
    const bMin = Math.min(
      Math.abs(b.pctDiffInput ?? Infinity),
      Math.abs(b.pctDiffProxy ?? Infinity)
    );
    return aMin - bMin;
  });

  const best3 = sorted.slice(0, 3);
  const worst3 = sorted.slice(-3).reverse();

  console.log('\nBEST MATCHES:');
  for (const r of best3) {
    console.log(`  ${r.inputWallet}:`);
    console.log(`    Dome Total: $${r.domeTotalPnl?.toFixed(2)}`);
    console.log(`    Open Value: $${r.openValue.toFixed(2)}`);
    console.log(`    CLOB cashflow (input): $${r.clobNetCashflowInput.toFixed(2)} (${r.clobTradeCountInput} trades)`);
    console.log(`    Our Total: $${r.ourTotalInput.toFixed(2)} (diff: ${r.pctDiffInput?.toFixed(1)}%)`);
  }

  console.log('\nWORST MATCHES:');
  for (const r of worst3) {
    console.log(`  ${r.inputWallet}:`);
    console.log(`    Dome Total: $${r.domeTotalPnl?.toFixed(2)}`);
    console.log(`    Open Value: $${r.openValue.toFixed(2)}`);
    console.log(`    CLOB cashflow (input): $${r.clobNetCashflowInput.toFixed(2)} (${r.clobTradeCountInput} trades)`);
    console.log(`    Our Total: $${r.ourTotalInput.toFixed(2)} (diff: ${r.pctDiffInput?.toFixed(1)}%)`);
    console.log(`    Proxy wallet: ${r.proxyWallet || 'same'}`);
    if (r.proxyWallet && r.proxyWallet !== r.inputWallet) {
      console.log(`    CLOB cashflow (proxy): $${r.clobNetCashflowProxy.toFixed(2)} (${r.clobTradeCountProxy} trades)`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Validation complete.');
}

main().catch(console.error);
