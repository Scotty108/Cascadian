/**
 * 50-Wallet Stratified Validation
 *
 * Tests pnlEngineV1 (with MTM) against Polymarket API across key cohorts.
 *
 * Improvements based on GPT advice:
 * 1. Proper API latest point selection
 * 2. Mark price coverage metrics
 * 3. NegRisk flag tracking
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

interface WalletProfile {
  wallet: string;
  cohort: string;
  trades: number;
  makerPct: number;
  ctfOps: number;
  openPositions: number;
  volume: number;
  hasNegRisk: boolean;
}

interface ValidationResult {
  wallet: string;
  cohort: string;
  calcPnl: number;
  apiPnl: number;
  error: number;
  absError: number;
  status: 'PASS' | 'CLOSE' | 'FAIL';
  openPositions: number;
  confidence: string;
  hasNegRisk: boolean;
  markCoverage?: number;
}

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        // GPT advice: Make sure we get the LATEST point
        const sorted = [...data].sort((a, b) => b.t - a.t);
        return sorted[0].p || 0;
      }
    }
  } catch {}
  return 0;
}

// Check if wallet has NegRisk activity
async function hasNegRiskActivity(wallet: string): Promise<boolean> {
  const query = `
    SELECT count() > 0 as has_negrisk
    FROM pm_neg_risk_conversions_v1
    WHERE lower(sender) = '${wallet.toLowerCase()}'
    LIMIT 1
  `;
  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    return rows[0]?.has_negrisk || false;
  } catch {
    return false;
  }
}

// Get mark price coverage for open positions
async function getMarkCoverage(wallet: string): Promise<{ covered: number; total: number; coverage: number }> {
  const query = `
    WITH positions AS (
      SELECT DISTINCT m.condition_id, m.outcome_index
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id AND r.is_deleted = 0
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id != ''
        AND (r.payout_numerators = '' OR r.payout_numerators IS NULL)  -- Open only
    )
    SELECT
      count() as total,
      countIf(mp.mark_price IS NOT NULL AND mp.mark_price > 0) as covered
    FROM positions p
    LEFT JOIN pm_latest_mark_price_v1 mp ON p.condition_id = mp.condition_id AND p.outcome_index = mp.outcome_index
  `;
  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    const total = Number(rows[0]?.total) || 0;
    const covered = Number(rows[0]?.covered) || 0;
    return { covered, total, coverage: total > 0 ? covered / total : 1 };
  } catch {
    return { covered: 0, total: 0, coverage: 1 };
  }
}

async function selectWallets(): Promise<WalletProfile[]> {
  console.log('Selecting wallets for each cohort...\n');

  // Query 1: Maker-heavy wallets (8)
  const makerQuery = `
    SELECT wallet, trades, maker_pct, volume, ctf_ops, open_positions FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        countIf(role = 'maker') / count() as maker_pct,
        sum(usdc_amount) / 1e6 as volume,
        0 as ctf_ops,
        0 as open_positions
      FROM pm_trader_events_v3
      GROUP BY wallet
      HAVING trades >= 50 AND trades <= 500 AND maker_pct > 0.7
    )
    ORDER BY rand() LIMIT 8
  `;

  // Query 2: Taker-heavy wallets (8)
  const takerQuery = `
    SELECT wallet, trades, maker_pct, volume, ctf_ops, open_positions FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        countIf(role = 'maker') / count() as maker_pct,
        sum(usdc_amount) / 1e6 as volume,
        0 as ctf_ops,
        0 as open_positions
      FROM pm_trader_events_v3
      GROUP BY wallet
      HAVING trades >= 50 AND trades <= 500 AND maker_pct < 0.3
    )
    ORDER BY rand() LIMIT 8
  `;

  // Query 3: Mixed wallets (8)
  const mixedQuery = `
    SELECT wallet, trades, maker_pct, volume, ctf_ops, open_positions FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        countIf(role = 'maker') / count() as maker_pct,
        sum(usdc_amount) / 1e6 as volume,
        0 as ctf_ops,
        0 as open_positions
      FROM pm_trader_events_v3
      GROUP BY wallet
      HAVING trades >= 50 AND trades <= 500 AND maker_pct >= 0.3 AND maker_pct <= 0.7
    )
    ORDER BY rand() LIMIT 8
  `;

  // Query 4: Wallets with open positions (10)
  const openQuery = `
    WITH open_wallets AS (
      SELECT lower(t.trader_wallet) as wallet
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id AND r.is_deleted = 0
      WHERE m.condition_id != '' AND (r.payout_numerators = '' OR r.payout_numerators IS NULL)
      GROUP BY wallet
      HAVING countDistinct(m.condition_id) BETWEEN 1 AND 10
    )
    SELECT wallet, trades, maker_pct, volume, ctf_ops, open_positions FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        countIf(role = 'maker') / count() as maker_pct,
        sum(usdc_amount) / 1e6 as volume,
        0 as ctf_ops,
        1 as open_positions
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) IN (SELECT wallet FROM open_wallets)
      GROUP BY wallet
      HAVING trades >= 30
    )
    ORDER BY rand() LIMIT 10
  `;

  // Query 5: CTF users (8)
  const ctfQuery = `
    WITH ctf_wallets AS (
      SELECT lower(wallet) as wallet, count() as ctf_ops
      FROM pm_ctf_split_merge_expanded
      GROUP BY wallet
      HAVING ctf_ops >= 2
    )
    SELECT wallet, trades, maker_pct, volume, ctf_ops, open_positions FROM (
      SELECT
        lower(t.trader_wallet) as wallet,
        count() as trades,
        countIf(t.role = 'maker') / count() as maker_pct,
        sum(t.usdc_amount) / 1e6 as volume,
        c.ctf_ops as ctf_ops,
        0 as open_positions
      FROM pm_trader_events_v3 t
      JOIN ctf_wallets c ON lower(t.trader_wallet) = c.wallet
      GROUP BY wallet, c.ctf_ops
      HAVING trades >= 30
    )
    ORDER BY rand() LIMIT 8
  `;

  // Query 6: Random sample (8)
  const randomQuery = `
    SELECT wallet, trades, maker_pct, volume, ctf_ops, open_positions FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        countIf(role = 'maker') / count() as maker_pct,
        sum(usdc_amount) / 1e6 as volume,
        0 as ctf_ops,
        0 as open_positions
      FROM pm_trader_events_v3
      GROUP BY wallet
      HAVING trades >= 50 AND trades <= 1000
    )
    ORDER BY rand() LIMIT 8
  `;

  const queries = [
    { query: makerQuery, cohort: 'maker_heavy' },
    { query: takerQuery, cohort: 'taker_heavy' },
    { query: mixedQuery, cohort: 'mixed' },
    { query: openQuery, cohort: 'open_positions' },
    { query: ctfQuery, cohort: 'ctf_users' },
    { query: randomQuery, cohort: 'random' },
  ];

  const wallets: WalletProfile[] = [];
  const usedWallets = new Set<string>();

  for (const { query, cohort } of queries) {
    try {
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = (await result.json()) as any[];

      for (const row of rows) {
        if (!usedWallets.has(row.wallet)) {
          usedWallets.add(row.wallet);
          wallets.push({
            wallet: row.wallet,
            cohort,
            trades: Number(row.trades),
            makerPct: Number(row.maker_pct),
            ctfOps: Number(row.ctf_ops),
            openPositions: Number(row.open_positions),
            volume: Number(row.volume),
            hasNegRisk: false,  // Will be checked later
          });
        }
      }
      console.log(`  ${cohort}: ${rows.length} wallets`);
    } catch (err) {
      console.log(`  ${cohort}: ERROR - ${err}`);
    }
  }

  console.log(`\nTotal: ${wallets.length} wallets\n`);
  return wallets;
}

async function validateWallet(profile: WalletProfile): Promise<ValidationResult> {
  // Check NegRisk
  const hasNegRisk = await hasNegRiskActivity(profile.wallet);

  // Get mark coverage for open positions
  let markCoverage = 1;
  if (profile.openPositions > 0) {
    const coverage = await getMarkCoverage(profile.wallet);
    markCoverage = coverage.coverage;
  }

  const [pnlResult, apiPnl] = await Promise.all([
    getWalletPnLV1(profile.wallet),
    getApiPnL(profile.wallet),
  ]);

  const calcPnl = pnlResult.totalPnl;
  const error = calcPnl - apiPnl;
  const absError = Math.abs(error);

  // Determine threshold based on conditions
  let passThreshold = 10;
  let closeThreshold = 100;

  if (pnlResult.openPositionCount > 0) {
    passThreshold = 50;  // More lenient for open (MTM timing)
    closeThreshold = 200;
  }
  if (markCoverage < 0.8) {
    passThreshold *= 2;  // Even more lenient if missing mark prices
    closeThreshold *= 2;
  }

  const status = absError <= passThreshold ? 'PASS' : absError <= closeThreshold ? 'CLOSE' : 'FAIL';

  return {
    wallet: profile.wallet,
    cohort: profile.cohort,
    calcPnl,
    apiPnl,
    error,
    absError,
    status,
    openPositions: pnlResult.openPositionCount,
    confidence: pnlResult.confidence,
    hasNegRisk,
    markCoverage,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('50-WALLET STRATIFIED VALIDATION');
  console.log('pnlEngineV1 (with MTM) vs Polymarket API');
  console.log('='.repeat(100));
  console.log('');

  const profiles = await selectWallets();

  if (profiles.length === 0) {
    console.log('ERROR: No wallets found');
    return;
  }

  console.log('Validating wallets...\n');
  const results: ValidationResult[] = [];

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}/${profiles.length}] ${profile.wallet.slice(0, 14)}... (${profile.cohort.padEnd(14)}) `);

    try {
      const result = await validateWallet(profile);
      results.push(result);

      const symbol = result.status === 'PASS' ? '✓' : result.status === 'CLOSE' ? '~' : '✗';
      const flags = [
        result.openPositions > 0 ? 'OPEN' : '',
        result.hasNegRisk ? 'NEGRISK' : '',
        result.markCoverage !== undefined && result.markCoverage < 1 ? `MARK:${(result.markCoverage * 100).toFixed(0)}%` : '',
      ].filter(Boolean).join(' ');

      console.log(`Calc: ${result.calcPnl.toFixed(2).padStart(10)} | API: ${result.apiPnl.toFixed(2).padStart(10)} | Err: ${result.error.toFixed(2).padStart(9)} | ${symbol} ${result.status} ${flags}`);
    } catch (err) {
      console.log(`ERROR: ${err}`);
    }

    await new Promise(r => setTimeout(r, 150));
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY BY COHORT');
  console.log('='.repeat(100));

  const cohorts = [...new Set(results.map(r => r.cohort))];
  for (const cohort of cohorts) {
    const cr = results.filter(r => r.cohort === cohort);
    const pass = cr.filter(r => r.status === 'PASS').length;
    const errors = cr.map(r => r.absError).sort((a, b) => a - b);
    const median = errors[Math.floor(errors.length / 2)] || 0;
    console.log(`\n${cohort.toUpperCase()} (${cr.length}): PASS ${pass}/${cr.length} (${(pass / cr.length * 100).toFixed(0)}%) | Median Err: $${median.toFixed(2)}`);

    const fails = cr.filter(r => r.status !== 'PASS');
    for (const f of fails) {
      console.log(`  ✗ ${f.wallet.slice(0, 14)}... Err: $${f.error.toFixed(2)} | Open: ${f.openPositions} | NegRisk: ${f.hasNegRisk}`);
    }
  }

  // Overall
  console.log('\n' + '='.repeat(100));
  console.log('OVERALL');
  console.log('='.repeat(100));

  const pass = results.filter(r => r.status === 'PASS').length;
  const close = results.filter(r => r.status === 'CLOSE').length;
  const fail = results.filter(r => r.status === 'FAIL').length;

  const closedOnly = results.filter(r => r.openPositions === 0);
  const openOnly = results.filter(r => r.openPositions > 0);
  const negRisk = results.filter(r => r.hasNegRisk);

  console.log(`\nTotal: ${results.length} | PASS: ${pass} | CLOSE: ${close} | FAIL: ${fail} | Rate: ${(pass / results.length * 100).toFixed(1)}%`);
  console.log(`Closed-only: ${closedOnly.filter(r => r.status === 'PASS').length}/${closedOnly.length} PASS`);
  console.log(`Open positions: ${openOnly.filter(r => r.status === 'PASS').length}/${openOnly.length} PASS`);
  console.log(`NegRisk wallets: ${negRisk.length} (${negRisk.filter(r => r.status === 'PASS').length} PASS)`);

  // Error distribution
  const allErrors = results.map(r => r.absError).sort((a, b) => a - b);
  console.log(`\nError Distribution:`);
  console.log(`  P25: $${allErrors[Math.floor(allErrors.length * 0.25)]?.toFixed(2) || 0}`);
  console.log(`  Median: $${allErrors[Math.floor(allErrors.length * 0.5)]?.toFixed(2) || 0}`);
  console.log(`  P75: $${allErrors[Math.floor(allErrors.length * 0.75)]?.toFixed(2) || 0}`);
  console.log(`  Max: $${allErrors[allErrors.length - 1]?.toFixed(2) || 0}`);

  // Save
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/validation-50-${timestamp}.json`, JSON.stringify({ results, summary: { pass, close, fail } }, null, 2));
  console.log(`\nSaved to: scripts/validation-50-${timestamp}.json`);
}

main().catch(console.error);
