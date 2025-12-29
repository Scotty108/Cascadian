/**
 * Validate TOTAL Identity V1
 *
 * Uses Polymarket APIs (not scraping) to validate our CLOB-based total PnL formula.
 *
 * Formula being tested:
 *   our_total = net_cashflow + open_value
 *
 * Validation target:
 *   api_total_pnl = sum(cashPnl) + sum(realizedPnl) from positions API
 *
 * We check 3 wallet keys:
 *   1. EOA (scraped address from benchmarks)
 *   2. proxyWallet (from positions API)
 *   3. canonical (from CLOB data trader_wallet)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const SAMPLE_SIZE = 30;
const REQUEST_DELAY_MS = 500;

interface ApiPositionData {
  openValue: number;
  unrealizedPnl: number; // cashPnl
  realizedPnl: number;
  apiTotalPnl: number; // unrealized + realized
  proxyWallet: string | null;
  positionsCount: number;
}

interface ClobData {
  netCashflow: number;
  tradeCount: number;
}

interface ValidationResult {
  inputWallet: string;
  proxyWallet: string | null;
  // API data
  apiOpenValue: number;
  apiUnrealizedPnl: number;
  apiRealizedPnl: number;
  apiTotalPnl: number;
  positionsCount: number;
  // CLOB data for input wallet
  clobNetCashflowInput: number;
  clobTradeCountInput: number;
  // CLOB data for proxy wallet
  clobNetCashflowProxy: number;
  clobTradeCountProxy: number;
  // Computed totals
  ourTotalInput: number; // clobNetCashflowInput + apiOpenValue
  ourTotalProxy: number; // clobNetCashflowProxy + apiOpenValue
  // Deltas
  deltaInput: number;
  deltaProxy: number;
  pctDiffInput: number;
  pctDiffProxy: number;
  // Status
  status: 'pass' | 'warn' | 'fail';
  betterKey: 'input' | 'proxy' | 'tie' | 'neither';
}

async function fetchPositionData(wallet: string): Promise<ApiPositionData | null> {
  try {
    const url = `https://data-api.polymarket.com/positions?user=${wallet}`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return null;
    }

    const positions = (await response.json()) as any[];
    if (!Array.isArray(positions)) {
      return null;
    }

    let openValue = 0;
    let unrealizedPnl = 0;
    let realizedPnl = 0;
    let proxyWallet: string | null = null;

    for (const pos of positions) {
      openValue += Number(pos.currentValue) || 0;
      unrealizedPnl += Number(pos.cashPnl) || 0;
      realizedPnl += Number(pos.realizedPnl) || 0;
      if (!proxyWallet && pos.proxyWallet) {
        proxyWallet = pos.proxyWallet.toLowerCase();
      }
    }

    return {
      openValue,
      unrealizedPnl,
      realizedPnl,
      apiTotalPnl: unrealizedPnl + realizedPnl,
      proxyWallet,
      positionsCount: positions.length,
    };
  } catch (e: any) {
    console.error(`  Positions API error for ${wallet}: ${e.message}`);
    return null;
  }
}

async function fetchClobData(wallet: string): Promise<ClobData> {
  // Use the confirmed net_cashflow formula with fees
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
  } catch (e: any) {
    console.error(`  CLOB query error for ${wallet}: ${e.message}`);
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

function classifyResult(
  pctDiffInput: number,
  pctDiffProxy: number
): { status: 'pass' | 'warn' | 'fail'; betterKey: 'input' | 'proxy' | 'tie' | 'neither' } {
  const absInput = Math.abs(pctDiffInput);
  const absProxy = Math.abs(pctDiffProxy);
  const bestDiff = Math.min(absInput, absProxy);

  let status: 'pass' | 'warn' | 'fail';
  if (bestDiff < 5) status = 'pass';
  else if (bestDiff < 20) status = 'warn';
  else status = 'fail';

  let betterKey: 'input' | 'proxy' | 'tie' | 'neither';
  if (absInput < 5 && absProxy < 5) betterKey = 'tie';
  else if (absInput < absProxy) betterKey = 'input';
  else if (absProxy < absInput) betterKey = 'proxy';
  else betterKey = 'tie';

  return { status, betterKey };
}

async function main() {
  console.log('='.repeat(80));
  console.log('VALIDATE TOTAL IDENTITY V1 - API-Based');
  console.log('='.repeat(80));
  console.log('');
  console.log('Formula: our_total = net_cashflow + open_value');
  console.log('Target:  api_total_pnl = sum(cashPnl) + sum(realizedPnl)');
  console.log('');

  // Get sample wallets
  console.log(`Fetching ${SAMPLE_SIZE} wallets from benchmarks...`);
  const wallets = await getSampleWallets();
  console.log(`Found ${wallets.length} wallets\n`);

  const results: ValidationResult[] = [];

  console.log(' # | wallet       | API Total  | Our(Input) | Our(Proxy) | Diff(I) | Diff(P) | Status');
  console.log('-'.repeat(95));

  for (let i = 0; i < wallets.length; i++) {
    const inputWallet = wallets[i];

    // 1. Fetch API position data
    const apiData = await fetchPositionData(inputWallet);

    if (!apiData || apiData.positionsCount === 0) {
      console.log(`${(i + 1).toString().padStart(2)} | ${inputWallet.slice(0, 10)}... | NO DATA`);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      continue;
    }

    // 2. Fetch CLOB data for input wallet
    const clobInput = await fetchClobData(inputWallet);

    // 3. Fetch CLOB data for proxy wallet (if different)
    let clobProxy: ClobData = { netCashflow: 0, tradeCount: 0 };
    if (apiData.proxyWallet && apiData.proxyWallet !== inputWallet) {
      clobProxy = await fetchClobData(apiData.proxyWallet);
    } else {
      clobProxy = clobInput; // Same wallet
    }

    // 4. Compute our totals
    const ourTotalInput = clobInput.netCashflow + apiData.openValue;
    const ourTotalProxy = clobProxy.netCashflow + apiData.openValue;

    // 5. Compute deltas
    const deltaInput = ourTotalInput - apiData.apiTotalPnl;
    const deltaProxy = ourTotalProxy - apiData.apiTotalPnl;
    const pctDiffInput =
      Math.abs(apiData.apiTotalPnl) > 0.01
        ? (deltaInput / Math.abs(apiData.apiTotalPnl)) * 100
        : deltaInput === 0
          ? 0
          : 9999;
    const pctDiffProxy =
      Math.abs(apiData.apiTotalPnl) > 0.01
        ? (deltaProxy / Math.abs(apiData.apiTotalPnl)) * 100
        : deltaProxy === 0
          ? 0
          : 9999;

    // 6. Classify
    const { status, betterKey } = classifyResult(pctDiffInput, pctDiffProxy);

    const result: ValidationResult = {
      inputWallet,
      proxyWallet: apiData.proxyWallet,
      apiOpenValue: apiData.openValue,
      apiUnrealizedPnl: apiData.unrealizedPnl,
      apiRealizedPnl: apiData.realizedPnl,
      apiTotalPnl: apiData.apiTotalPnl,
      positionsCount: apiData.positionsCount,
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
    };
    results.push(result);

    // Log progress
    const apiTotalStr = `$${apiData.apiTotalPnl.toFixed(0)}`.padStart(10);
    const ourInputStr = `$${ourTotalInput.toFixed(0)}`.padStart(10);
    const ourProxyStr = `$${ourTotalProxy.toFixed(0)}`.padStart(10);
    const diffIStr = `${pctDiffInput.toFixed(0)}%`.padStart(7);
    const diffPStr = `${pctDiffProxy.toFixed(0)}%`.padStart(7);
    const statusStr = status.toUpperCase();

    console.log(
      `${(i + 1).toString().padStart(2)} | ${inputWallet.slice(0, 10)}... | ${apiTotalStr} | ${ourInputStr} | ${ourProxyStr} | ${diffIStr} | ${diffPStr} | ${statusStr}`
    );

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const passCount = results.filter((r) => r.status === 'pass').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;
  const failCount = results.filter((r) => r.status === 'fail').length;

  const inputBetterCount = results.filter((r) => r.betterKey === 'input').length;
  const proxyBetterCount = results.filter((r) => r.betterKey === 'proxy').length;
  const tieCount = results.filter((r) => r.betterKey === 'tie').length;

  console.log(`\nValidation Results (N=${results.length}):`);
  console.log(`  PASS (<5% diff):  ${passCount} (${((passCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`  WARN (5-20%):     ${warnCount} (${((warnCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`  FAIL (>20%):      ${failCount} (${((failCount / results.length) * 100).toFixed(1)}%)`);

  console.log(`\nBetter Wallet Key:`);
  console.log(`  Input EOA:   ${inputBetterCount}`);
  console.log(`  Proxy:       ${proxyBetterCount}`);
  console.log(`  Tie:         ${tieCount}`);

  // Detailed pass cases
  if (passCount > 0) {
    console.log('\n--- PASS Cases (for verification) ---');
    results
      .filter((r) => r.status === 'pass')
      .slice(0, 5)
      .forEach((r) => {
        console.log(`  ${r.inputWallet}:`);
        console.log(`    API Total: $${r.apiTotalPnl.toFixed(2)}`);
        console.log(`    Our Total (input): $${r.ourTotalInput.toFixed(2)} (${r.pctDiffInput.toFixed(1)}%)`);
        console.log(`    Our Total (proxy): $${r.ourTotalProxy.toFixed(2)} (${r.pctDiffProxy.toFixed(1)}%)`);
        console.log(`    CLOB trades: ${r.clobTradeCountInput} (input), ${r.clobTradeCountProxy} (proxy)`);
      });
  }

  // Sample fail cases
  if (failCount > 0) {
    console.log('\n--- Sample FAIL Cases (for debugging) ---');
    results
      .filter((r) => r.status === 'fail')
      .slice(0, 3)
      .forEach((r) => {
        console.log(`  ${r.inputWallet}:`);
        console.log(`    Proxy: ${r.proxyWallet || 'same'}`);
        console.log(`    API: openValue=$${r.apiOpenValue.toFixed(2)}, unrealized=$${r.apiUnrealizedPnl.toFixed(2)}, realized=$${r.apiRealizedPnl.toFixed(2)}`);
        console.log(`    API Total: $${r.apiTotalPnl.toFixed(2)}`);
        console.log(`    CLOB cashflow (input): $${r.clobNetCashflowInput.toFixed(2)} (${r.clobTradeCountInput} trades)`);
        console.log(`    CLOB cashflow (proxy): $${r.clobNetCashflowProxy.toFixed(2)} (${r.clobTradeCountProxy} trades)`);
        console.log(`    Our Total (input): $${r.ourTotalInput.toFixed(2)} (${r.pctDiffInput.toFixed(1)}%)`);
        console.log(`    Our Total (proxy): $${r.ourTotalProxy.toFixed(2)} (${r.pctDiffProxy.toFixed(1)}%)`);
      });
  }

  console.log('\n' + '='.repeat(80));
  console.log('Validation complete.');
}

main().catch(console.error);
