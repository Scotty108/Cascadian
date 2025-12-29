#!/usr/bin/env npx tsx
/**
 * Copy-Trade Leaderboard Builder (Fast V1)
 *
 * Pulls top 100 copy-trade candidates from wallet_metrics.
 * Filters for safety and minimum activity.
 * No per-wallet recompute - pure ClickHouse query.
 *
 * Output: tmp/copy_trade_leaderboard_fast_v1.json
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '@/lib/clickhouse/client';

// ============================================================================
// FILTER CONSTANTS (Conservative for copy-trade safety)
// ============================================================================
const MIN_TRADES = 20;           // Statistical significance
const MIN_MARKETS = 5;           // Diversification
const MIN_WIN_RATE = 0.50;       // At least break-even
const MIN_OMEGA = 1.0;           // Positive risk-adjusted
const MIN_ABS_PNL = 100;         // Filter dust
const LIMIT = 100;

interface LeaderboardWallet {
  rank: number;
  wallet: string;
  omega_ratio: number;
  realized_pnl: number;
  win_rate: number;
  roi_pct: number;
  total_trades: number;
  markets_traded: number;
  sharpe_ratio: number;
}

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '='.repeat(80));
  console.log('COPY-TRADE LEADERBOARD BUILDER (FAST V1)');
  console.log('='.repeat(80));
  console.log(`\nFilters:`);
  console.log(`  MIN_TRADES:   ${MIN_TRADES}`);
  console.log(`  MIN_MARKETS:  ${MIN_MARKETS}`);
  console.log(`  MIN_WIN_RATE: ${MIN_WIN_RATE}`);
  console.log(`  MIN_OMEGA:    ${MIN_OMEGA}`);
  console.log(`  MIN_ABS_PNL:  $${MIN_ABS_PNL}`);
  console.log(`  LIMIT:        ${LIMIT}\n`);

  try {
    // Step 1: Check table exists and has data
    console.log('1️⃣  Checking wallet_metrics table...');

    const countQuery = `
      SELECT count() as total
      FROM default.wallet_metrics FINAL
      WHERE time_window = 'lifetime'
    `;
    const countResult = await ch.query({ query: countQuery, format: 'JSONEachRow' });
    const countData = await countResult.json<any[]>();
    const totalWallets = parseInt(countData[0].total);

    console.log(`   Found ${totalWallets.toLocaleString()} lifetime wallet records\n`);

    if (totalWallets === 0) {
      console.error('❌ ERROR: No data in wallet_metrics. Run rebuild script first.');
      process.exit(1);
    }

    // Step 2: Run leaderboard query
    console.log('2️⃣  Querying top candidates...');
    const startTime = Date.now();

    const leaderboardQuery = `
      SELECT
        wallet_address,
        omega_ratio,
        realized_pnl,
        win_rate,
        roi_pct,
        total_trades,
        markets_traded,
        sharpe_ratio
      FROM default.wallet_metrics FINAL
      WHERE
        time_window = 'lifetime'
        AND total_trades >= ${MIN_TRADES}
        AND markets_traded >= ${MIN_MARKETS}
        AND omega_ratio IS NOT NULL
        AND omega_ratio >= ${MIN_OMEGA}
        AND win_rate >= ${MIN_WIN_RATE}
        AND abs(realized_pnl) >= ${MIN_ABS_PNL}
      ORDER BY
        omega_ratio DESC,
        realized_pnl DESC,
        win_rate DESC
      LIMIT ${LIMIT}
    `;

    const result = await ch.query({ query: leaderboardQuery, format: 'JSONEachRow' });
    const rows = await result.json<any[]>();
    const elapsed = Date.now() - startTime;

    console.log(`   Query completed in ${elapsed}ms`);
    console.log(`   Found ${rows.length} candidates matching filters\n`);

    // Step 3: Transform to output format
    const wallets: LeaderboardWallet[] = rows.map((row, idx) => ({
      rank: idx + 1,
      wallet: row.wallet_address,
      omega_ratio: parseFloat(row.omega_ratio) || 0,
      realized_pnl: parseFloat(row.realized_pnl) || 0,
      win_rate: parseFloat(row.win_rate) || 0,
      roi_pct: parseFloat(row.roi_pct) || 0,
      total_trades: parseInt(row.total_trades) || 0,
      markets_traded: parseInt(row.markets_traded) || 0,
      sharpe_ratio: parseFloat(row.sharpe_ratio) || 0,
    }));

    // Step 4: Write JSON output
    const output = {
      generated_at: new Date().toISOString(),
      filters: {
        min_trades: MIN_TRADES,
        min_markets: MIN_MARKETS,
        min_win_rate: MIN_WIN_RATE,
        min_omega: MIN_OMEGA,
        min_abs_pnl: MIN_ABS_PNL,
      },
      count: wallets.length,
      wallets,
    };

    // Ensure tmp directory exists
    const tmpDir = resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const outputPath = resolve(tmpDir, 'copy_trade_leaderboard_fast_v1.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`3️⃣  Output written to: ${outputPath}\n`);

    // Step 5: Print summary
    console.log('='.repeat(80));
    console.log('TOP 10 COPY-TRADE CANDIDATES');
    console.log('='.repeat(80));
    console.log('Rank | Wallet                                     | Omega  | PnL         | Win%  | Trades');
    console.log('-'.repeat(80));

    wallets.slice(0, 10).forEach(w => {
      const pnlStr = w.realized_pnl >= 0
        ? `+$${w.realized_pnl.toFixed(0).padStart(8)}`
        : `-$${Math.abs(w.realized_pnl).toFixed(0).padStart(8)}`;
      console.log(
        `${w.rank.toString().padStart(4)} | ${w.wallet} | ${w.omega_ratio.toFixed(2).padStart(6)} | ${pnlStr} | ${(w.win_rate * 100).toFixed(0).padStart(4)}% | ${w.total_trades.toString().padStart(5)}`
      );
    });

    // Aggregate stats
    const totalPnl = wallets.reduce((sum, w) => sum + w.realized_pnl, 0);
    const avgOmega = wallets.length > 0
      ? wallets.reduce((sum, w) => sum + w.omega_ratio, 0) / wallets.length
      : 0;
    const avgWinRate = wallets.length > 0
      ? wallets.reduce((sum, w) => sum + w.win_rate, 0) / wallets.length
      : 0;

    console.log('\n' + '='.repeat(80));
    console.log('AGGREGATE STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total candidates:     ${wallets.length}`);
    console.log(`Combined PnL:         $${totalPnl.toFixed(2)}`);
    console.log(`Average Omega:        ${avgOmega.toFixed(2)}`);
    console.log(`Average Win Rate:     ${(avgWinRate * 100).toFixed(1)}%`);
    console.log(`Profitable wallets:   ${wallets.filter(w => w.realized_pnl > 0).length}`);
    console.log(`Losing wallets:       ${wallets.filter(w => w.realized_pnl < 0).length}`);

    console.log('\n✅ STEP 1 COMPLETE');
    console.log('Next: Use MCP Playwright to validate individual wallets against Polymarket UI');

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
