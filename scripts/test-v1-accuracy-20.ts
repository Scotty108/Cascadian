import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { clickhouse } from '../lib/clickhouse/client';

async function getPM(wallet: string): Promise<number | null> {
  try {
    const res = await fetch('https://user-pnl-api.polymarket.com/user-pnl?user_address=' + wallet);
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[data.length - 1].p : null;
  } catch (e) {
    console.error(`Error fetching PM API for ${wallet}:`, e);
    return null;
  }
}

async function get20RandomWallets(): Promise<string[]> {
  const query = `
    SELECT wallet
    FROM pm_copy_trading_candidates_v1
    WHERE trade_count >= 30
    ORDER BY rand()
    LIMIT 20
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => r.wallet);
}

interface TestResult {
  wallet: string;
  v1Pnl: number;
  pmPnl: number | null;
  errorPct: number | null;
  within10Pct: boolean;
  confidence: string;
}

async function main() {
  console.log('Fetching 20 random wallets from pm_copy_trading_candidates_v1 (trade_count >= 30)...\n');

  const wallets = await get20RandomWallets();
  console.log(`Found ${wallets.length} wallets\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    console.log(`[${i + 1}/20] Testing ${wallet}...`);

    try {
      const [v1Result, pmPnl] = await Promise.all([getWalletPnLV1(wallet), getPM(wallet)]);

      const v1Pnl = v1Result.total;

      let errorPct: number | null = null;
      let within10Pct = false;

      if (pmPnl !== null && pmPnl !== 0) {
        errorPct = Math.abs((v1Pnl - pmPnl) / Math.abs(pmPnl)) * 100;
        within10Pct = errorPct <= 10;
      } else if (pmPnl === 0 && Math.abs(v1Pnl) < 1) {
        // Both essentially zero
        errorPct = 0;
        within10Pct = true;
      } else if (pmPnl === 0) {
        // PM is 0 but V1 is not
        errorPct = 100;
        within10Pct = false;
      }

      results.push({
        wallet,
        v1Pnl,
        pmPnl,
        errorPct,
        within10Pct,
        confidence: v1Result.confidence,
      });

      console.log(
        `   V1: $${v1Pnl.toFixed(2)}, PM: ${pmPnl !== null ? '$' + pmPnl.toFixed(2) : 'N/A'}, Error: ${errorPct !== null ? errorPct.toFixed(1) + '%' : 'N/A'}, ${within10Pct ? 'PASS' : 'FAIL'}`
      );
    } catch (e) {
      console.error(`   Error testing ${wallet}:`, e);
      results.push({
        wallet,
        v1Pnl: 0,
        pmPnl: null,
        errorPct: null,
        within10Pct: false,
        confidence: 'error',
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(120));
  console.log(
    'Wallet'.padEnd(44) +
      'V1 PnL'.padStart(14) +
      'PM PnL'.padStart(14) +
      'Error %'.padStart(12) +
      'Status'.padStart(10) +
      'Confidence'.padStart(12)
  );
  console.log('-'.repeat(120));

  for (const r of results) {
    const v1Str = '$' + r.v1Pnl.toFixed(2);
    const pmStr = r.pmPnl !== null ? '$' + r.pmPnl.toFixed(2) : 'N/A';
    const errorStr = r.errorPct !== null ? r.errorPct.toFixed(1) + '%' : 'N/A';
    const statusStr = r.within10Pct ? 'PASS' : 'FAIL';

    console.log(
      r.wallet.padEnd(44) +
        v1Str.padStart(14) +
        pmStr.padStart(14) +
        errorStr.padStart(12) +
        statusStr.padStart(10) +
        r.confidence.padStart(12)
    );
  }

  console.log('-'.repeat(120));

  const validResults = results.filter((r) => r.errorPct !== null);
  const passing = validResults.filter((r) => r.within10Pct).length;
  const total = validResults.length;
  const accuracy = total > 0 ? ((passing / total) * 100).toFixed(1) : '0';

  console.log(`\nACCURACY: ${passing}/${total} wallets within 10% error (${accuracy}%)`);

  // Breakdown by confidence
  const highConf = results.filter((r) => r.confidence === 'high');
  const medConf = results.filter((r) => r.confidence === 'medium');
  const lowConf = results.filter((r) => r.confidence === 'low');

  const highPass = highConf.filter((r) => r.within10Pct).length;
  const medPass = medConf.filter((r) => r.within10Pct).length;
  const lowPass = lowConf.filter((r) => r.within10Pct).length;

  console.log(`\nBy Confidence Level:`);
  console.log(`  High confidence:   ${highPass}/${highConf.length} pass`);
  console.log(`  Medium confidence: ${medPass}/${medConf.length} pass`);
  console.log(`  Low confidence:    ${lowPass}/${lowConf.length} pass`);

  // Error distribution
  const errors = validResults.map((r) => r.errorPct!).sort((a, b) => a - b);
  if (errors.length > 0) {
    const median = errors[Math.floor(errors.length / 2)];
    const avg = errors.reduce((a, b) => a + b, 0) / errors.length;
    console.log(`\nError Distribution:`);
    console.log(`  Min:    ${errors[0].toFixed(1)}%`);
    console.log(`  Median: ${median.toFixed(1)}%`);
    console.log(`  Avg:    ${avg.toFixed(1)}%`);
    console.log(`  Max:    ${errors[errors.length - 1].toFixed(1)}%`);
  }
}

main().catch(console.error);
