/**
 * Per-Trade Metrics for Copy Trading
 *
 * For each resolved BUY trade:
 *   return = (payout - entry_price) / entry_price
 *
 * Where:
 *   entry_price = usdc_amount / token_amount
 *   payout = 1 if won, 0 if lost
 *
 * This is simpler than CCR-v1 (no position tracking needed).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import { clickhouse } from '../lib/clickhouse/client';

interface PerTradeMetrics {
  wallet: string;
  total_trades: number;
  resolved_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  asymmetry: number;
  ev_per_trade: number;
  median_win_pct: number;
  median_loss_pct: number;
}

async function computePerTradeMetrics(wallet: string): Promise<PerTradeMetrics | null> {
  // Get all resolved buy trades with their returns
  // payout_numerators is stored as JSON string like '[1,0]' so parse with JSONExtract
  const query = `
    WITH trades AS (
      SELECT
        t.event_id,
        t.token_id,
        t.usdc_amount / 1e6 as usdc,
        t.token_amount / 1e6 as tokens,
        (t.usdc_amount / t.token_amount) as entry_price,
        arrayElement(JSONExtract(r.payout_numerators, 'Array(UInt8)'), toUInt32(m.outcome_index) + 1) as payout
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE t.trader_wallet = '${wallet.toLowerCase()}'
        AND t.is_deleted = 0
        AND t.side = 'buy'
        AND t.token_amount > 0
      GROUP BY t.event_id, t.token_id, t.usdc_amount, t.token_amount, r.payout_numerators, m.outcome_index
    )
    SELECT
      entry_price,
      payout,
      (payout - entry_price) / entry_price as return_pct
    FROM trades
    WHERE entry_price > 0 AND entry_price < 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const trades = await result.json() as { entry_price: number; payout: number; return_pct: number }[];

  if (trades.length < 10) return null;

  const wins = trades.filter(t => t.payout > 0);
  const losses = trades.filter(t => t.payout === 0);

  if (wins.length === 0 || losses.length === 0) return null;

  const avgWinPct = wins.reduce((s, t) => s + Number(t.return_pct), 0) / wins.length;
  const avgLossPct = Math.abs(losses.reduce((s, t) => s + Number(t.return_pct), 0) / losses.length);

  // Median calculations
  const winReturns = wins.map(t => Number(t.return_pct)).sort((a, b) => a - b);
  const lossReturns = losses.map(t => Math.abs(Number(t.return_pct))).sort((a, b) => a - b);
  const medianWin = winReturns[Math.floor(winReturns.length / 2)];
  const medianLoss = lossReturns[Math.floor(lossReturns.length / 2)];

  const winRate = wins.length / trades.length;
  const asymmetry = avgLossPct > 0 ? avgWinPct / avgLossPct : 0;
  const evPerTrade = (winRate * avgWinPct) - ((1 - winRate) * avgLossPct);

  return {
    wallet,
    total_trades: trades.length,
    resolved_trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: winRate,
    avg_win_pct: avgWinPct,
    avg_loss_pct: avgLossPct,
    asymmetry,
    ev_per_trade: evPerTrade,
    median_win_pct: medianWin,
    median_loss_pct: medianLoss,
  };
}

async function main() {
  console.log('=== Per-Trade Metrics Computation ===\n');

  // Load candidate pool
  const poolFile = '/tmp/copytrade_candidates.json';
  if (!fs.existsSync(poolFile)) {
    console.log('No candidate pool found. Run generate-copytrade-pool.ts first.');
    return;
  }

  const pool = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
  const wallets: string[] = pool.wallets;
  console.log(`Loaded ${wallets.length} candidate wallets\n`);

  const results: PerTradeMetrics[] = [];
  const startTime = Date.now();

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    try {
      const metrics = await computePerTradeMetrics(wallet);
      if (metrics) {
        results.push(metrics);
      }
    } catch (err) {
      // Skip errors
    }

    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const eta = (wallets.length - i - 1) / rate;
      console.log(`Progress: ${i + 1}/${wallets.length} | Rate: ${rate.toFixed(1)}/s | ETA: ${(eta / 60).toFixed(1)} min | Found: ${results.length}`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nDone in ${(elapsed / 60).toFixed(1)} minutes`);
  console.log(`Computed metrics for ${results.length} wallets`);

  // Filter for high asymmetry
  const highAsym = results.filter(r => r.asymmetry > 4 && r.ev_per_trade > 0);
  console.log(`High asymmetry (>4) with positive EV: ${highAsym.length}`);

  // Sort by EV
  highAsym.sort((a, b) => b.ev_per_trade - a.ev_per_trade);

  // Save results
  const outputFile = '/tmp/copytrade_per_trade_metrics.json';
  fs.writeFileSync(outputFile, JSON.stringify({
    computed_at: new Date().toISOString(),
    total_candidates: wallets.length,
    computed: results.length,
    high_asymmetry: highAsym.length,
    results: highAsym,
  }, null, 2));
  console.log(`\nSaved to ${outputFile}`);

  // Print top 20
  console.log('\n=== Top 20 by EV per Trade ===\n');
  console.log('Wallet                                     | WinRate | AvgWin | AvgLoss | Asym  | EV/Trade');
  console.log('-------------------------------------------|---------|--------|---------|-------|----------');
  for (const r of highAsym.slice(0, 20)) {
    console.log(
      `${r.wallet} | ` +
      `${(r.win_rate * 100).toFixed(0).padStart(5)}% | ` +
      `${(r.avg_win_pct * 100).toFixed(0).padStart(5)}% | ` +
      `${(r.avg_loss_pct * 100).toFixed(0).padStart(6)}% | ` +
      `${r.asymmetry.toFixed(1).padStart(5)} | ` +
      `${(r.ev_per_trade * 100).toFixed(1).padStart(7)}%`
    );
  }
}

main().catch(console.error);
