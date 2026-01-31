#!/usr/bin/env npx tsx
/**
 * Top 50 Copytrading Leaderboard - V10
 *
 * PROPER EVENT-BASED SIMULATION
 * Uses pm_trade_fifo_roi_v3_mat_deduped
 *
 * Filters:
 * 1. Active in last 4 days
 * 2. Median ROI > 10%
 * 3. > 30 trades
 * 4. > 7 markets
 * 5. Median bet > $5
 *
 * Simulation:
 * - BUY: if cash >= bet_size, buy. else skip.
 * - SELL/REDEEM: sell 100% at effective price, cash += proceeds
 *
 * Run: npx tsx scripts/copytrading-leaderboard-v10.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// Configuration
const BET_SIZE = 2.0;
const INITIAL_BANKROLL = 100.0; // Start with $100
const LOOKBACK_DAYS = 90;
const ACTIVE_DAYS = 4;
const MIN_TRADES = 30;
const MIN_MARKETS = 7;
const MIN_MEDIAN_ROI_PCT = 10;
const MIN_MEDIAN_BET = 5;

interface Trade {
  tx_hash: string;
  condition_id: string;
  entry_time: Date;
  resolved_at: Date;
  cost_usd: number;
  tokens: number;
  exit_value: number;
  roi: number;
}

interface SimulationResult {
  wallet: string;
  initialBankroll: number;
  finalBankroll: number;
  tradesCopied: number;
  tradesSkipped: number;
  firstEventTime: Date;
  lastEventTime: Date;
  logGrowthPerDay: number;
  simulatedReturnPctPerDay: number;
}

interface WalletStats {
  wallet: string;
  total_trades: number;
  markets_traded: number;
  win_rate_pct: number;
  median_roi: number;
  median_bet_size: number;
  avg_roi: number;
  first_trade_time: string;
  last_trade_time: string;
  days_active: number;
}

async function main() {
  console.log('='.repeat(100));
  console.log('COPYTRADING LEADERBOARD V10 - EVENT-BASED SIMULATION');
  console.log('='.repeat(100));
  console.log(`Bet: $${BET_SIZE} | Initial: $${INITIAL_BANKROLL} | Lookback: ${LOOKBACK_DAYS}d\n`);
  console.log('Filters:');
  console.log(`  1. Active in last ${ACTIVE_DAYS} days`);
  console.log(`  2. Median ROI > ${MIN_MEDIAN_ROI_PCT}%`);
  console.log(`  3. > ${MIN_TRADES} trades`);
  console.log(`  4. > ${MIN_MARKETS} markets`);
  console.log(`  5. Median bet > $${MIN_MEDIAN_BET}\n`);

  const startTime = Date.now();

  // Step 1: Get candidate wallets with all filters
  console.log('Step 1: Finding candidate wallets...');
  const candidateQuery = `
    SELECT
      wallet,
      count() as total_trades,
      uniqExact(condition_id) as markets_traded,
      countIf(roi > 0) * 100.0 / count() as win_rate_pct,
      median(roi) as median_roi,
      median(abs(cost_usd)) as median_bet_size,
      avg(roi) as avg_roi,
      min(entry_time) as first_trade_time,
      max(entry_time) as last_trade_time,
      (toUnixTimestamp(max(resolved_at)) - toUnixTimestamp(min(entry_time))) / 86400.0 as days_active,
      quantile(0.95)(roi) as p95_roi,
      medianIf(roi, roi > 0) as median_win_roi,
      medianIf(abs(roi), roi <= 0) as median_loss_mag
    FROM pm_trade_fifo_roi_v3_mat_deduped
    WHERE entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
      AND resolved_at IS NOT NULL
      AND resolved_at > entry_time
      AND resolved_at <= now()
      AND tokens > 0
      AND cost_usd > 0
    GROUP BY wallet
    HAVING
      -- Filter 1: Active in last 4 days
      last_trade_time >= now() - INTERVAL ${ACTIVE_DAYS} DAY
      -- Filter 2: Median ROI > 10%
      AND median_roi > ${MIN_MEDIAN_ROI_PCT / 100}
      -- Filter 3: > 30 trades
      AND total_trades > ${MIN_TRADES}
      -- Filter 4: > 7 markets
      AND markets_traded > ${MIN_MARKETS}
      -- Filter 5: Median bet > $5
      AND median_bet_size > ${MIN_MEDIAN_BET}
      -- Also need some losses for EV calc
      AND countIf(roi <= 0) > 0
      AND days_active > 0
    ORDER BY avg_roi DESC
    LIMIT 500
    SETTINGS max_execution_time = 300
  `;

  const candidateResult = await clickhouse.query({ query: candidateQuery, format: 'JSONEachRow' });
  const candidates = await candidateResult.json() as WalletStats[];
  console.log(`Found ${candidates.length} candidate wallets after filters\n`);

  if (candidates.length === 0) {
    console.log('No candidates found. Exiting.');
    return;
  }

  // Step 2: Run simulation for each wallet
  console.log('Step 2: Running copytrade simulation for each wallet...');
  const results: any[] = [];
  const batchSize = 50;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const walletList = batch.map(c => `'${c.wallet}'`).join(',');

    // Fetch all trades for this batch of wallets
    const tradesQuery = `
      SELECT
        wallet,
        tx_hash,
        condition_id,
        entry_time,
        resolved_at,
        cost_usd,
        tokens,
        exit_value,
        roi
      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE wallet IN (${walletList})
        AND entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND resolved_at IS NOT NULL
        AND resolved_at > entry_time
        AND resolved_at <= now()
        AND tokens > 0
        AND cost_usd > 0
      ORDER BY wallet, entry_time
      SETTINGS max_execution_time = 120
    `;

    const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
    const allTrades = await tradesResult.json() as any[];

    // Group trades by wallet
    const tradesByWallet = new Map<string, Trade[]>();
    for (const t of allTrades) {
      const wallet = t.wallet;
      if (!tradesByWallet.has(wallet)) {
        tradesByWallet.set(wallet, []);
      }
      tradesByWallet.get(wallet)!.push({
        tx_hash: t.tx_hash,
        condition_id: t.condition_id,
        entry_time: new Date(t.entry_time),
        resolved_at: new Date(t.resolved_at),
        cost_usd: Number(t.cost_usd),
        tokens: Number(t.tokens),
        exit_value: Number(t.exit_value),
        roi: Number(t.roi)
      });
    }

    // Run simulation for each wallet in batch
    for (const candidate of batch) {
      const trades = tradesByWallet.get(candidate.wallet) || [];
      if (trades.length === 0) continue;

      const sim = runCopytradeSimulation(trades, BET_SIZE, INITIAL_BANKROLL);

      // Compute additional metrics
      const days_active = Number(candidate.days_active);
      const roi_pct_per_day = Number(candidate.avg_roi) * 100 / Math.max(1, days_active);
      const trades_per_day = Number(candidate.total_trades) / Math.max(1, days_active);

      // EV per trade = win_rate * median_win - loss_rate * median_loss
      const win_rate = Number(candidate.win_rate_pct) / 100;
      const median_win_roi = Number(candidate.median_win_roi) || 0;
      const median_loss_mag = Number(candidate.median_loss_mag) || 0;
      const p95_roi = Number(candidate.p95_roi);
      const median_win_roi_capped = Math.min(median_win_roi, p95_roi);
      const ev_per_trade = (win_rate * median_win_roi_capped) - ((1 - win_rate) * median_loss_mag);

      // Compounding score = EV per trade / avg days between trades
      const avg_days_per_trade = days_active / Number(candidate.total_trades);
      const compounding_score = ev_per_trade / Math.max(0.01, avg_days_per_trade);

      results.push({
        wallet: candidate.wallet,
        log_growth_per_day: sim.logGrowthPerDay,
        simulated_return_pct_per_day: sim.simulatedReturnPctPerDay,
        roi_pct_per_day,
        trades_per_day,
        final_bankroll: sim.finalBankroll,
        trades_copied: sim.tradesCopied,
        trades_skipped: sim.tradesSkipped,
        ev_per_trade,
        compounding_score,
        win_rate_pct: Number(candidate.win_rate_pct),
        median_roi_pct: Number(candidate.median_roi) * 100,
        markets_traded: Number(candidate.markets_traded),
        days_active,
        date_last_trade: new Date(candidate.last_trade_time).toISOString().split('T')[0]
      });
    }

    const progress = Math.min(i + batchSize, candidates.length);
    process.stdout.write(`\r  Processed ${progress}/${candidates.length} wallets...`);
  }
  console.log('\n');

  // Step 3: Rank by log_growth_per_day and take top 50
  results.sort((a, b) => b.log_growth_per_day - a.log_growth_per_day);
  const top50 = results.filter(r => r.log_growth_per_day > 0 && isFinite(r.log_growth_per_day)).slice(0, 50);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Completed in ${elapsed}s`);
  console.log(`Final result: ${top50.length} wallets\n`);

  displayLeaderboard(top50);

  // Export to CSV
  try {
    mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
    const csvPath = resolve(process.cwd(), 'data/copytrading-leaderboard-v10-top50.csv');
    exportToCSV(top50, csvPath);
    console.log(`\nExported to: ${csvPath}`);
  } catch (e) {
    console.error('Export error:', e);
  }
}

/**
 * Run copytrade simulation for a wallet's trades
 *
 * Event-based simulation:
 * - BUY: At entry_time, if cash >= bet_size, buy shares = bet_size / entry_price
 * - SELL/REDEEM: At resolved_at, sell shares at exit_price, cash += proceeds
 */
