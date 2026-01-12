/**
 * 500-Wallet Smart Validation Script
 *
 * Tests getWalletPnLWithConfidence() on 500 stratified wallets
 * - Uses single fast query for wallet selection
 * - Runs sequentially to avoid timeouts
 * - Saves results incrementally every 25 wallets
 * - Compares V1/V1+ (auto-selected) to API
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletPnLWithConfidence, getNegRiskConversionCount } from '../lib/pnl/pnlEngineV1';
import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

const TOTAL_WALLETS = 500;
const API_DELAY_MS = 150;

interface WalletResult {
  wallet: string;
  cohort: string;
  apiPnl: number | null;
  calculatedPnl: number;
  gap: number | null;
  engineUsed: 'V1' | 'V1+';
  confidence: 'high' | 'medium' | 'low';
  confidenceReasons: string[];
  diagnostics: {
    negRiskConversions: number;
    negRiskTokens: number;
    phantomTokens: number;
    phantomPercent: number;
    unexplainedPhantom: number;
    selfFillTxs: number;
    openPositions: number;
    totalPositions: number;
    ctfSplitMergeCount: number;
    ctfSplitTokens: number;
    erc1155InboundCount: number;
    recentTradeCount: number;
    largestPositionPct: number;
    resolvedPositionPct: number;
    totalTradeCount: number;
    avgTradeUsd: number;
  };
  status: 'PASS' | 'CLOSE' | 'FAIL' | 'ERR';
  duration: number;
}

interface ValidationReport {
  startTime: string;
  endTime: string;
  completed: number;
  total: number;
  summary: {
    pass: number;
    close: number;
    fail: number;
    err: number;
    passRate: number;
    avgGap: number;
    byConfidence: {
      high: { count: number; passRate: number };
      medium: { count: number; passRate: number };
      low: { count: number; passRate: number };
    };
    byEngine: {
      V1: { count: number; passRate: number };
      'V1+': { count: number; passRate: number };
    };
  };
  results: WalletResult[];
}

async function getApiPnL(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (!res.ok) return null;
    const data = await res.json() as Array<{ t: number; p: number }>;
    if (!data || data.length === 0) return null;
    return data[data.length - 1]?.p || 0;
  } catch {
    return null;
  }
}

async function selectWallets(): Promise<Array<{ wallet: string; cohort: string }>> {
  console.log('Selecting 500 stratified wallets...\n');

  const wallets: Array<{ wallet: string; cohort: string }> = [];

  // Fast stratified selection - 6 cohorts, ~85 each
  const cohortQueries = [
    {
      cohort: 'maker_heavy',
      query: `
        SELECT lower(trader_wallet) as wallet
        FROM pm_trader_events_v3
        WHERE trade_time > now() - INTERVAL 180 DAY
        GROUP BY wallet
        HAVING count() >= 20 AND countIf(role = 'maker') / count() > 0.7
        ORDER BY rand()
        LIMIT 85
      `
    },
    {
      cohort: 'taker_heavy',
      query: `
        SELECT lower(trader_wallet) as wallet
        FROM pm_trader_events_v3
        WHERE trade_time > now() - INTERVAL 180 DAY
        GROUP BY wallet
        HAVING count() >= 20 AND countIf(role = 'taker') / count() > 0.7
        ORDER BY rand()
        LIMIT 85
      `
    },
    {
      cohort: 'mixed',
      query: `
        SELECT lower(trader_wallet) as wallet
        FROM pm_trader_events_v3
        WHERE trade_time > now() - INTERVAL 180 DAY
        GROUP BY wallet
        HAVING count() >= 20 AND countIf(role = 'maker') / count() BETWEEN 0.3 AND 0.7
        ORDER BY rand()
        LIMIT 85
      `
    },
    {
      cohort: 'high_volume',
      query: `
        SELECT lower(trader_wallet) as wallet
        FROM pm_trader_events_v3
        GROUP BY wallet
        HAVING count() >= 50 AND sum(usdc_amount) / 1e6 > 50000
        ORDER BY rand()
        LIMIT 85
      `
    },
    {
      cohort: 'medium_volume',
      query: `
        SELECT lower(trader_wallet) as wallet
        FROM pm_trader_events_v3
        GROUP BY wallet
        HAVING count() >= 20 AND sum(usdc_amount) / 1e6 BETWEEN 5000 AND 50000
        ORDER BY rand()
        LIMIT 85
      `
    },
    {
      cohort: 'low_volume',
      query: `
        SELECT lower(trader_wallet) as wallet
        FROM pm_trader_events_v3
        GROUP BY wallet
        HAVING count() BETWEEN 10 AND 50 AND sum(usdc_amount) / 1e6 BETWEEN 100 AND 5000
        ORDER BY rand()
        LIMIT 85
      `
    },
  ];

  for (const { cohort, query } of cohortQueries) {
    try {
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = await result.json() as any[];
      console.log(`  ${cohort}: ${rows.length} wallets`);
      for (const row of rows) {
        wallets.push({ wallet: row.wallet, cohort });
      }
    } catch (err) {
      console.error(`  ${cohort}: ERROR - ${err instanceof Error ? err.message : err}`);
    }
  }

  // Dedupe
  const seen = new Set<string>();
  const deduped = wallets.filter(w => {
    if (seen.has(w.wallet)) return false;
    seen.add(w.wallet);
    return true;
  });

  // Shuffle and take 500
  const shuffled = deduped.sort(() => Math.random() - 0.5);
  console.log(`\n  Total unique: ${deduped.length}, taking ${Math.min(TOTAL_WALLETS, shuffled.length)}\n`);

  return shuffled.slice(0, TOTAL_WALLETS);
}

function calculateSummary(results: WalletResult[]): ValidationReport['summary'] {
  const withApi = results.filter(r => r.apiPnl !== null);
  const pass = results.filter(r => r.status === 'PASS').length;
  const close = results.filter(r => r.status === 'CLOSE').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const err = results.filter(r => r.status === 'ERR').length;

  const avgGap = withApi.length > 0
    ? withApi.reduce((sum, r) => sum + (r.gap || 0), 0) / withApi.length
    : 0;

  const byConfidence = {
    high: { count: 0, passRate: 0 },
    medium: { count: 0, passRate: 0 },
    low: { count: 0, passRate: 0 },
  };

  for (const conf of ['high', 'medium', 'low'] as const) {
    const group = results.filter(r => r.confidence === conf && r.apiPnl !== null);
    byConfidence[conf].count = group.length;
    byConfidence[conf].passRate = group.length > 0
      ? Math.round((group.filter(r => r.status === 'PASS').length / group.length) * 100)
      : 0;
  }

  const byEngine = {
    'V1': { count: 0, passRate: 0 },
    'V1+': { count: 0, passRate: 0 },
  };

  for (const eng of ['V1', 'V1+'] as const) {
    const group = results.filter(r => r.engineUsed === eng && r.apiPnl !== null);
    byEngine[eng].count = group.length;
    byEngine[eng].passRate = group.length > 0
      ? Math.round((group.filter(r => r.status === 'PASS').length / group.length) * 100)
      : 0;
  }

  return {
    pass,
    close,
    fail,
    err,
    passRate: withApi.length > 0 ? Math.round((pass / withApi.length) * 100) : 0,
    avgGap: Math.round(avgGap * 100) / 100,
    byConfidence,
    byEngine,
  };
}

async function main() {
  const startTime = new Date().toISOString();
  const timestamp = startTime.replace(/[:.]/g, '-');
  const outputFile = `scripts/validation-500-${timestamp}.json`;

  console.log('='.repeat(70));
  console.log('500-WALLET SMART VALIDATION');
  console.log(`Started: ${startTime}`);
  console.log(`Output: ${outputFile}`);
  console.log('='.repeat(70));

  // Select wallets
  const wallets = await selectWallets();
  if (wallets.length === 0) {
    console.error('No wallets selected!');
    process.exit(1);
  }

  console.log(`\nProcessing ${wallets.length} wallets...\n`);
  const avgTimePerWallet = 45; // seconds estimate
  const etaMinutes = Math.round((wallets.length * avgTimePerWallet) / 60);
  console.log(`Estimated time: ~${etaMinutes} minutes (${Math.round(etaMinutes/60*10)/10} hours)\n`);

  const results: WalletResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const { wallet, cohort } = wallets[i];
    const start = Date.now();

    // Show which wallet we're starting
    process.stdout.write(`[${i + 1}/${wallets.length}] ${wallet.slice(0, 10)}... ${cohort.padEnd(14)} `);

    try {
      // Get API PnL
      const apiPnl = await getApiPnL(wallet);

      // Get calculated PnL with confidence
      const pnlResult = await getWalletPnLWithConfidence(wallet);

      const duration = (Date.now() - start) / 1000;
      const gap = apiPnl !== null ? Math.abs(apiPnl - pnlResult.total) : null;

      let status: 'PASS' | 'CLOSE' | 'FAIL' | 'ERR';
      if (apiPnl === null) {
        status = 'ERR';
      } else if (gap! <= 10) {
        status = 'PASS';
      } else if (gap! <= 100) {
        status = 'CLOSE';
      } else {
        status = 'FAIL';
      }

      const result: WalletResult = {
        wallet,
        cohort,
        apiPnl,
        calculatedPnl: pnlResult.total,
        gap,
        engineUsed: pnlResult.engineUsed,
        confidence: pnlResult.confidence,
        confidenceReasons: pnlResult.confidenceReasons,
        diagnostics: pnlResult.diagnostics,
        status,
        duration,
      };

      results.push(result);

      // Complete the line with results
      const icon = status === 'PASS' ? '✓' : status === 'CLOSE' ? '~' : status === 'FAIL' ? '✗' : '?';
      const confIcon = pnlResult.confidence[0].toUpperCase();
      console.log(
        `${icon} Gap=$${gap?.toFixed(0) || 'N/A'} ` +
        `[${confIcon}|${pnlResult.engineUsed}|NR:${pnlResult.diagnostics.negRiskConversions}] ` +
        `(${duration.toFixed(1)}s)`
      );

      // Rate limit
      await new Promise(r => setTimeout(r, API_DELAY_MS));

    } catch (err) {
      const duration = (Date.now() - start) / 1000;
      console.log(`ERR (${duration.toFixed(1)}s) - ${err instanceof Error ? err.message.slice(0, 50) : 'Unknown'}`);

      results.push({
        wallet,
        cohort,
        apiPnl: null,
        calculatedPnl: 0,
        gap: null,
        engineUsed: 'V1',
        confidence: 'low',
        confidenceReasons: [`Error: ${err instanceof Error ? err.message : 'Unknown'}`],
        diagnostics: {
          negRiskConversions: 0, negRiskTokens: 0, phantomTokens: 0, phantomPercent: 0,
          unexplainedPhantom: 0, selfFillTxs: 0, openPositions: 0, totalPositions: 0,
          ctfSplitMergeCount: 0, ctfSplitTokens: 0, erc1155InboundCount: 0,
          recentTradeCount: 0, largestPositionPct: 0, resolvedPositionPct: 0, totalTradeCount: 0, avgTradeUsd: 0
        },
        status: 'ERR',
        duration,
      });
    }

    // Save progress every 25 wallets
    if ((i + 1) % 25 === 0 || i === wallets.length - 1) {
      const report: ValidationReport = {
        startTime,
        endTime: new Date().toISOString(),
        completed: results.length,
        total: wallets.length,
        summary: calculateSummary(results),
        results,
      };
      fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));

      if ((i + 1) % 50 === 0) {
        const elapsed = (Date.now() - new Date(startTime).getTime()) / 1000;
        const avgPerWallet = elapsed / results.length;
        const remaining = wallets.length - results.length;
        const etaMinutes = Math.round((remaining * avgPerWallet) / 60);
        console.log(`\n--- Progress: ${results.length}/${wallets.length} | Pass: ${report.summary.passRate}% | Avg Gap: $${report.summary.avgGap} | ETA: ${etaMinutes}min ---\n`);
      }
    }
  }

  // Final summary
  const summary = calculateSummary(results);

  console.log('\n' + '='.repeat(70));
  console.log('FINAL RESULTS');
  console.log('='.repeat(70));
  console.log(`\nTotal: ${results.length} | PASS: ${summary.pass} | CLOSE: ${summary.close} | FAIL: ${summary.fail} | ERR: ${summary.err}`);
  console.log(`Pass Rate: ${summary.passRate}% | Avg Gap: $${summary.avgGap}`);
  console.log(`\nBy Confidence:`);
  console.log(`  HIGH:   ${summary.byConfidence.high.count} wallets, ${summary.byConfidence.high.passRate}% pass`);
  console.log(`  MEDIUM: ${summary.byConfidence.medium.count} wallets, ${summary.byConfidence.medium.passRate}% pass`);
  console.log(`  LOW:    ${summary.byConfidence.low.count} wallets, ${summary.byConfidence.low.passRate}% pass`);
  console.log(`\nBy Engine:`);
  console.log(`  V1:  ${summary.byEngine.V1.count} wallets, ${summary.byEngine.V1.passRate}% pass`);
  console.log(`  V1+: ${summary.byEngine['V1+'].count} wallets, ${summary.byEngine['V1+'].passRate}% pass`);
  console.log(`\nResults saved to: ${outputFile}`);
}

main().catch(console.error);
