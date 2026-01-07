/**
 * Metrics Validation Script
 *
 * Calculates core metrics for a wallet and outputs them for manual validation
 * against Polymarket UI.
 *
 * Core Metrics (to be validated one by one):
 * 1. Realized PnL
 * 2. # of trades
 * 3. # of winning trades
 * 4. # of losing trades
 * 5. Win rate % (trades)
 * 6. Avg ROI % per winning trade
 * 7. Avg ROI % per losing trade
 * 8. Average ROI % (whole)
 * 9. Last trade date
 * 10. Trades in the last 30 days
 * 11. Markets traded
 * 12. Winning markets
 * 13. Losing markets
 * 14. Win rate % (markets)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface MarketResult {
  condition_id: string;
  question: string;
  total_bet: number;      // Cost basis
  amount_won: number;     // What they got back
  pnl: number;           // Profit/Loss
  roi_pct: number;       // ROI %
  outcome: 'won' | 'lost' | 'open';
}

interface WalletMetrics {
  wallet: string;

  // PnL
  realized_pnl: number;

  // Trade counts (individual fills)
  total_trades: number;
  trades_last_30d: number;
  last_trade_date: string;

  // Market-level metrics (positions)
  markets_traded: number;
  winning_markets: number;
  losing_markets: number;
  open_markets: number;
  market_win_rate: number;

  // ROI metrics
  avg_roi_winners: number;
  avg_roi_losers: number;
  avg_roi_overall: number;

  // Detailed market breakdown
  markets: MarketResult[];
}

async function getWalletMetrics(wallet: string): Promise<WalletMetrics> {
  console.log(`\nCalculating metrics for ${wallet.slice(0, 10)}...`);

  // 1. Get MAKER-ONLY trades (to match CCR-v1 semantics and avoid double-counting)
  const tradesQuery = `
    WITH filtered AS (
      SELECT *
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'  -- CRITICAL: maker-only to avoid double-counting
    ),
    deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        any(role) as role
      FROM filtered
      GROUP BY event_id
    )
    SELECT
      d.event_id,
      d.token_id,
      d.side,
      d.usdc,
      d.tokens,
      d.trade_time,
      d.role,
      m.condition_id,
      m.outcome_index,
      m.question
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_current m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time ASC
  `;

  const tradesResult = await client.query({ query: tradesQuery, format: 'JSONEachRow' });
  const trades = await tradesResult.json() as any[];

  console.log(`  Found ${trades.length} trades (deduped)`);

  // 2. Get resolutions
  const conditionIds = [...new Set(trades.map(t => t.condition_id).filter(Boolean))];
  const resolutions = new Map<string, { winning_outcome: number }>();

  if (conditionIds.length > 0) {
    const conditionList = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');
    const resQuery = `
      SELECT condition_id, payout_numerators
      FROM pm_condition_resolutions
      WHERE lower(condition_id) IN (${conditionList})
        AND is_deleted = 0
    `;
    const resResult = await client.query({ query: resQuery, format: 'JSONEachRow' });
    const resRows = await resResult.json() as any[];

    for (const row of resRows) {
      try {
        const payouts = JSON.parse(row.payout_numerators);
        const winningOutcome = payouts[0] > 0 ? 0 : 1;
        resolutions.set(row.condition_id.toLowerCase(), { winning_outcome: winningOutcome });
      } catch {}
    }
  }

  console.log(`  Found ${resolutions.size} resolved markets`);

  // 3. Aggregate by market (condition_id + outcome_index)
  const marketMap = new Map<string, {
    condition_id: string;
    outcome_index: number;
    question: string;
    buys_usdc: number;
    buys_tokens: number;
    sells_usdc: number;
    sells_tokens: number;
    first_trade: string;
    last_trade: string;
  }>();

  for (const trade of trades) {
    if (!trade.condition_id) continue;

    const key = `${trade.condition_id.toLowerCase()}_${trade.outcome_index}`;

    if (!marketMap.has(key)) {
      marketMap.set(key, {
        condition_id: trade.condition_id.toLowerCase(),
        outcome_index: parseInt(trade.outcome_index),
        question: trade.question || 'Unknown',
        buys_usdc: 0,
        buys_tokens: 0,
        sells_usdc: 0,
        sells_tokens: 0,
        first_trade: trade.trade_time,
        last_trade: trade.trade_time,
      });
    }

    const m = marketMap.get(key)!;
    if (trade.side === 'buy') {
      m.buys_usdc += parseFloat(trade.usdc) || 0;
      m.buys_tokens += parseFloat(trade.tokens) || 0;
    } else {
      m.sells_usdc += parseFloat(trade.usdc) || 0;
      m.sells_tokens += parseFloat(trade.tokens) || 0;
    }

    if (trade.trade_time > m.last_trade) m.last_trade = trade.trade_time;
    if (trade.trade_time < m.first_trade) m.first_trade = trade.trade_time;
  }

  // 4. Calculate market-level PnL
  const markets: MarketResult[] = [];
  let totalPnl = 0;
  let winningMarkets = 0;
  let losingMarkets = 0;
  let openMarkets = 0;
  const winnerRois: number[] = [];
  const loserRois: number[] = [];

  for (const [key, m] of marketMap) {
    const resolution = resolutions.get(m.condition_id);
    const tokensHeld = m.buys_tokens - m.sells_tokens;

    let amountWon = m.sells_usdc; // Start with what they sold for
    let outcome: 'won' | 'lost' | 'open' = 'open';

    if (resolution && tokensHeld > 0.01) {
      // Position resolved with tokens held
      const didWin = resolution.winning_outcome === m.outcome_index;
      const resolutionValue = didWin ? tokensHeld : 0;
      amountWon += resolutionValue;
      outcome = amountWon > m.buys_usdc ? 'won' : 'lost';
    } else if (resolution && tokensHeld <= 0.01) {
      // Fully exited before resolution
      outcome = m.sells_usdc > m.buys_usdc ? 'won' : 'lost';
    } else if (tokensHeld > 0.01) {
      // Still open
      outcome = 'open';
    } else {
      // Fully exited, no resolution needed
      outcome = m.sells_usdc > m.buys_usdc ? 'won' : 'lost';
    }

    const pnl = amountWon - m.buys_usdc;
    const roi = m.buys_usdc > 0 ? (pnl / m.buys_usdc) * 100 : 0;

    if (outcome === 'won') {
      winningMarkets++;
      winnerRois.push(roi);
    } else if (outcome === 'lost') {
      losingMarkets++;
      loserRois.push(roi);
    } else {
      openMarkets++;
    }

    if (outcome !== 'open') {
      totalPnl += pnl;
    }

    markets.push({
      condition_id: m.condition_id,
      question: m.question,
      total_bet: m.buys_usdc,
      amount_won: amountWon,
      pnl,
      roi_pct: roi,
      outcome,
    });
  }

  // 5. Calculate trade-level stats
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const tradesLast30d = trades.filter(t => new Date(t.trade_time) >= thirtyDaysAgo).length;
  const lastTradeDate = trades.length > 0 ? trades[trades.length - 1].trade_time : 'N/A';

  // 6. Calculate averages
  const avgRoiWinners = winnerRois.length > 0
    ? winnerRois.reduce((a, b) => a + b, 0) / winnerRois.length
    : 0;
  const avgRoiLosers = loserRois.length > 0
    ? loserRois.reduce((a, b) => a + b, 0) / loserRois.length
    : 0;
  const allRois = [...winnerRois, ...loserRois];
  const avgRoiOverall = allRois.length > 0
    ? allRois.reduce((a, b) => a + b, 0) / allRois.length
    : 0;

  return {
    wallet,
    realized_pnl: totalPnl,
    total_trades: trades.length,
    trades_last_30d: tradesLast30d,
    last_trade_date: lastTradeDate,
    markets_traded: marketMap.size,
    winning_markets: winningMarkets,
    losing_markets: losingMarkets,
    open_markets: openMarkets,
    market_win_rate: (winningMarkets + losingMarkets) > 0
      ? (winningMarkets / (winningMarkets + losingMarkets)) * 100
      : 0,
    avg_roi_winners: avgRoiWinners,
    avg_roi_losers: avgRoiLosers,
    avg_roi_overall: avgRoiOverall,
    markets: markets.sort((a, b) => b.pnl - a.pnl),
  };
}

function printMetrics(metrics: WalletMetrics, uiValues?: Record<string, any>): void {
  console.log('\n' + '═'.repeat(80));
  console.log('METRICS VALIDATION REPORT');
  console.log('═'.repeat(80));
  console.log(`Wallet: ${metrics.wallet}`);
  console.log('');

  console.log('┌────────────────────────────────┬───────────────────┬───────────────────┬──────────┐');
  console.log('│ Metric                         │ Our Calculation   │ UI Value          │ Match?   │');
  console.log('├────────────────────────────────┼───────────────────┼───────────────────┼──────────┤');

  const formatVal = (v: any) => {
    if (typeof v === 'number') {
      if (Math.abs(v) >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      return v.toFixed(2);
    }
    return String(v);
  };

  const rows = [
    ['Realized PnL', `$${metrics.realized_pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, uiValues?.realized_pnl || '?'],
    ['# of Trades', metrics.total_trades.toString(), uiValues?.trades || '?'],
    ['Markets Traded', metrics.markets_traded.toString(), uiValues?.predictions || '?'],
    ['Winning Markets', metrics.winning_markets.toString(), uiValues?.winning_markets || '?'],
    ['Losing Markets', metrics.losing_markets.toString(), uiValues?.losing_markets || '?'],
    ['Open Markets', metrics.open_markets.toString(), '-'],
    ['Win Rate % (Markets)', `${metrics.market_win_rate.toFixed(1)}%`, uiValues?.win_rate || '?'],
    ['Avg ROI % (Winners)', `${metrics.avg_roi_winners.toFixed(1)}%`, uiValues?.avg_roi_winners || '?'],
    ['Avg ROI % (Losers)', `${metrics.avg_roi_losers.toFixed(1)}%`, uiValues?.avg_roi_losers || '?'],
    ['Avg ROI % (Overall)', `${metrics.avg_roi_overall.toFixed(1)}%`, uiValues?.avg_roi_overall || '?'],
    ['Trades Last 30d', metrics.trades_last_30d.toString(), uiValues?.trades_30d || '?'],
    ['Last Trade Date', metrics.last_trade_date.slice(0, 19), uiValues?.last_trade || '?'],
  ];

  for (const [metric, ours, ui] of rows) {
    const match = ui === '?' || ui === '-' ? '-' : (ours === ui ? '✅' : '❌');
    console.log(`│ ${metric.padEnd(30)} │ ${String(ours).padEnd(17)} │ ${String(ui).padEnd(17)} │ ${match.padEnd(8)} │`);
  }

  console.log('└────────────────────────────────┴───────────────────┴───────────────────┴──────────┘');

  // Show top 10 markets by PnL
  console.log('\n📊 Top 10 Markets by PnL:');
  console.log('─'.repeat(100));

  const closedMarkets = metrics.markets.filter(m => m.outcome !== 'open');
  const topMarkets = closedMarkets.slice(0, 10);

  for (const m of topMarkets) {
    const emoji = m.outcome === 'won' ? '✅' : '❌';
    const question = m.question.slice(0, 40).padEnd(40);
    const bet = `$${m.total_bet.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padStart(10);
    const won = `$${m.amount_won.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padStart(10);
    const pnl = `$${m.pnl >= 0 ? '+' : ''}${m.pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padStart(12);
    const roi = `${m.roi_pct >= 0 ? '+' : ''}${m.roi_pct.toFixed(1)}%`.padStart(8);
    console.log(`${emoji} ${question} | Bet: ${bet} | Won: ${won} | PnL: ${pnl} | ROI: ${roi}`);
  }

  // Show worst 5
  console.log('\n📉 Bottom 5 Markets by PnL:');
  console.log('─'.repeat(100));

  const bottomMarkets = closedMarkets.slice(-5).reverse();

  for (const m of bottomMarkets) {
    const emoji = m.outcome === 'won' ? '✅' : '❌';
    const question = m.question.slice(0, 40).padEnd(40);
    const bet = `$${m.total_bet.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padStart(10);
    const won = `$${m.amount_won.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padStart(10);
    const pnl = `$${m.pnl >= 0 ? '+' : ''}${m.pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.padStart(12);
    const roi = `${m.roi_pct >= 0 ? '+' : ''}${m.roi_pct.toFixed(1)}%`.padStart(8);
    console.log(`${emoji} ${question} | Bet: ${bet} | Won: ${won} | PnL: ${pnl} | ROI: ${roi}`);
  }

  console.log('\n' + '═'.repeat(80));
}

async function main() {
  const wallet = process.argv[2] || '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae'; // @Latina

  // UI values from Polymarket (manually observed)
  const uiValues = {
    realized_pnl: '$519,150',  // From profile header
    predictions: '52',         // "Predictions" in profile
    // We'll fill in more as we validate
  };

  try {
    const metrics = await getWalletMetrics(wallet);
    printMetrics(metrics, uiValues);

    // Also output raw JSON for debugging
    console.log('\n📄 Raw JSON:');
    console.log(JSON.stringify({
      wallet: metrics.wallet,
      realized_pnl: metrics.realized_pnl,
      total_trades: metrics.total_trades,
      markets_traded: metrics.markets_traded,
      winning_markets: metrics.winning_markets,
      losing_markets: metrics.losing_markets,
      open_markets: metrics.open_markets,
      market_win_rate: metrics.market_win_rate,
      avg_roi_winners: metrics.avg_roi_winners,
      avg_roi_losers: metrics.avg_roi_losers,
      avg_roi_overall: metrics.avg_roi_overall,
      trades_last_30d: metrics.trades_last_30d,
      last_trade_date: metrics.last_trade_date,
    }, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

main();