function runCopytradeSimulation(
  trades: Trade[],
  betSize: number,
  initialBankroll: number
): SimulationResult {
  // Create events: BUY at entry_time, SELL at resolved_at
  type Event = {
    time: Date;
    type: 'BUY' | 'SELL';
    tradeId: number;
    entryPrice: number;
    exitPrice: number;
  };

  const events: Event[] = [];

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const entryPrice = t.cost_usd / t.tokens; // price per token at entry
    const exitPrice = t.tokens > 0 ? t.exit_value / t.tokens : 0; // effective exit price

    events.push({
      time: t.entry_time,
      type: 'BUY',
      tradeId: i,
      entryPrice,
      exitPrice
    });

    events.push({
      time: t.resolved_at,
      type: 'SELL',
      tradeId: i,
      entryPrice,
      exitPrice
    });
  }

  // Sort events by time, with BUY before SELL if same time
  events.sort((a, b) => {
    const timeDiff = a.time.getTime() - b.time.getTime();
    if (timeDiff !== 0) return timeDiff;
    // BUY before SELL at same time
    return a.type === 'BUY' ? -1 : 1;
  });

  // Run simulation
  let cash = initialBankroll;
  const positions = new Map<number, number>(); // tradeId -> shares held
  let tradesCopied = 0;
  let tradesSkipped = 0;
  let firstEventTime: Date | null = null;
  let lastEventTime: Date | null = null;

  for (const event of events) {
    if (firstEventTime === null) firstEventTime = event.time;
    lastEventTime = event.time;

    if (event.type === 'BUY') {
      if (cash >= betSize) {
        // Buy shares
        const shares = betSize / event.entryPrice;
        positions.set(event.tradeId, shares);
        cash -= betSize;
        tradesCopied++;
      } else {
        // Skip - not enough cash
        tradesSkipped++;
      }
    } else {
      // SELL/REDEEM
      const shares = positions.get(event.tradeId) || 0;
      if (shares > 0) {
        // Sell all shares at exit price
        const proceeds = shares * event.exitPrice;
        cash += proceeds;
        positions.delete(event.tradeId);
      }
    }
  }

  // Calculate final metrics
  const finalBankroll = cash;
  const daysActive = firstEventTime && lastEventTime
    ? (lastEventTime.getTime() - firstEventTime.getTime()) / (86400 * 1000)
    : 1;

  // LogGrowthPerDay = ln(B_T / B_0) / days
  const logGrowthPerDay = finalBankroll > 0 && initialBankroll > 0
    ? Math.log(finalBankroll / initialBankroll) / Math.max(1, daysActive)
    : 0;

  // Simulated return % per day
  const totalReturnPct = ((finalBankroll - initialBankroll) / initialBankroll) * 100;
  const simulatedReturnPctPerDay = totalReturnPct / Math.max(1, daysActive);

  return {
    wallet: '',
    initialBankroll,
    finalBankroll,
    tradesCopied,
    tradesSkipped,
    firstEventTime: firstEventTime || new Date(),
    lastEventTime: lastEventTime || new Date(),
    logGrowthPerDay,
    simulatedReturnPctPerDay
  };
}

