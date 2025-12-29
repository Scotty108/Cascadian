/**
 * Calculate Omega Ratios for Top Wallets
 *
 * Uses V7 asymmetric mode (safe for leaderboards)
 *
 * Omega Ratio = Sum of gains above threshold / Sum of losses below threshold
 * With threshold = 0: Omega = Total Gains / |Total Losses|
 *
 * Higher Omega = better risk-adjusted returns
 * Omega > 1 = profitable trader
 * Omega < 1 = losing trader
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import { computeWalletPnlV7 } from '@/lib/pnl/uiActivityEngineV7';

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

async function getTopWalletsByVolume(limit: number): Promise<string[]> {
  console.log(`Finding top ${limit} wallets by volume...`);

  // Use a faster query - sample from recent high-volume traders
  // This avoids a full table scan
  const result = await clickhouse.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        count() as trade_count,
        sum(usdc_amount) / 1000000.0 as total_volume
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time > now() - INTERVAL 90 DAY
      GROUP BY trader_wallet
      HAVING trade_count > 20 AND total_volume > 5000
      ORDER BY total_volume DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  console.log(`Found ${rows.length} active wallets (last 90 days, >$5k volume, >20 trades)\n`);
  return rows.map((r) => r.wallet);
}

function calculateOmega(gain: number, loss: number): number {
  // loss is negative, so we take absolute value
  const absLoss = Math.abs(loss);
  if (absLoss === 0) {
    return gain > 0 ? Infinity : 0;
  }
  return gain / absLoss;
}

async function calculateOmegaRatios(wallets: string[]): Promise<WalletOmega[]> {
  const results: WalletOmega[] = [];
  const batchSize = 5; // Process 5 at a time to avoid overwhelming

  console.log(`Processing ${wallets.length} wallets in batches of ${batchSize}...\n`);

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(wallets.length / batchSize);

    process.stdout.write(`Batch ${batchNum}/${totalBatches}... `);

    const batchResults = await Promise.all(
      batch.map(async (wallet) => {
        try {
          const metrics = await computeWalletPnlV7(wallet, { mode: 'asymmetric' });

          const omega = calculateOmega(metrics.gain, metrics.loss);
          const roi =
            metrics.volume_traded > 0
              ? (metrics.pnl_total / metrics.volume_traded) * 100
              : 0;

          return {
            wallet,
            pnl_total: metrics.pnl_total,
            gain: metrics.gain,
            loss: metrics.loss,
            omega_ratio: omega,
            volume_traded: metrics.volume_traded,
            fills_count: metrics.fills_count,
            roi_percent: roi,
          };
        } catch (err) {
          console.error(`Error for ${wallet}: ${err}`);
          return null;
        }
      })
    );

    const validResults = batchResults.filter((r) => r !== null) as WalletOmega[];
    results.push(...validResults);
    console.log(`done (${validResults.length} wallets)`);
  }

  return results;
}

function analyzeTopTiers(results: WalletOmega[]) {
  // Sort by Omega ratio descending
  const byOmega = [...results]
    .filter((r) => r.omega_ratio !== Infinity && !isNaN(r.omega_ratio))
    .sort((a, b) => b.omega_ratio - a.omega_ratio);

  // Sort by PnL descending
  const byPnl = [...results].sort((a, b) => b.pnl_total - a.pnl_total);

  // Sort by ROI descending
  const byRoi = [...results].sort((a, b) => b.roi_percent - a.roi_percent);

  console.log('\n' + '='.repeat(80));
  console.log('OMEGA RATIO LEADERBOARD (Top 10, Top 50, Top 100)');
  console.log('Mode: V7 Asymmetric (Conservative - Safe for Leaderboards)');
  console.log('='.repeat(80));

  // Top 10
  console.log('\n--- TOP 10 BY OMEGA RATIO ---');
  console.log('Rank | Wallet | Omega | PnL | Gain | Loss | Volume | ROI%');
  byOmega.slice(0, 10).forEach((w, i) => {
    console.log(
      `${(i + 1).toString().padStart(2)} | ${w.wallet.slice(0, 10)}... | ${w.omega_ratio.toFixed(2).padStart(6)} | $${w.pnl_total.toFixed(0).padStart(8)} | $${w.gain.toFixed(0).padStart(8)} | $${w.loss.toFixed(0).padStart(8)} | $${w.volume_traded.toFixed(0).padStart(10)} | ${w.roi_percent.toFixed(1)}%`
    );
  });

  // Aggregate stats
  const top10 = byOmega.slice(0, 10);
  const top50 = byOmega.slice(0, 50);
  const top100 = byOmega.slice(0, 100);

  const avgOmega = (arr: WalletOmega[]) =>
    arr.reduce((s, w) => s + w.omega_ratio, 0) / arr.length;
  const avgPnl = (arr: WalletOmega[]) =>
    arr.reduce((s, w) => s + w.pnl_total, 0) / arr.length;
  const avgRoi = (arr: WalletOmega[]) =>
    arr.reduce((s, w) => s + w.roi_percent, 0) / arr.length;
  const totalPnl = (arr: WalletOmega[]) =>
    arr.reduce((s, w) => s + w.pnl_total, 0);

  console.log('\n--- AGGREGATE STATISTICS ---');
  console.log('Tier    | Avg Omega | Avg PnL    | Avg ROI  | Total PnL');
  console.log(
    `Top 10  | ${avgOmega(top10).toFixed(2).padStart(9)} | $${avgPnl(top10).toFixed(0).padStart(9)} | ${avgRoi(top10).toFixed(1).padStart(6)}% | $${totalPnl(top10).toFixed(0)}`
  );
  if (top50.length >= 50) {
    console.log(
      `Top 50  | ${avgOmega(top50).toFixed(2).padStart(9)} | $${avgPnl(top50).toFixed(0).padStart(9)} | ${avgRoi(top50).toFixed(1).padStart(6)}% | $${totalPnl(top50).toFixed(0)}`
    );
  }
  if (top100.length >= 100) {
    console.log(
      `Top 100 | ${avgOmega(top100).toFixed(2).padStart(9)} | $${avgPnl(top100).toFixed(0).padStart(9)} | ${avgRoi(top100).toFixed(1).padStart(6)}% | $${totalPnl(top100).toFixed(0)}`
    );
  }

  // Cross-reference: How do top Omega wallets rank by PnL?
  console.log('\n--- CORRELATION CHECK ---');
  console.log('Do high Omega wallets also have high PnL?');

  const top10OmegaWallets = new Set(top10.map((w) => w.wallet));
  const top10PnlWallets = new Set(byPnl.slice(0, 10).map((w) => w.wallet));
  const overlap = [...top10OmegaWallets].filter((w) =>
    top10PnlWallets.has(w)
  ).length;
  console.log(
    `Top 10 Omega vs Top 10 PnL overlap: ${overlap}/10 (${(overlap / 10) * 100}%)`
  );

  // Also show top 10 by absolute PnL
  console.log('\n--- TOP 10 BY ABSOLUTE PNL ---');
  console.log('Rank | Wallet | PnL | Omega | Volume | ROI%');
  byPnl.slice(0, 10).forEach((w, i) => {
    console.log(
      `${(i + 1).toString().padStart(2)} | ${w.wallet.slice(0, 10)}... | $${w.pnl_total.toFixed(0).padStart(10)} | ${w.omega_ratio.toFixed(2).padStart(6)} | $${w.volume_traded.toFixed(0).padStart(10)} | ${w.roi_percent.toFixed(1)}%`
    );
  });

  return { byOmega, byPnl, byRoi };
}

async function main() {
  console.log('='.repeat(80));
  console.log('OMEGA RATIO CALCULATOR - V7 Asymmetric Mode');
  console.log('='.repeat(80));
  console.log('\nThis uses conservative V7 mode which:');
  console.log('  - Only realizes losses (payout=0)');
  console.log('  - Does NOT realize unredeemed winners');
  console.log('  - Safe for leaderboards (losers CANNOT appear as winners)\n');

  // Get top 200 wallets by volume (we'll filter down to active ones)
  const wallets = await getTopWalletsByVolume(200);

  // Calculate Omega ratios
  const results = await calculateOmegaRatios(wallets);

  // Analyze and display
  analyzeTopTiers(results);

  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total wallets analyzed: ${results.length}`);
  console.log(
    `Profitable wallets (Omega > 1): ${results.filter((r) => r.omega_ratio > 1).length}`
  );
  console.log(
    `Losing wallets (Omega < 1): ${results.filter((r) => r.omega_ratio < 1 && r.omega_ratio > 0).length}`
  );
}

main().catch(console.error);
