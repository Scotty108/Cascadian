/**
 * Omega Ratio Leaderboard using V8 Engine
 *
 * V8 pre-loads all resolutions, making it fast for batch processing.
 * Calculates Omega for top 100/50/10 wallets by volume.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import { createV8Engine, WalletMetricsV8 } from '@/lib/pnl/uiActivityEngineV8';

interface WalletOmega {
  wallet: string;
  pnl_total: number;
  gain: number;
  loss: number;
  omega_ratio: number;
  volume_traded: number;
  fills_count: number;
  roi_percent: number;
}

function calculateOmega(gain: number, loss: number): number {
  const absLoss = Math.abs(loss);
  if (absLoss === 0) {
    return gain > 0 ? Infinity : 0;
  }
  return gain / absLoss;
}

async function getWalletsByVolume(
  minTrades: number,
  maxTrades: number,
  minVolume: number,
  maxVolume: number,
  limit: number
): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        sum(usdc_amount) / 1000000.0 as volume
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY trader_wallet
      HAVING trades >= ${minTrades} AND trades <= ${maxTrades}
        AND volume >= ${minVolume} AND volume <= ${maxVolume}
      ORDER BY volume DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  return rows.map((r) => r.wallet);
}

function analyzeResults(results: WalletOmega[]) {
  const validResults = results.filter(
    (r) => r.omega_ratio !== Infinity && !isNaN(r.omega_ratio) && r.omega_ratio > 0
  );

  // Sort by Omega
  const byOmega = [...validResults].sort((a, b) => b.omega_ratio - a.omega_ratio);

  // Sort by PnL
  const byPnl = [...results].sort((a, b) => b.pnl_total - a.pnl_total);

  console.log('\n' + '='.repeat(90));
  console.log('TOP 10 BY OMEGA RATIO');
  console.log('='.repeat(90));
  console.log(
    'Rank | Wallet                                     | Omega  | PnL        | Volume       | ROI%'
  );
  console.log('-'.repeat(90));

  byOmega.slice(0, 10).forEach((w, i) => {
    const omegaStr = w.omega_ratio.toFixed(2).padStart(6);
    console.log(
      `${(i + 1).toString().padStart(4)} | ${w.wallet} | ${omegaStr} | $${w.pnl_total.toFixed(0).padStart(9)} | $${w.volume_traded.toFixed(0).padStart(11)} | ${w.roi_percent.toFixed(1)}%`
    );
  });

  console.log('\n' + '='.repeat(90));
  console.log('TOP 10 BY ABSOLUTE PNL');
  console.log('='.repeat(90));
  console.log(
    'Rank | Wallet                                     | PnL        | Omega  | Volume       | ROI%'
  );
  console.log('-'.repeat(90));

  byPnl.slice(0, 10).forEach((w, i) => {
    const omegaStr =
      w.omega_ratio === Infinity ? '∞' : w.omega_ratio.toFixed(2).padStart(6);
    console.log(
      `${(i + 1).toString().padStart(4)} | ${w.wallet} | $${w.pnl_total.toFixed(0).padStart(9)} | ${omegaStr} | $${w.volume_traded.toFixed(0).padStart(11)} | ${w.roi_percent.toFixed(1)}%`
    );
  });

  // Aggregate stats
  const top10 = byOmega.slice(0, 10);
  const top50 = byOmega.slice(0, 50);
  const top100 = byOmega.slice(0, 100);

  const avgOmega = (arr: WalletOmega[]) =>
    arr.length > 0 ? arr.reduce((s, w) => s + w.omega_ratio, 0) / arr.length : 0;
  const avgPnl = (arr: WalletOmega[]) =>
    arr.length > 0 ? arr.reduce((s, w) => s + w.pnl_total, 0) / arr.length : 0;
  const avgRoi = (arr: WalletOmega[]) =>
    arr.length > 0 ? arr.reduce((s, w) => s + w.roi_percent, 0) / arr.length : 0;
  const totalPnl = (arr: WalletOmega[]) => arr.reduce((s, w) => s + w.pnl_total, 0);

  console.log('\n' + '='.repeat(90));
  console.log('AGGREGATE STATISTICS');
  console.log('='.repeat(90));
  console.log('Tier    | Count | Avg Omega | Avg PnL      | Avg ROI   | Total PnL');
  console.log('-'.repeat(90));
  console.log(
    `Top 10  | ${top10.length.toString().padStart(5)} | ${avgOmega(top10).toFixed(2).padStart(9)} | $${avgPnl(top10).toFixed(0).padStart(11)} | ${avgRoi(top10).toFixed(1).padStart(7)}% | $${totalPnl(top10).toFixed(0)}`
  );
  if (top50.length >= 10) {
    console.log(
      `Top 50  | ${top50.length.toString().padStart(5)} | ${avgOmega(top50).toFixed(2).padStart(9)} | $${avgPnl(top50).toFixed(0).padStart(11)} | ${avgRoi(top50).toFixed(1).padStart(7)}% | $${totalPnl(top50).toFixed(0)}`
    );
  }
  if (top100.length >= 10) {
    console.log(
      `Top 100 | ${top100.length.toString().padStart(5)} | ${avgOmega(top100).toFixed(2).padStart(9)} | $${avgPnl(top100).toFixed(0).padStart(11)} | ${avgRoi(top100).toFixed(1).padStart(7)}% | $${totalPnl(top100).toFixed(0)}`
    );
  }

  // Win rate
  const profitable = results.filter((r) => r.pnl_total > 0).length;
  const losing = results.filter((r) => r.pnl_total < 0).length;
  console.log(`\nWin Rate: ${profitable}/${results.length} (${((profitable / results.length) * 100).toFixed(1)}%)`);
  console.log(`Losers: ${losing}/${results.length} (${((losing / results.length) * 100).toFixed(1)}%)`);
}

async function main() {
  console.log('='.repeat(90));
  console.log('OMEGA RATIO LEADERBOARD - V8 ENGINE');
  console.log('='.repeat(90));
  console.log('Mode: Asymmetric (conservative - safe for leaderboards)');
  console.log('');

  // Initialize V8 engine (loads all resolutions)
  console.log('Initializing V8 engine...');
  const engine = await createV8Engine();
  const stats = engine.getCacheStats();
  console.log(`Resolution cache: ${stats.resolutionCount.toLocaleString()} entries\n`);

  // Get mid-tier wallets (not market makers, but active traders)
  // 50-500 trades, $5k-$100k volume - smaller for faster testing
  console.log('Finding wallets: 50-500 trades, $5k-$100k volume...');
  const wallets = await getWalletsByVolume(50, 500, 5000, 100000, 120);
  console.log(`Found ${wallets.length} wallets\n`);

  if (wallets.length === 0) {
    console.log('No wallets found matching criteria');
    return;
  }

  // Calculate Omega for all wallets
  console.log('Calculating PnL for all wallets...');
  const startTime = Date.now();

  const metricsResults = await engine.computeBatch(
    wallets,
    { mode: 'asymmetric' },
    5,
    (completed, total) => {
      process.stdout.write(`\rProgress: ${completed}/${total} wallets`);
    }
  );
  console.log('');

  const elapsed = Date.now() - startTime;
  console.log(`\nCompleted in ${(elapsed / 1000).toFixed(1)} seconds`);
  console.log(`Average: ${(elapsed / metricsResults.length).toFixed(0)}ms per wallet`);

  // Convert to Omega format
  const omegaResults: WalletOmega[] = metricsResults.map((m) => ({
    wallet: m.wallet,
    pnl_total: m.pnl_total,
    gain: m.gain,
    loss: m.loss,
    omega_ratio: calculateOmega(m.gain, m.loss),
    volume_traded: m.volume_traded,
    fills_count: m.fills_count,
    roi_percent: m.volume_traded > 0 ? (m.pnl_total / m.volume_traded) * 100 : 0,
  }));

  // Analyze and display
  analyzeResults(omegaResults);

  console.log('\n' + '='.repeat(90));
  console.log('COMPLETE');
  console.log('='.repeat(90));
}

main().catch(console.error);
