/**
 * CCR-v1 Leaderboard: Calculate PnL for Candidate Pool
 *
 * Two-phase approach to avoid ClickHouse CTE issues:
 * 1. Get per-position PnL data from ClickHouse
 * 2. Aggregate in TypeScript
 *
 * Formula from V17:
 *   - trade_cash_flow = sell_usdc - buy_usdc
 *   - final_shares = buy_tokens - sell_tokens
 *   - realized_pnl = trade_cash_flow + (final_shares × resolution_price)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

interface Candidate {
  wallet: string;
  markets: number;
  trades: number;
  volume: number;
  active_days: number;
  trades_per_day: number;
  avg_trade_size: number;
}

interface CandidateWithPnL extends Candidate {
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  win_count: number;
  loss_count: number;
  resolved_markets: number;
  win_rate: number;
  profit_factor: number;
  gross_gains: number;
  gross_losses: number;
  velocity_30d: number;
  v_score: number;
}

interface PositionPnL {
  wallet: string;
  condition_id: string;
  outcome_index: number;
  realized_pnl: number;
  unrealized_pnl: number;
  is_resolved: number;
}

async function calculatePnLForCandidates() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: Calculate PnL for Candidates');
  console.log('='.repeat(70));
  console.log('');

  // Load candidates
  const candidatesPath = 'scripts/leaderboard/final-candidates.json';
  if (!fs.existsSync(candidatesPath)) {
    console.error('Error: final-candidates.json not found. Run 01c first.');
    process.exit(1);
  }

  const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates: Candidate[] = candidatesData.wallets;
  console.log(`Loaded ${candidates.length} candidates\n`);

  const BATCH_SIZE = 50;
  const allPositions: PositionPnL[] = [];
  const startTime = Date.now();

  // Phase 1: Get per-position PnL from ClickHouse
  console.log('Phase 1: Fetching per-position PnL...');
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const walletList = batch.map((c) => `'${c.wallet}'`).join(',');
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(candidates.length / BATCH_SIZE);

    process.stdout.write(`\r  Batch ${batchNum}/${totalBatches}`);

    // Simple query: get position data with resolution status
    const pnlQuery = `
      SELECT
        lower(f.trader_wallet) as wallet,
        lower(m.condition_id) as condition_id,
        m.outcome_index as outcome_index,
        sum(if(f.side = 'buy', f.token_amount, 0)) / 1e6 as buy_tokens,
        sum(if(f.side = 'sell', f.token_amount, 0)) / 1e6 as sell_tokens,
        sum(if(f.side = 'buy', f.usdc_amount, 0)) / 1e6 as buy_usdc,
        sum(if(f.side = 'sell', f.usdc_amount, 0)) / 1e6 as sell_usdc,
        any(r.payout_numerators) as payout_numerators,
        if(r.condition_id IS NOT NULL, 1, 0) as is_resolved
      FROM pm_trader_events_dedup_v2_tbl f
      INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
      WHERE lower(f.trader_wallet) IN (${walletList})
      GROUP BY lower(f.trader_wallet), lower(m.condition_id), m.outcome_index, r.condition_id
    `;

    try {
      const result = await clickhouse.query({
        query: pnlQuery,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 120 },
      });
      const posData = (await result.json()) as any[];

      // Calculate PnL for each position
      for (const p of posData) {
        const cashFlow = parseFloat(p.sell_usdc) - parseFloat(p.buy_usdc);
        const finalShares = parseFloat(p.buy_tokens) - parseFloat(p.sell_tokens);
        const isResolved = parseInt(p.is_resolved) === 1;

        let resolutionPrice = 0.5; // default for unrealized
        if (isResolved && p.payout_numerators) {
          try {
            const payouts = JSON.parse(p.payout_numerators);
            resolutionPrice = payouts[parseInt(p.outcome_index)] ?? 0;
          } catch {
            resolutionPrice = 0;
          }
        }

        const pnl = cashFlow + finalShares * resolutionPrice;

        allPositions.push({
          wallet: p.wallet,
          condition_id: p.condition_id,
          outcome_index: parseInt(p.outcome_index),
          realized_pnl: isResolved ? pnl : 0,
          unrealized_pnl: isResolved ? 0 : pnl,
          is_resolved: isResolved ? 1 : 0,
        });
      }
    } catch (err: any) {
      console.error(`\nBatch ${batchNum} error:`, err.message || err);
    }
  }

  console.log(`\n  Loaded ${allPositions.length} positions`);

  // Phase 2: Aggregate in TypeScript
  console.log('\nPhase 2: Aggregating per-wallet metrics...');
  const walletMap = new Map<
    string,
    {
      realized_pnl: number;
      unrealized_pnl: number;
      win_count: number;
      loss_count: number;
      resolved_markets: number;
      gross_gains: number;
      gross_losses: number;
    }
  >();

  for (const pos of allPositions) {
    if (!walletMap.has(pos.wallet)) {
      walletMap.set(pos.wallet, {
        realized_pnl: 0,
        unrealized_pnl: 0,
        win_count: 0,
        loss_count: 0,
        resolved_markets: 0,
        gross_gains: 0,
        gross_losses: 0,
      });
    }
    const w = walletMap.get(pos.wallet)!;
    w.realized_pnl += pos.realized_pnl;
    w.unrealized_pnl += pos.unrealized_pnl;
    if (pos.is_resolved === 1) {
      w.resolved_markets++;
      if (pos.realized_pnl > 0) {
        w.win_count++;
        w.gross_gains += pos.realized_pnl;
      } else if (pos.realized_pnl < 0) {
        w.loss_count++;
        w.gross_losses += Math.abs(pos.realized_pnl);
      }
    }
  }

  // Merge with candidate data
  const results: CandidateWithPnL[] = [];
  for (const c of candidates) {
    const pnl = walletMap.get(c.wallet.toLowerCase());
    if (pnl) {
      const winRate = pnl.resolved_markets > 0 ? pnl.win_count / pnl.resolved_markets : 0;
      const profitFactor = pnl.gross_losses > 0 ? pnl.gross_gains / pnl.gross_losses : pnl.gross_gains > 0 ? 99 : 0;
      const velocity30d = c.trades_per_day;

      // V-Score = Velocity_30d × log10(1 + TotalNotional) × (0.5 + WinRate) × min(2, ProfitFactor)
      const vScore = velocity30d * Math.log10(1 + c.volume) * (0.5 + winRate) * Math.min(2, profitFactor);

      results.push({
        ...c,
        realized_pnl: pnl.realized_pnl,
        unrealized_pnl: pnl.unrealized_pnl,
        total_pnl: pnl.realized_pnl + pnl.unrealized_pnl,
        win_count: pnl.win_count,
        loss_count: pnl.loss_count,
        resolved_markets: pnl.resolved_markets,
        win_rate: winRate,
        profit_factor: profitFactor,
        gross_gains: pnl.gross_gains,
        gross_losses: pnl.gross_losses,
        velocity_30d: velocity30d,
        v_score: vScore,
      });
    }
  }

  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Processed: ${results.length} wallets`);

  // Filter to ≥$200 realized PnL
  const profitable = results.filter((r) => r.realized_pnl >= 200);
  console.log(`With ≥$200 realized PnL: ${profitable.length}`);

  // Sort by V-Score
  profitable.sort((a, b) => b.v_score - a.v_score);

  // Stats
  if (profitable.length > 0) {
    const avgPnL = profitable.reduce((s, c) => s + c.realized_pnl, 0) / profitable.length;
    const avgWinRate = profitable.reduce((s, c) => s + c.win_rate, 0) / profitable.length;
    const avgPF = profitable.reduce((s, c) => s + Math.min(10, c.profit_factor), 0) / profitable.length;

    console.log(`\nPool Statistics:`);
    console.log(`  Avg Realized PnL: $${avgPnL.toFixed(2)}`);
    console.log(`  Avg Win Rate: ${(avgWinRate * 100).toFixed(1)}%`);
    console.log(`  Avg Profit Factor: ${avgPF.toFixed(2)}`);
  }

  // Top 30 by V-Score
  console.log('\nTop 30 by V-Score:');
  console.log('-'.repeat(110));
  console.log(
    'Wallet              | Realized PnL | Win Rate | PF    | V-Score | Volume    | Markets | T/Day'
  );
  console.log('-'.repeat(110));

  for (const c of profitable.slice(0, 30)) {
    const wallet = c.wallet.slice(0, 10) + '...' + c.wallet.slice(-4);
    const pnl = ('$' + c.realized_pnl.toFixed(0)).padStart(12);
    const wr = ((c.win_rate * 100).toFixed(1) + '%').padStart(8);
    const pf = Math.min(99, c.profit_factor).toFixed(2).padStart(5);
    const vs = c.v_score.toFixed(1).padStart(7);
    const vol = ('$' + (c.volume / 1e6).toFixed(2) + 'M').padStart(9);
    const mkts = String(c.markets).padStart(7);
    const tpd = c.trades_per_day.toFixed(1).padStart(5);
    console.log(`${wallet.padEnd(19)} | ${pnl} | ${wr} | ${pf} | ${vs} | ${vol} | ${mkts} | ${tpd}`);
  }

  // Save results
  const outputPath = 'scripts/leaderboard/leaderboard-with-pnl.json';
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        engine: 'CCR-v1 (V17)',
        filters: {
          ...candidatesData.filters,
          min_realized_pnl: 200,
        },
        total_candidates: results.length,
        profitable_count: profitable.length,
        wallets: profitable,
      },
      null,
      2
    )
  );

  console.log(`\nSaved ${profitable.length} wallets to ${outputPath}`);
  console.log(`Runtime: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
}

calculatePnLForCandidates().catch(console.error);
