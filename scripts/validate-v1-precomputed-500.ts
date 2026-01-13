/**
 * V1 PRECOMPUTED Validation - 500 wallets using pm_canonical_fills_v4
 * Fast validation (~1-2s per wallet instead of ~30s)
 *
 * Uses precomputed canonical fills with self-fill deduplication already applied.
 * V1 formula: Realized PnL + Unrealized (MTM) PnL
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

  // Bucket into cohorts
  const makerHeavy = allWallets.filter(w => w.cohort === 'maker_heavy').slice(0, 100);
  const takerHeavy = allWallets.filter(w => w.cohort === 'taker_heavy').slice(0, 100);
  const mixed = allWallets.filter(w => w.cohort === 'mixed').slice(0, 100);

  const remaining = allWallets.filter(w =>
    !makerHeavy.includes(w) && !takerHeavy.includes(w) && !mixed.includes(w)
  );

  const openPositions = remaining.slice(0, 100).map(w => ({ ...w, cohort: 'open_positions' }));
  const ctfUsers = remaining.slice(100, 200).map(w => ({ ...w, cohort: 'ctf_users' }));

  const wallets: WalletProfile[] = [
    ...makerHeavy,
    ...takerHeavy,
    ...mixed,
    ...openPositions,
    ...ctfUsers,
  ];

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

interface PnLResult {
  realized: number;
  unrealized: number;
  total: number;
  hasNegRisk: boolean;
  marketCount: number;
}

/**
 * Calculate V1 PnL from precomputed canonical fills
 * This is fast (~1s) because the canonical fills table already has self-fill deduplication
 */
