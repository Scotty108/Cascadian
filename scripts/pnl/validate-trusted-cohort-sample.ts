/**
 * Validate Trusted Cohort Sample
 *
 * Samples wallets from pm_wallet_metrics_trusted_v1 and validates against V11_POLY.
 * This confirms our SQL-only formula matches the verified engine.
 *
 * Validation criteria:
 * - Within 5%: PASS
 * - Within 20%: WARN
 * - Above 20%: FAIL
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';

const SAMPLE_SIZE = 20;
const MAX_TRADES = 500; // Limit trades to keep validation fast

interface ValidationResult {
  wallet: string;
  sqlPnl: number;
  v11Pnl: number;
  delta: number;
  pctDiff: number;
  status: 'PASS' | 'WARN' | 'FAIL';
}

async function validateWallet(wallet: string): Promise<{ pnl: number; error?: string }> {
  try {
    const loadResult = await loadPolymarketPnlEventsForWallet(wallet, {
      includeSyntheticRedemptions: true,
    });
    const pnlResult = computeWalletPnlFromEvents(wallet, loadResult.events);
    return { pnl: pnlResult.realizedPnl };
  } catch (e: any) {
    return { pnl: 0, error: e.message?.slice(0, 50) };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('VALIDATE TRUSTED COHORT SAMPLE');
  console.log('='.repeat(80));

  // Check metrics table exists
  const checkQuery = `SELECT count() as cnt FROM pm_wallet_metrics_trusted_v1`;
  let count = 0;
  try {
    const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
    count = (await checkResult.json() as any[])[0]?.cnt || 0;
  } catch {
    console.log('\nERROR: pm_wallet_metrics_trusted_v1 does not exist. Run build-trusted-metrics-v1 first.');
    return;
  }

  console.log(`\nMetrics table has ${count.toLocaleString()} wallets`);

  // Sample wallets with varying PnL levels
  console.log(`\nSampling ${SAMPLE_SIZE} wallets with < ${MAX_TRADES} fills...`);

  const sampleQuery = `
    SELECT
      wallet,
      fill_count,
      realized_pnl as sql_pnl,
      resolved_positions,
      win_rate
    FROM pm_wallet_metrics_trusted_v1
    WHERE fill_count BETWEEN 20 AND ${MAX_TRADES}
      AND resolved_positions >= 3
      AND realized_pnl != 0
    ORDER BY rand()
    LIMIT ${SAMPLE_SIZE}
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json() as any[];

  console.log(`\nValidating ${samples.length} wallets...\n`);
  console.log(' # | wallet       | fills | SQL PnL     | V11 PnL     | Delta    | Status');
  console.log('-'.repeat(85));

  const results: ValidationResult[] = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const { pnl: v11Pnl, error } = await validateWallet(sample.wallet);

    const sqlPnl = Number(sample.sql_pnl);
    const delta = v11Pnl - sqlPnl;
    const pctDiff = sqlPnl !== 0 ? Math.abs(delta) / Math.abs(sqlPnl) * 100 : (delta === 0 ? 0 : 100);

    let status: 'PASS' | 'WARN' | 'FAIL';
    if (error) {
      status = 'FAIL';
    } else if (pctDiff <= 5) {
      status = 'PASS';
    } else if (pctDiff <= 20) {
      status = 'WARN';
    } else {
      status = 'FAIL';
    }

    results.push({ wallet: sample.wallet, sqlPnl, v11Pnl, delta, pctDiff, status });

    const sqlStr = sqlPnl >= 0 ? `$${sqlPnl.toFixed(0)}` : `-$${Math.abs(sqlPnl).toFixed(0)}`;
    const v11Str = v11Pnl >= 0 ? `$${v11Pnl.toFixed(0)}` : `-$${Math.abs(v11Pnl).toFixed(0)}`;
    const deltaStr = delta >= 0 ? `+$${delta.toFixed(0)}` : `-$${Math.abs(delta).toFixed(0)}`;

    console.log(
      `${(i + 1).toString().padStart(2)} | ${sample.wallet.slice(0, 10)}... | ${sample.fill_count.toString().padStart(5)} | ${sqlStr.padStart(10)} | ${v11Str.padStart(10)} | ${deltaStr.padStart(8)} | ${status}${error ? ' (ERR)' : ''}`
    );
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n  PASS (<5% diff):  ${passed}/${results.length} (${(passed / results.length * 100).toFixed(1)}%)`);
  console.log(`  WARN (5-20% diff): ${warned}/${results.length}`);
  console.log(`  FAIL (>20% diff):  ${failed}/${results.length}`);

  const avgDiff = results.reduce((sum, r) => sum + r.pctDiff, 0) / results.length;
  console.log(`\n  Average difference: ${avgDiff.toFixed(1)}%`);

  if (passed / results.length >= 0.8) {
    console.log('\n  COHORT VALIDATION: PASSED (80%+ within 5% tolerance)');
  } else if ((passed + warned) / results.length >= 0.8) {
    console.log('\n  COHORT VALIDATION: ACCEPTABLE (80%+ within 20% tolerance)');
  } else {
    console.log('\n  COHORT VALIDATION: FAILED - Review formula or filtering');
  }

  // Show W2 if in sample
  const w2 = results.find(r => r.wallet.toLowerCase() === '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838');
  if (w2) {
    console.log(`\n  W2 benchmark: SQL=$${w2.sqlPnl.toFixed(2)}, V11=$${w2.v11Pnl.toFixed(2)}, ${w2.status}`);
  }
}

main().catch(console.error);
