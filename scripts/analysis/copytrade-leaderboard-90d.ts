#!/usr/bin/env npx tsx
/**
 * Copytrading Leaderboard - Top 50 by Log Growth per Day
 *
 * Requirements:
 * - Wallets with buy event in last 4 days AND wallet age > 4 days
 * - Using last 90 days of data only
 * - Simulate copytrading with $2 bet size, auto-redeem enabled
 * - Rank by LogGrowthPerDay = ln(B_T/B_0) / days_active
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { writeFileSync } from 'fs';

const BET_SIZE = 2; // Minimum > $1
const INITIAL_BANKROLL = 1000; // Starting cash for simulation
const LOOKBACK_DAYS = 90;

interface Trade {
  timestamp: number;
  wallet: string;
  market_id: string;
  action: 'BUY' | 'SELL';
  price: number;
  shares: number;
}

interface WalletStats {
  wallet: string;
  total_trades: number;
  unique_markets: number;
  win_rate: number;
  median_roi: number;
  median_bet_size: number;
  first_trade_time: number;
  last_trade_time: number;
}

interface SimulationResult {
  wallet: string;
  finalBankroll: number;
  tradesCopied: number;
  tradesSkipped: number;
  firstEventTime: number;
  lastEventTime: number;
  logGrowthPerDay: number;
}

async function main() {
  console.log('🔨 Copytrading Leaderboard - Top 50 by Log Growth per Day\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  console.log(`📊 Parameters:`);
  console.log(`   - Lookback: ${LOOKBACK_DAYS} days`);
  console.log(`   - Bet size: $${BET_SIZE}`);
  console.log(`   - Initial bankroll: $${INITIAL_BANKROLL}\n`);

  const startTime = Date.now();

  // STEP 1-7: Filter wallets
  console.log('STEP 1-7: Filtering wallets...\n');

  const filterQuery = `
    WITH
    -- Get wallet age (first ever trade)
    wallet_age AS (
      SELECT
        wallet,
        min(entry_time) as first_ever_trade
      FROM pm_trade_fifo_roi_v3_mat_unified
      GROUP BY wallet
    ),

    -- 90-day dataset
    trades_90d AS (
      SELECT *
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND is_closed = 1  -- Only closed positions for realized metrics
    ),

    -- Recent activity (last 4 days)
    recent_buys AS (
      SELECT DISTINCT wallet
      FROM trades_90d
      WHERE entry_time >= now() - INTERVAL 4 DAY
    ),

    -- Wallet stats in 90-day window
    wallet_stats AS (
      SELECT
        t.wallet,
        count() as total_trades,
        uniq(t.condition_id) as unique_markets,
        countIf(t.pnl_usd > 0) / count() * 100 as win_rate,
        quantile(0.5)(t.roi * 100) as median_roi_raw,
        quantile(0.5)(t.cost_usd) as median_bet_size,
        min(t.entry_time) as first_trade_90d,
        max(t.entry_time) as last_trade_90d,
        -- Winsorized ROI (cap at 95th percentile)
        quantile(0.95)(t.roi * 100) as p95_roi
      FROM trades_90d t
      GROUP BY t.wallet
    )

    SELECT
      ws.wallet as wallet,
      ws.total_trades as total_trades,
      ws.unique_markets as unique_markets,
      ws.win_rate as win_rate,
      least(ws.median_roi_raw, ws.p95_roi) as median_roi,  -- Winsorized
      ws.median_bet_size as median_bet_size,
      toUnixTimestamp(ws.first_trade_90d) as first_trade_time,
      toUnixTimestamp(ws.last_trade_90d) as last_trade_time
    FROM wallet_stats ws
    INNER JOIN wallet_age wa ON ws.wallet = wa.wallet
    INNER JOIN recent_buys rb ON ws.wallet = rb.wallet
    WHERE
      -- Wallet age > 4 days
      wa.first_ever_trade < now() - INTERVAL 4 DAY
      -- Step 2: > 30 trades in 90 days
      AND ws.total_trades > 30
      -- Step 3: > 7 markets
      AND ws.unique_markets > 7
      -- Step 4: Win rate > 40%
      AND ws.win_rate > 40
      -- Step 5: Median ROI > 10% (winsorized)
      AND least(ws.median_roi_raw, ws.p95_roi) > 10
      -- Step 6: Median bet size > $5
      AND ws.median_bet_size > 5
  `;

  const walletResult = await clickhouse.query({
    query: filterQuery,
    format: 'JSONEachRow'
  });

  const qualifyingWallets = await walletResult.json<WalletStats>();
  console.log(`   ✅ Found ${qualifyingWallets.length} qualifying wallets\n`);

  if (qualifyingWallets.length === 0) {
    console.log('❌ No wallets met the criteria. Exiting.\n');
    return;
  }

  // Debug: Show first few wallets
  console.log('   Sample wallets:');
  for (let i = 0; i < Math.min(3, qualifyingWallets.length); i++) {
    const w: any = qualifyingWallets[i];
    console.log(`     - ${w.wallet || 'NO_WALLET'} (${w.total_trades} trades, ${w.win_rate?.toFixed(1)}% WR)`);
    if (i === 0) {
      console.log(`       DEBUG: Keys =`, Object.keys(w).join(', '));
    }
  }
  console.log();

  // STEP 8: Get trade events for simulation (batched to avoid IN clause limits)
  console.log('STEP 8: Fetching trade events for simulation...\n');

  const events: any[] = [];
  const BATCH_SIZE = 500;

  for (let i = 0; i < qualifyingWallets.length; i += BATCH_SIZE) {
    const batch = qualifyingWallets.slice(i, Math.min(i + BATCH_SIZE, qualifyingWallets.length));
    const walletList = batch.map(w => `'${w.wallet}'`).join(', ');

    console.log(`   Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(qualifyingWallets.length / BATCH_SIZE)}...`);

    const eventsQuery = `
      SELECT
        wallet,
        tx_hash,
        condition_id as market_id,
        outcome_index,
        toUnixTimestamp(entry_time) as buy_timestamp,
        cost_usd,
        tokens,
        cost_usd / tokens as buy_price,
        toUnixTimestamp(resolved_at) as sell_timestamp,
        CASE
          WHEN resolved_at IS NOT NULL AND tokens_held > 0 THEN (exit_value + (tokens_held * (pnl_usd / tokens))) / tokens
          WHEN exit_value > 0 THEN exit_value / (tokens - tokens_held)
          ELSE 0
        END as sell_price,
        exit_value,
        pnl_usd,
        is_closed
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN [${walletList}]
        AND entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND cost_usd >= 0.01
      ORDER BY wallet, buy_timestamp
    `;

    const eventsResult = await clickhouse.query({
      query: eventsQuery,
      format: 'JSONEachRow',
      request_timeout: 120000
    });

    const batchEvents = await eventsResult.json<any>();
    // Avoid stack overflow with large arrays
    for (const evt of batchEvents) {
      events.push(evt);
    }
    console.log(`      ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} fetched ${batchEvents.length} events`);
  }

  console.log(`   ✅ Fetched ${events.length} total position events\n`);

  // Convert to trade stream (individual buys and sells)
  const trades: Trade[] = [];
  for (const evt of events) {
    const posKey = `${evt.market_id}_${evt.outcome_index}`;

    // BUY event
    trades.push({
      timestamp: evt.buy_timestamp,
      wallet: evt.wallet,
      market_id: posKey,
      action: 'BUY',
      price: evt.buy_price,
      shares: evt.tokens
    });

    // SELL/REDEEM event (if position was closed or has exit value)
    if (evt.is_closed === 1 || evt.exit_value > 0) {
      // Estimate sell timestamp (use resolved_at if available, otherwise assume sold right after)
      const sellTimestamp = evt.sell_timestamp > 0 ? evt.sell_timestamp : evt.buy_timestamp + 86400;

      trades.push({
        timestamp: sellTimestamp,
        wallet: evt.wallet,
        market_id: posKey,
        action: 'SELL',
        price: evt.sell_price || 1, // Fallback if no price
        shares: evt.tokens
      });
    }
  }

  // Sort by timestamp
  trades.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`   ✅ Generated ${trades.length} trade events (BUY + SELL)\n`);

  // STEP 8: Run copier simulation (optimized with pre-grouped trades)
  console.log('Running copier simulation...\n');

  // Group trades by wallet for efficient iteration
  const tradesByWallet = new Map<string, Trade[]>();
  for (const trade of trades) {
    if (!tradesByWallet.has(trade.wallet)) {
      tradesByWallet.set(trade.wallet, []);
    }
    tradesByWallet.get(trade.wallet)!.push(trade);
  }

  console.log(`   Grouped ${trades.length} trades into ${tradesByWallet.size} wallets\n`);

  const simulations: SimulationResult[] = [];
  let processed = 0;

  for (const walletStats of qualifyingWallets) {
    const walletTrades = tradesByWallet.get(walletStats.wallet);

    if (!walletTrades || walletTrades.length === 0) continue;

    // Simulation state
    let cash = INITIAL_BANKROLL;
    const positions = new Map<string, { shares: number }>();
    let tradesCopied = 0;
    let tradesSkipped = 0;

    for (const trade of walletTrades) {
      const posKey = trade.market_id;

      if (trade.action === 'BUY') {
        if (cash >= BET_SIZE) {
          // Execute buy
          const sharesToBuy = BET_SIZE / trade.price;
          cash -= BET_SIZE;

          const existing = positions.get(posKey) || { shares: 0 };
          existing.shares += sharesToBuy;
          positions.set(posKey, existing);

          tradesCopied++;
        } else {
          tradesSkipped++;
        }
      } else if (trade.action === 'SELL') {
        // Sell/redeem position
        const position = positions.get(posKey);
        if (position && position.shares > 0) {
          const proceeds = position.shares * trade.price;
          cash += proceeds;
          positions.delete(posKey);
          tradesCopied++;
        }
      }
    }

    // Calculate final bankroll (cash + unrealized positions)
    let unrealizedValue = 0;
    for (const [marketId, pos] of positions) {
      // Assume unrealized positions worth 0 (conservative)
      unrealizedValue += 0;
    }

    const finalBankroll = cash + unrealizedValue;

    // Calculate log growth per day
    const firstEventTime = walletTrades[0].timestamp;
    const lastEventTime = walletTrades[walletTrades.length - 1].timestamp;
    const daysElapsed = Math.max(1, (lastEventTime - firstEventTime) / 86400);

    const logGrowth = Math.log(finalBankroll / INITIAL_BANKROLL);
    const logGrowthPerDay = logGrowth / daysElapsed;

    simulations.push({
      wallet: walletStats.wallet,
      finalBankroll,
      tradesCopied,
      tradesSkipped,
      firstEventTime,
      lastEventTime,
      logGrowthPerDay
    });

    processed++;
    if (processed % 500 === 0) {
      console.log(`   Progress: ${processed}/${qualifyingWallets.length} wallets simulated...`);
    }
  }

  console.log(`   ✅ Simulated ${simulations.length} wallets\n`);

  // STEP 9: Rank by LogGrowthPerDay
  simulations.sort((a, b) => b.logGrowthPerDay - a.logGrowthPerDay);
  const top50 = simulations.slice(0, 50);

  // STEP 10: Generate leaderboard table
  console.log('STEP 10: Generating leaderboard...\n');

  // Fetch additional metrics for top 50
  const top50Wallets = top50.map(s => `'${s.wallet}'`).join(', ');

  const metricsQuery = `
    WITH trades_90d AS (
      SELECT *
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE wallet IN [${top50Wallets}]
        AND entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
        AND is_closed = 1
    ),
    wallet_metrics AS (
      SELECT
        wallet,
        count() as total_trades,
        countIf(pnl_usd > 0) / count() * 100 as win_rate,
        quantile(0.5)(roi * 100) as median_roi,
        quantileIf(0.5)(roi * 100, pnl_usd > 0) as median_win_roi,
        quantileIf(0.5)(abs(roi) * 100, pnl_usd <= 0) as median_loss_roi,
        max(entry_time) as last_trade,
        (max(toUnixTimestamp(entry_time)) - min(toUnixTimestamp(entry_time))) / 86400.0 as days_active
      FROM trades_90d
      GROUP BY wallet
    )
    SELECT
      wallet,
      total_trades,
      win_rate,
      median_roi,
      median_win_roi,
      median_loss_roi,
      last_trade,
      days_active,
      -- Edge per trade (EV formula)
      (win_rate / 100) * median_win_roi - ((1 - win_rate / 100) * median_loss_roi) as edge_per_trade,
      -- Compounding score
      ((win_rate / 100) * median_win_roi - ((1 - win_rate / 100) * median_loss_roi)) / greatest(1, days_active) as compounding_score
    FROM wallet_metrics
  `;

  const metricsResult = await clickhouse.query({
    query: metricsQuery,
    format: 'JSONEachRow'
  });

  const metrics = await metricsResult.json<any>();
  const metricsMap = new Map(metrics.map((m: any) => [m.wallet, m]));

  // Build final leaderboard
  console.log('📊 TOP 50 COPYTRADING LEADERBOARD (Ranked by Log Growth per Day)\n');
  console.log('=' .repeat(150));
  console.log('Rank | Wallet        | LogGrowth/Day | ROI%/Day | Trades/Day | Final$  | Copied | Skipped | Edge% | Compound | WinRate% | MedianROI% | LastTrade');
  console.log('=' .repeat(150));

  const leaderboardRows: any[] = [];

  for (let i = 0; i < top50.length; i++) {
    const sim = top50[i];
    const m = metricsMap.get(sim.wallet);

    if (!m) continue;

    const rank = i + 1;
    const walletShort = sim.wallet.substring(0, 10) + '...';
    const daysActive = (sim.lastEventTime - sim.firstEventTime) / 86400;
    const roiPerDay = ((sim.finalBankroll - INITIAL_BANKROLL) / INITIAL_BANKROLL / daysActive * 100);
    const tradesPerDay = m.total_trades / m.days_active;
    const copytradeReturnPctPerDay = (Math.exp(sim.logGrowthPerDay) - 1) * 100;

    console.log(
      `${rank.toString().padStart(4)} | ${walletShort.padEnd(13)} | ` +
      `${sim.logGrowthPerDay.toFixed(4).padStart(13)} | ` +
      `${roiPerDay.toFixed(2).padStart(8)} | ` +
      `${tradesPerDay.toFixed(1).padStart(10)} | ` +
      `${sim.finalBankroll.toFixed(0).padStart(7)} | ` +
      `${sim.tradesCopied.toString().padStart(6)} | ` +
      `${sim.tradesSkipped.toString().padStart(7)} | ` +
      `${m.edge_per_trade.toFixed(1).padStart(5)} | ` +
      `${m.compounding_score.toFixed(2).padStart(8)} | ` +
      `${m.win_rate.toFixed(1).padStart(8)} | ` +
      `${m.median_roi.toFixed(1).padStart(10)} | ` +
      `${new Date(m.last_trade).toISOString().split('T')[0]}`
    );

    leaderboardRows.push({
      rank,
      wallet: sim.wallet,
      logGrowthPerDay: sim.logGrowthPerDay,
      copytradeReturnPctPerDay,
      roiPctPerDay: roiPerDay,
      tradesPerDay,
      finalBankroll: sim.finalBankroll,
      tradesCopied: sim.tradesCopied,
      tradesSkipped: sim.tradesSkipped,
      edgePerTrade: m.edge_per_trade,
      compoundingScore: m.compounding_score,
      winRate: m.win_rate,
      medianROI: m.median_roi,
      lastTrade: m.last_trade
    });
  }

  console.log('=' .repeat(150) + '\n');

  // Export CSV
  const csvPath = '/Users/scotty/Projects/Cascadian-app/copytrade-leaderboard-90d-top50.csv';
  const csvHeader = 'rank,wallet,logGrowthPerDay,copytradeReturnPctPerDay,roiPctPerDay,tradesPerDay,finalBankroll,tradesCopied,tradesSkipped,edgePerTrade,compoundingScore,winRate,medianROI,lastTrade\n';
  const csvRows = leaderboardRows.map(r =>
    `${r.rank},${r.wallet},${r.logGrowthPerDay},${r.copytradeReturnPctPerDay},${r.roiPctPerDay},${r.tradesPerDay},${r.finalBankroll},${r.tradesCopied},${r.tradesSkipped},${r.edgePerTrade},${r.compoundingScore},${r.winRate},${r.medianROI},${r.lastTrade}`
  ).join('\n');

  writeFileSync(csvPath, csvHeader + csvRows);

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅ Leaderboard complete in ${totalElapsed} minutes`);
  console.log(`📄 CSV exported: ${csvPath}\n`);
}

main().catch(console.error);
