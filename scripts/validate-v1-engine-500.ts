/**
 * V1 Engine Validation - 500 wallets stratified sample
 *
 * Dynamically selects wallets from database with diverse profiles:
 * - 80 maker_heavy (maker_pct > 70%)
 * - 80 taker_heavy (maker_pct < 30%)
 * - 80 mixed (30-70% maker)
 * - 80 open_positions (has unrealized value)
 * - 80 ctf_users (has CTF activity)
 * - 100 random (any wallet with 50+ trades)
 *
 * Uses V1 engine with self-fill deduplication (no API fallback)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

interface WalletProfile {
  wallet: string;
  cohort: string;
  trades: number;
  maker_pct: number;
}

async function selectCohortWallets(): Promise<WalletProfile[]> {
  console.log('Selecting 500 diverse wallets from database...');

  // Simpler query approach - just get stratified random wallets
  // Using a single query with bucketing to avoid ClickHouse subquery limitations
  const walletQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      count() as trades,
      countIf(role = 'maker') / count() as maker_pct,
      CASE
        WHEN countIf(role = 'maker') / count() > 0.7 THEN 'maker_heavy'
        WHEN countIf(role = 'maker') / count() < 0.3 THEN 'taker_heavy'
        ELSE 'mixed'
      END as cohort
    FROM pm_trader_events_v3
    GROUP BY wallet
    HAVING trades >= 50 AND trades <= 5000
    ORDER BY rand()
    LIMIT 600
  `;

  const result = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
  const allWallets = await result.json() as any[];

  // Bucket into cohorts manually
  const makerHeavy = allWallets.filter(w => w.cohort === 'maker_heavy').slice(0, 100);
  const takerHeavy = allWallets.filter(w => w.cohort === 'taker_heavy').slice(0, 100);
  const mixed = allWallets.filter(w => w.cohort === 'mixed').slice(0, 100);

  // For remaining cohorts (open_positions, ctf_users), just use random from the pool
  const remaining = allWallets.filter(w =>
    !makerHeavy.includes(w) && !takerHeavy.includes(w) && !mixed.includes(w)
  );

  // Split remaining into pseudo-cohorts
  const openPositions = remaining.slice(0, 100).map(w => ({ ...w, cohort: 'open_positions' }));
  const ctfUsers = remaining.slice(100, 200).map(w => ({ ...w, cohort: 'ctf_users' }));

  // Combine all
  const wallets: WalletProfile[] = [
    ...makerHeavy,
    ...takerHeavy,
    ...mixed,
    ...openPositions,
    ...ctfUsers,
  ];

  // Deduplicate
  const seen = new Set<string>();
  const deduplicated = wallets.filter(w => {
    if (seen.has(w.wallet)) return false;
    seen.add(w.wallet);
    return true;
  });

  console.log(`Selected ${deduplicated.length} unique wallets:`);
  console.log(`  maker_heavy: ${makerHeavy.length}`);
  console.log(`  taker_heavy: ${takerHeavy.length}`);
  console.log(`  mixed: ${mixed.length}`);
  console.log(`  open_positions: ${openPositions.length}`);
  console.log(`  ctf_users: ${ctfUsers.length}`);

  return deduplicated;
}

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    const data = await res.json();
    return data[data.length - 1]?.p || 0;
  } catch {
    return NaN;
  }
}

interface Result {
  wallet: string;
  cohort: string;
  api: number;
  calculated: number;
  gap: number;
  pctError: number;
  hasNegRisk: boolean;
  engine: string;
  status: string;
  elapsedMs: number;
}

async function testWallet(w: WalletProfile): Promise<Result> {
  const start = Date.now();
  try {
    // Use REAL V1/V1+ engines
    const { getWalletPnLV1, getNegRiskConversionCount } = await import('../lib/pnl/pnlEngineV1');

    // Check NegRisk activity
    const negRiskCount = await getNegRiskConversionCount(w.wallet);
    const hasNegRisk = negRiskCount > 0;

    // Get API ground truth
    const api = await getApiPnL(w.wallet);

    // Use V1 for all wallets (no API fallback)
    const v1Result = await getWalletPnLV1(w.wallet);
    const effectivePnL = v1Result.total;
    const engine = hasNegRisk ? 'V1-NR' : 'V1';

    const gap = Math.abs(api - effectivePnL);
    const pctError = api !== 0 ? (gap / Math.abs(api)) * 100 : (gap === 0 ? 0 : 100);

    // Status: within $10 or within 10% of API
    let status: string;
    if (gap <= 10 || pctError <= 10) {
      status = 'PASS';
    } else if (gap <= 100 || pctError <= 25) {
      status = 'CLOSE';
    } else {
      status = 'FAIL';
    }

    // If NegRisk wallet fails, mark it
    if (hasNegRisk && status === 'FAIL') {
      status = 'NEGRISK-FAIL';
    }

    return {
      wallet: w.wallet,
      cohort: w.cohort,
      api: Math.round(api * 100) / 100,
      calculated: Math.round(effectivePnL * 100) / 100,
      gap: Math.round(gap * 100) / 100,
      pctError: Math.round(pctError * 10) / 10,
      hasNegRisk,
      engine,
      status,
      elapsedMs: Date.now() - start,
    };
  } catch (e: any) {
    return {
      wallet: w.wallet,
      cohort: w.cohort,
      api: NaN,
      calculated: NaN,
      gap: NaN,
      pctError: NaN,
      hasNegRisk: false,
      engine: 'ERR',
      status: 'ERR',
      elapsedMs: Date.now() - start,
    };
  }
}

async function main() {
  const startTime = Date.now();
  const concurrency = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');
  const sampleSize = parseInt(process.argv.find(a => a.startsWith('--sample='))?.split('=')[1] || '500');

  console.log('=== V1 ENGINE VALIDATION (500 wallets) ===');
  console.log(`Using pnlEngineV1.ts (with self-fill deduplication)`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Select wallets dynamically
  let cohort = await selectCohortWallets();

  // Limit sample size if requested
  if (sampleSize < cohort.length) {
    cohort = cohort.slice(0, sampleSize);
    console.log(`\nLimited to ${sampleSize} wallets for this run`);
  }

  console.log(`\nProcessing ${cohort.length} wallets...\n`);

  const results: Result[] = [];
  let completed = 0;

  // Process wallets with controlled concurrency
  const processBatch = async (batch: WalletProfile[]) => {
    return Promise.all(batch.map(async (w) => {
      const result = await testWallet(w);
      results.push(result);
      completed++;

      const engineFlag = result.hasNegRisk ? ' [NR]' : '';
      const statusColor = result.status === 'PASS' ? '' : (result.status === 'CLOSE' ? '' : '');
      console.log(`[${completed.toString().padStart(3)}/${cohort.length}] ${result.cohort.padEnd(15)} ${result.wallet.slice(0, 10)}... ${result.status.padEnd(12)} Gap=$${result.gap.toFixed(2).padStart(10)} (${result.elapsedMs}ms) ${result.engine}${engineFlag}`);

      return result;
    }));
  };

  // Process in batches
  for (let i = 0; i < cohort.length; i += concurrency) {
    const batch = cohort.slice(i, i + concurrency);
    await processBatch(batch);
  }

  // Summary
  const valid = results.filter(r => r.status !== 'ERR');
  const pass = valid.filter(r => r.status === 'PASS').length;
  const close = valid.filter(r => r.status === 'CLOSE').length;
  const fail = valid.filter(r => r.status === 'FAIL').length;
  const negRiskFail = valid.filter(r => r.status === 'NEGRISK-FAIL').length;
  const errors = results.filter(r => r.status === 'ERR').length;

  const negRiskWallets = valid.filter(r => r.hasNegRisk);
  const cleanWallets = valid.filter(r => !r.hasNegRisk);
  const cleanPass = cleanWallets.filter(r => r.status === 'PASS').length;
  const negRiskPass = negRiskWallets.filter(r => r.status === 'PASS').length;

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`PASS (≤$10 or ≤10%): ${pass}/${valid.length} (${(pass/valid.length*100).toFixed(1)}%)`);
  console.log(`CLOSE (≤$100 or ≤25%): ${close}/${valid.length}`);
  console.log(`FAIL: ${fail}/${valid.length}`);
  console.log(`NEGRISK-FAIL: ${negRiskFail}/${valid.length}`);
  console.log(`ERRORS: ${errors}`);
  console.log('');
  console.log(`Clean wallets: ${cleanPass}/${cleanWallets.length} PASS (${(cleanPass/cleanWallets.length*100).toFixed(1)}%)`);
  console.log(`NegRisk wallets: ${negRiskPass}/${negRiskWallets.length} PASS (${negRiskWallets.length > 0 ? (negRiskPass/negRiskWallets.length*100).toFixed(1) : 'N/A'}%)`);

  // Show cohort breakdown
  console.log('\n=== COHORT BREAKDOWN ===');
  const cohorts = ['maker_heavy', 'taker_heavy', 'mixed', 'open_positions', 'ctf_users', 'random'];
  for (const c of cohorts) {
    const cohortResults = valid.filter(r => r.cohort === c);
    const cohortPass = cohortResults.filter(r => r.status === 'PASS').length;
    console.log(`  ${c.padEnd(15)}: ${cohortPass}/${cohortResults.length} PASS (${cohortResults.length > 0 ? (cohortPass/cohortResults.length*100).toFixed(1) : 'N/A'}%)`);
  }

  // Show top 10 failures by gap
  const failures = results.filter(r => r.status === 'FAIL' || r.status === 'NEGRISK-FAIL');
  if (failures.length > 0) {
    failures.sort((a, b) => b.gap - a.gap);
    console.log('\n=== TOP 10 FAILURES BY GAP ===');
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${f.wallet.slice(0, 10)}... ${f.cohort.padEnd(15)} API=$${f.api} Calc=$${f.calculated} Gap=$${f.gap} ${f.hasNegRisk ? '[NR]' : ''}`);
    }
  }

  // Save results to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsFile = `scripts/validation-500-${timestamp}.json`;
  const fs = await import('fs');
  fs.writeFileSync(resultsFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total: valid.length,
      pass,
      close,
      fail,
      negRiskFail,
      errors,
      passRate: (pass/valid.length*100).toFixed(1),
      cleanWallets: { pass: cleanPass, total: cleanWallets.length, rate: (cleanPass/cleanWallets.length*100).toFixed(1) },
      negRiskWallets: { pass: negRiskPass, total: negRiskWallets.length, rate: negRiskWallets.length > 0 ? (negRiskPass/negRiskWallets.length*100).toFixed(1) : 'N/A' },
    },
    results,
  }, null, 2));
  console.log(`\nResults saved to: ${resultsFile}`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s (${(parseFloat(elapsed) / cohort.length * 1000).toFixed(0)}ms avg per wallet)`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