async function getWalletPnLPrecomputed(wallet: string): Promise<PnLResult> {
  const w = wallet.toLowerCase();

  // Single efficient query for V1 PnL with MTM
  const query = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(tokens_delta) as net_tokens,
        sum(usdc_delta) as cash_flow
      FROM pm_canonical_fills_v4 FINAL
      WHERE wallet = '${w}'
        AND source IN ('clob', 'ctf_token', 'ctf_cash')
      GROUP BY condition_id, outcome_index
    ),
    with_prices AS (
      SELECT
        p.*,
        r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
        toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won,
        mp.mark_price as current_mark_price,
        CASE
          WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' THEN 'realized'
          WHEN mp.mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as status
      FROM positions p
      LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(p.condition_id) = lower(mp.condition_id)
        AND p.outcome_index = mp.outcome_index
    ),
    by_status AS (
      SELECT
        status,
        sumIf(cash_flow + IF(net_tokens > 0 AND won, net_tokens, 0) - IF(net_tokens < 0 AND won, abs(net_tokens), 0), status = 'realized') as realized_pnl,
        sumIf(cash_flow + net_tokens * ifNull(current_mark_price, 0), status = 'unrealized') as unrealized_pnl,
        count() as market_count
      FROM with_prices
      GROUP BY status
    )
    SELECT
      sum(realized_pnl) as realized,
      sum(unrealized_pnl) as unrealized,
      sum(realized_pnl) + sum(unrealized_pnl) as total,
      sum(market_count) as market_count
    FROM by_status
  `;

  // Check for NegRisk activity in a separate quick query
  const negRiskQuery = `
    SELECT count() > 0 as has_negrisk
    FROM pm_canonical_fills_v4
    WHERE wallet = '${w}' AND source = 'negrisk'
    LIMIT 1
  `;

  const [pnlResult, negRiskResult] = await Promise.all([
    clickhouse.query({ query, format: 'JSONEachRow' }).then(r => r.json() as Promise<any[]>),
    clickhouse.query({ query: negRiskQuery, format: 'JSONEachRow' }).then(r => r.json() as Promise<any[]>),
  ]);

  const pnl = pnlResult[0] || { realized: 0, unrealized: 0, total: 0, market_count: 0 };
  const hasNegRisk = negRiskResult[0]?.has_negrisk === 1;

  return {
    realized: Number(pnl.realized) || 0,
    unrealized: Number(pnl.unrealized) || 0,
    total: Number(pnl.total) || 0,
    hasNegRisk,
    marketCount: Number(pnl.market_count) || 0,
  };
}

interface Result {
  wallet: string;
  cohort: string;
  api: number;
  calculated: number;
  gap: number;
  pctError: number;
  hasNegRisk: boolean;
  status: string;
  elapsedMs: number;
}

async function testWallet(w: WalletProfile): Promise<Result> {
  const start = Date.now();
  try {
    // Get precomputed V1 PnL (fast)
    const pnlResult = await getWalletPnLPrecomputed(w.wallet);

    // Get API ground truth
    const api = await getApiPnL(w.wallet);

    const gap = Math.abs(api - pnlResult.total);
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

    // Mark NegRisk failures separately
    if (pnlResult.hasNegRisk && status === 'FAIL') {
      status = 'NEGRISK-FAIL';
    }

    return {
      wallet: w.wallet,
      cohort: w.cohort,
      api: Math.round(api * 100) / 100,
      calculated: Math.round(pnlResult.total * 100) / 100,
      gap: Math.round(gap * 100) / 100,
      pctError: Math.round(pctError * 10) / 10,
      hasNegRisk: pnlResult.hasNegRisk,
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
      status: 'ERR',
      elapsedMs: Date.now() - start,
    };
  }
}

async function main() {
  const startTime = Date.now();
  const concurrency = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '10');
  const sampleSize = parseInt(process.argv.find(a => a.startsWith('--sample='))?.split('=')[1] || '500');

  console.log('=== V1 PRECOMPUTED VALIDATION (500 wallets) ===');
  console.log(`Using pm_canonical_fills_v4 (with self-fill deduplication)`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  let cohort = await selectCohortWallets();

  if (sampleSize < cohort.length) {
    cohort = cohort.slice(0, sampleSize);
    console.log(`\nLimited to ${sampleSize} wallets for this run`);
  }

  console.log(`\nProcessing ${cohort.length} wallets...\n`);

  const results: Result[] = [];
  let completed = 0;

  // Process in concurrent batches
  for (let i = 0; i < cohort.length; i += concurrency) {
    const batch = cohort.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (w) => {
      const result = await testWallet(w);
      completed++;

      const flag = result.hasNegRisk ? ' [NR]' : '';
      console.log(`[${completed.toString().padStart(3)}/${cohort.length}] ${result.cohort.padEnd(15)} ${result.wallet.slice(0, 10)}... ${result.status.padEnd(12)} Gap=$${result.gap.toFixed(2).padStart(10)} (${result.elapsedMs}ms)${flag}`);

      return result;
    }));
    results.push(...batchResults);
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

  // Cohort breakdown
  console.log('\n=== COHORT BREAKDOWN ===');
  const cohorts = ['maker_heavy', 'taker_heavy', 'mixed', 'open_positions', 'ctf_users'];
  for (const c of cohorts) {
    const cohortResults = valid.filter(r => r.cohort === c);
    const cohortPass = cohortResults.filter(r => r.status === 'PASS').length;
    console.log(`  ${c.padEnd(15)}: ${cohortPass}/${cohortResults.length} PASS (${cohortResults.length > 0 ? (cohortPass/cohortResults.length*100).toFixed(1) : 'N/A'}%)`);
  }

  // Top failures
  const failures = results.filter(r => r.status === 'FAIL' || r.status === 'NEGRISK-FAIL');
  if (failures.length > 0) {
    failures.sort((a, b) => b.gap - a.gap);
    console.log('\n=== TOP 10 FAILURES BY GAP ===');
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${f.wallet.slice(0, 10)}... ${f.cohort.padEnd(15)} API=$${f.api} Calc=$${f.calculated} Gap=$${f.gap} ${f.hasNegRisk ? '[NR]' : ''}`);
    }
  }

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsFile = `scripts/validation-precomputed-500-${timestamp}.json`;
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