function displayLeaderboard(rows: any[]) {
  console.log('='.repeat(220));
  console.log('TOP 50 COPYTRADING LEADERBOARD - V10 (EVENT-BASED SIMULATION)');
  console.log(`Initial: $${INITIAL_BANKROLL} | Bet: $${BET_SIZE}/trade | LogGrowthPerDay = ln(B_T/B_0) / days`);
  console.log('='.repeat(220));

  const header = [
    'Rk'.padEnd(4),
    'Wallet'.padEnd(44),
    'LogGrw/D'.padEnd(10),
    'SimRet%/D'.padEnd(11),
    'ROI%/D'.padEnd(9),
    'Tr/Day'.padEnd(8),
    'Final$'.padEnd(10),
    'Copied'.padEnd(7),
    'Skip'.padEnd(6),
    'EV/Tr'.padEnd(9),
    'CompSc'.padEnd(9),
    'Win%'.padEnd(7),
    'MedROI%'.padEnd(9),
    'Markets'.padEnd(8),
    'Days'.padEnd(6),
    'LastTrade'
  ].join('');

  console.log(header);
  console.log('-'.repeat(220));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const row = [
      String(i + 1).padEnd(4),
      r.wallet.padEnd(44),
      r.log_growth_per_day.toFixed(4).padEnd(10),
      r.simulated_return_pct_per_day.toFixed(2).padEnd(11),
      r.roi_pct_per_day.toFixed(2).padEnd(9),
      r.trades_per_day.toFixed(1).padEnd(8),
      `$${r.final_bankroll.toFixed(0)}`.padEnd(10),
      String(r.trades_copied).padEnd(7),
      String(r.trades_skipped).padEnd(6),
      r.ev_per_trade.toFixed(3).padEnd(9),
      r.compounding_score.toFixed(3).padEnd(9),
      r.win_rate_pct.toFixed(1).padEnd(7),
      r.median_roi_pct.toFixed(1).padEnd(9),
      String(r.markets_traded).padEnd(8),
      r.days_active.toFixed(1).padEnd(6),
      r.date_last_trade
    ].join('');

    console.log(row);
  }
}

function exportToCSV(rows: any[], filePath: string) {
  const headers = [
    'rank',
    'wallet',
    'log_growth_per_day',
    'simulated_return_pct_per_day',
    'roi_pct_per_day',
    'trades_per_day',
    'final_bankroll',
    'trades_copied',
    'trades_skipped',
    'ev_per_trade',
    'compounding_score',
    'win_rate_pct',
    'median_roi_pct',
    'markets_traded',
    'days_active',
    'date_last_trade'
  ];

  const csvRows = [headers.join(',')];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    csvRows.push([
      i + 1,
      r.wallet,
      r.log_growth_per_day.toFixed(6),
      r.simulated_return_pct_per_day.toFixed(4),
      r.roi_pct_per_day.toFixed(4),
      r.trades_per_day.toFixed(2),
      r.final_bankroll.toFixed(2),
      r.trades_copied,
      r.trades_skipped,
      r.ev_per_trade.toFixed(6),
      r.compounding_score.toFixed(6),
      r.win_rate_pct.toFixed(2),
      r.median_roi_pct.toFixed(2),
      r.markets_traded,
      r.days_active.toFixed(2),
      r.date_last_trade
    ].join(','));
  }

  writeFileSync(filePath, csvRows.join('\n'));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
