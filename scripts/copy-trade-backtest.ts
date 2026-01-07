/**
 * Copy Trading Backtester
 *
 * Simulates copying a wallet's trades over the last N days with:
 * - Equal weight position sizing (fixed $ per trade)
 * - Configurable slippage on entry
 * - Exit when they exit (proportional)
 * - Resolution handling (positions that resolve)
 *
 * Usage:
 *   npx tsx scripts/copy-trade-backtest.ts <wallet> [days] [positionSize] [slippagePct]
 *
 * Examples:
 *   npx tsx scripts/copy-trade-backtest.ts 0x03a9f592e5eb9a34f0df6c41c3a37c1f063237ba
 *   npx tsx scripts/copy-trade-backtest.ts 0x03a9f592... 14 100 0.02
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

interface BacktestConfig {
  wallet: string;
  days: number;           // Lookback period
  positionSize: number;   // $ per position (equal weight)
  slippagePct: number;    // Entry slippage (e.g., 0.02 = 2%)
  minPrice: number;       // Skip arb territory (e.g., 0.90)
  maxPrice: number;       // Skip extreme prices
}

const DEFAULT_CONFIG: Omit<BacktestConfig, 'wallet'> = {
  days: 14,
  positionSize: 100,      // $100 per position
  slippagePct: 0.02,      // 2% worse entry
  minPrice: 0.05,         // Skip < 5¢
  maxPrice: 0.90,         // Skip > 90¢ (arb territory)
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Trade {
  event_id: string;
  token_id: string;
  side: 'buy' | 'sell';
  price: number;          // USDC per token
  usdc: number;
  tokens: number;
  trade_time: string;
  condition_id: string | null;
  question: string | null;
}

interface SimulatedPosition {
  token_id: string;
  question: string | null;
  entry_price: number;    // Their entry price
  our_entry_price: number; // With slippage
  tokens_held: number;    // Our tokens
  cost_basis: number;     // Our $ invested
  entry_time: string;
  exits: Array<{
    price: number;
    tokens: number;
    proceeds: number;
    time: string;
  }>;
  resolution_payout: number | null;  // 0, 0.5, or 1 if resolved
  status: 'open' | 'closed' | 'resolved';
}

interface BacktestResult {
  config: BacktestConfig;
  summary: {
    total_positions: number;
    positions_closed: number;
    positions_resolved: number;
    positions_open: number;
    total_invested: number;
    total_returned: number;
    net_pnl: number;
    return_pct: number;
    win_rate: number;
    avg_win: number;
    avg_loss: number;
  };
  positions: SimulatedPosition[];
  their_pnl: number;
  comparison: {
    our_return_pct: number;
    their_return_pct: number;
    outperformance: number;
  };
}

// -----------------------------------------------------------------------------
// Data Loading
// -----------------------------------------------------------------------------

async function loadTrades(wallet: string, days: number): Promise<Trade[]> {
  const query = `
    WITH filtered AS (
      SELECT *
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND trade_time >= now() - INTERVAL ${days} DAY
    ),
    deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time
      FROM filtered
      GROUP BY event_id
    )
    SELECT
      d.event_id,
      d.token_id,
      d.side,
      d.usdc,
      d.tokens,
      d.usdc / nullIf(d.tokens, 0) as price,
      d.trade_time,
      m.condition_id,
      m.question
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_current m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time ASC
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    event_id: r.event_id,
    token_id: r.token_id,
    side: r.side as 'buy' | 'sell',
    price: parseFloat(r.price) || 0,
    usdc: parseFloat(r.usdc) || 0,
    tokens: parseFloat(r.tokens) || 0,
    trade_time: r.trade_time,
    condition_id: r.condition_id,
    question: r.question,
  }));
}

async function loadResolutions(conditionIds: string[]): Promise<Map<string, number>> {
  if (conditionIds.length === 0) return new Map();

  const conditionList = conditionIds.map(c => `'${c}'`).join(',');

  const query = `
    SELECT
      condition_id,
      payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${conditionList.toLowerCase()})
      AND is_deleted = 0
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const resolutions = new Map<string, number>();

  for (const row of rows) {
    try {
      const payouts = JSON.parse(row.payout_numerators);
      // For binary markets, outcome 0 wins if payouts[0] > 0
      // Store as map: condition_id -> winning_outcome (0 or 1)
      if (payouts[0] > 0) {
        resolutions.set(row.condition_id.toLowerCase(), 0);
      } else {
        resolutions.set(row.condition_id.toLowerCase(), 1);
      }
    } catch {}
  }

  return resolutions;
}

// -----------------------------------------------------------------------------
// Backtest Engine
// -----------------------------------------------------------------------------

async function runBacktest(cfg: BacktestConfig): Promise<BacktestResult> {
  console.log(`\nLoading trades for ${cfg.wallet.slice(0, 10)}... (last ${cfg.days} days)`);

  const trades = await loadTrades(cfg.wallet, cfg.days);
  console.log(`Found ${trades.length} trades`);

  // Get unique condition IDs for resolution lookup
  const conditionIds = [...new Set(trades.map(t => t.condition_id).filter(Boolean))] as string[];
  const resolutions = await loadResolutions(conditionIds);
  console.log(`Found ${resolutions.size} resolved conditions`);

  // Build token -> outcome_index map
  const tokenOutcomeMap = new Map<string, number>();
  const tokenConditionMap = new Map<string, string>();

  for (const trade of trades) {
    if (trade.condition_id) {
      tokenConditionMap.set(trade.token_id, trade.condition_id.toLowerCase());
    }
  }

  // Load outcome indices
  const tokenIds = [...new Set(trades.map(t => t.token_id))];
  if (tokenIds.length > 0) {
    const tokenList = tokenIds.map(t => `'${t}'`).join(',');
    const outcomeQuery = `
      SELECT token_id_dec, outcome_index
      FROM pm_token_to_condition_map_current
      WHERE token_id_dec IN (${tokenList})
    `;
    const outcomeResult = await client.query({ query: outcomeQuery, format: 'JSONEachRow' });
    const outcomeRows = await outcomeResult.json() as any[];
    for (const row of outcomeRows) {
      tokenOutcomeMap.set(row.token_id_dec, parseInt(row.outcome_index));
    }
  }

  // Track their positions (to know when they exit)
  const theirPositions = new Map<string, number>(); // token_id -> tokens held

  // Our simulated positions
  const ourPositions = new Map<string, SimulatedPosition>();

  // Process trades chronologically
  for (const trade of trades) {
    // Skip arb territory and extreme prices
    if (trade.price < cfg.minPrice || trade.price > cfg.maxPrice) {
      continue;
    }

    if (trade.side === 'buy') {
      // They're buying - we should also buy (if we don't have this position)
      const currentTheirs = theirPositions.get(trade.token_id) || 0;
      theirPositions.set(trade.token_id, currentTheirs + trade.tokens);

      // Only enter if we don't already have this position
      if (!ourPositions.has(trade.token_id)) {
        const ourEntryPrice = trade.price * (1 + cfg.slippagePct); // Worse price for us
        const tokensWeBuy = cfg.positionSize / ourEntryPrice;

        ourPositions.set(trade.token_id, {
          token_id: trade.token_id,
          question: trade.question,
          entry_price: trade.price,
          our_entry_price: ourEntryPrice,
          tokens_held: tokensWeBuy,
          cost_basis: cfg.positionSize,
          entry_time: trade.trade_time,
          exits: [],
          resolution_payout: null,
          status: 'open',
        });
      }
    } else {
      // They're selling - we should also sell (proportionally)
      const currentTheirs = theirPositions.get(trade.token_id) || 0;
      const sellRatio = currentTheirs > 0 ? trade.tokens / currentTheirs : 1;
      theirPositions.set(trade.token_id, Math.max(0, currentTheirs - trade.tokens));

      const ourPos = ourPositions.get(trade.token_id);
      if (ourPos && ourPos.status === 'open' && ourPos.tokens_held > 0) {
        // Sell proportionally to their exit
        const tokensToSell = Math.min(ourPos.tokens_held, ourPos.tokens_held * sellRatio);
        const exitPrice = trade.price * (1 - cfg.slippagePct); // Worse price for us on exit too
        const proceeds = tokensToSell * exitPrice;

        ourPos.exits.push({
          price: exitPrice,
          tokens: tokensToSell,
          proceeds,
          time: trade.trade_time,
        });

        ourPos.tokens_held -= tokensToSell;

        if (ourPos.tokens_held < 0.01) {
          ourPos.status = 'closed';
          ourPos.tokens_held = 0;
        }
      }
    }
  }

  // Handle resolutions for remaining open positions
  for (const [tokenId, pos] of ourPositions.entries()) {
    if (pos.status === 'open' && pos.tokens_held > 0) {
      const conditionId = tokenConditionMap.get(tokenId);
      if (conditionId && resolutions.has(conditionId)) {
        const winningOutcome = resolutions.get(conditionId)!;
        const ourOutcome = tokenOutcomeMap.get(tokenId);

        if (ourOutcome !== undefined) {
          // Did we win?
          const payout = ourOutcome === winningOutcome ? 1.0 : 0.0;
          pos.resolution_payout = payout;
          pos.status = 'resolved';

          // Add resolution as final exit
          pos.exits.push({
            price: payout,
            tokens: pos.tokens_held,
            proceeds: pos.tokens_held * payout,
            time: new Date().toISOString(),
          });
          pos.tokens_held = 0;
        }
      }
    }
  }

  // Calculate results
  const positions = Array.from(ourPositions.values());

  let totalInvested = 0;
  let totalReturned = 0;
  let wins = 0;
  let losses = 0;
  let winAmounts: number[] = [];
  let lossAmounts: number[] = [];

  for (const pos of positions) {
    totalInvested += pos.cost_basis;
    const exitProceeds = pos.exits.reduce((sum, e) => sum + e.proceeds, 0);
    const unrealizedValue = pos.tokens_held * (pos.our_entry_price * 0.9); // Estimate open positions at slight discount
    const totalValue = exitProceeds + unrealizedValue;
    totalReturned += totalValue;

    const pnl = totalValue - pos.cost_basis;
    if (pnl > 0) {
      wins++;
      winAmounts.push(pnl);
    } else {
      losses++;
      lossAmounts.push(pnl);
    }
  }

  // Calculate their PnL for comparison
  const theirPnlQuery = `
    SELECT
      (sumIf(usdc_amount, side = 'sell') - sumIf(usdc_amount, side = 'buy')) / 1e6 as cash_flow
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${cfg.wallet}')
      AND is_deleted = 0
      AND trade_time >= now() - INTERVAL ${cfg.days} DAY
  `;
  const theirResult = await client.query({ query: theirPnlQuery, format: 'JSONEachRow' });
  const theirRows = await theirResult.json() as any[];
  const theirCashFlow = parseFloat(theirRows[0]?.cash_flow) || 0;

  const netPnl = totalReturned - totalInvested;
  const returnPct = totalInvested > 0 ? (netPnl / totalInvested) * 100 : 0;

  return {
    config: cfg,
    summary: {
      total_positions: positions.length,
      positions_closed: positions.filter(p => p.status === 'closed').length,
      positions_resolved: positions.filter(p => p.status === 'resolved').length,
      positions_open: positions.filter(p => p.status === 'open').length,
      total_invested: totalInvested,
      total_returned: totalReturned,
      net_pnl: netPnl,
      return_pct: returnPct,
      win_rate: positions.length > 0 ? (wins / positions.length) * 100 : 0,
      avg_win: winAmounts.length > 0 ? winAmounts.reduce((a, b) => a + b, 0) / winAmounts.length : 0,
      avg_loss: lossAmounts.length > 0 ? lossAmounts.reduce((a, b) => a + b, 0) / lossAmounts.length : 0,
    },
    positions,
    their_pnl: theirCashFlow,
    comparison: {
      our_return_pct: returnPct,
      their_return_pct: 0, // Would need their capital to calculate
      outperformance: 0,
    },
  };
}

// -----------------------------------------------------------------------------
// Output Formatting
// -----------------------------------------------------------------------------

function printResults(result: BacktestResult): void {
  const { config: cfg, summary, positions } = result;

  console.log('\n' + '═'.repeat(80));
  console.log('COPY TRADING BACKTEST RESULTS');
  console.log('═'.repeat(80));

  console.log('\n📋 Configuration:');
  console.log(`   Wallet: ${cfg.wallet}`);
  console.log(`   Period: Last ${cfg.days} days`);
  console.log(`   Position Size: $${cfg.positionSize} per trade`);
  console.log(`   Slippage: ${(cfg.slippagePct * 100).toFixed(1)}%`);
  console.log(`   Price Filter: ${cfg.minPrice * 100}¢ - ${cfg.maxPrice * 100}¢`);

  console.log('\n📊 Summary:');
  console.log(`   Total Positions: ${summary.total_positions}`);
  console.log(`   ├─ Closed: ${summary.positions_closed}`);
  console.log(`   ├─ Resolved: ${summary.positions_resolved}`);
  console.log(`   └─ Open: ${summary.positions_open}`);
  console.log('');
  console.log(`   Total Invested: $${summary.total_invested.toFixed(2)}`);
  console.log(`   Total Returned: $${summary.total_returned.toFixed(2)}`);
  console.log(`   Net PnL: $${summary.net_pnl.toFixed(2)} (${summary.return_pct >= 0 ? '+' : ''}${summary.return_pct.toFixed(1)}%)`);
  console.log('');
  console.log(`   Win Rate: ${summary.win_rate.toFixed(1)}%`);
  console.log(`   Avg Win: $${summary.avg_win.toFixed(2)}`);
  console.log(`   Avg Loss: $${summary.avg_loss.toFixed(2)}`);

  console.log('\n💰 Their Cash Flow (same period): $' + result.their_pnl.toFixed(2));

  // Show top winning and losing positions
  const sortedByPnl = [...positions].map(p => {
    const proceeds = p.exits.reduce((sum, e) => sum + e.proceeds, 0);
    const unrealized = p.tokens_held * p.our_entry_price * 0.9;
    return { ...p, pnl: proceeds + unrealized - p.cost_basis };
  }).sort((a, b) => b.pnl - a.pnl);

  console.log('\n🏆 Top 5 Winners:');
  sortedByPnl.slice(0, 5).forEach((p, i) => {
    const question = p.question?.slice(0, 40) || p.token_id.slice(0, 20);
    console.log(`   ${i + 1}. ${question}... | Entry: ${(p.entry_price * 100).toFixed(0)}¢ | PnL: $${p.pnl.toFixed(2)}`);
  });

  console.log('\n💀 Top 5 Losers:');
  sortedByPnl.slice(-5).reverse().forEach((p, i) => {
    const question = p.question?.slice(0, 40) || p.token_id.slice(0, 20);
    console.log(`   ${i + 1}. ${question}... | Entry: ${(p.entry_price * 100).toFixed(0)}¢ | PnL: $${p.pnl.toFixed(2)}`);
  });

  console.log('\n' + '═'.repeat(80));
}

// -----------------------------------------------------------------------------
// Batch Mode
// -----------------------------------------------------------------------------

interface BatchResult {
  wallet: string;
  name?: string;
  net_pnl: number;
  return_pct: number;
  win_rate: number;
  total_positions: number;
  error?: string;
}

async function runBatch(wallets: Array<{ address: string; name?: string }>, baseConfig: Omit<BacktestConfig, 'wallet'>): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (const w of wallets) {
    try {
      const config: BacktestConfig = { ...baseConfig, wallet: w.address };
      const result = await runBacktest(config);
      results.push({
        wallet: w.address,
        name: w.name,
        net_pnl: result.summary.net_pnl,
        return_pct: result.summary.return_pct,
        win_rate: result.summary.win_rate,
        total_positions: result.summary.total_positions,
      });
    } catch (error: any) {
      results.push({
        wallet: w.address,
        name: w.name,
        net_pnl: 0,
        return_pct: 0,
        win_rate: 0,
        total_positions: 0,
        error: error.message,
      });
    }
  }

  return results;
}

function printBatchResults(results: BatchResult[], config: Omit<BacktestConfig, 'wallet'>): void {
  console.log('\n' + '═'.repeat(100));
  console.log('COPY TRADING BATCH BACKTEST RESULTS');
  console.log('═'.repeat(100));
  console.log(`Config: ${config.days}d lookback | $${config.positionSize}/position | ${(config.slippagePct * 100).toFixed(1)}% slippage`);
  console.log('');

  // Sort by return %
  const sorted = [...results].sort((a, b) => b.return_pct - a.return_pct);

  console.log('┌────────────────────────────────────────────────┬────────────┬───────────┬──────────┬───────────┐');
  console.log('│ Wallet                                         │ Net PnL    │ Return %  │ Win Rate │ Positions │');
  console.log('├────────────────────────────────────────────────┼────────────┼───────────┼──────────┼───────────┤');

  for (const r of sorted) {
    const walletDisplay = r.name ? `${r.name} (${r.wallet.slice(0, 8)}...)` : `${r.wallet.slice(0, 42)}...`;
    const pnlStr = r.error ? 'ERROR' : `$${r.net_pnl >= 0 ? '+' : ''}${r.net_pnl.toFixed(0)}`.padStart(9);
    const retStr = r.error ? 'ERROR' : `${r.return_pct >= 0 ? '+' : ''}${r.return_pct.toFixed(1)}%`.padStart(8);
    const wrStr = r.error ? '-' : `${r.win_rate.toFixed(0)}%`.padStart(7);
    const posStr = r.error ? '-' : `${r.total_positions}`.padStart(8);

    console.log(`│ ${walletDisplay.padEnd(46)} │ ${pnlStr} │ ${retStr} │ ${wrStr} │ ${posStr} │`);
  }

  console.log('└────────────────────────────────────────────────┴────────────┴───────────┴──────────┴───────────┘');

  // Summary stats
  const validResults = results.filter(r => !r.error);
  if (validResults.length > 0) {
    const avgReturn = validResults.reduce((sum, r) => sum + r.return_pct, 0) / validResults.length;
    const totalPnl = validResults.reduce((sum, r) => sum + r.net_pnl, 0);
    const profitable = validResults.filter(r => r.return_pct > 0).length;

    console.log('');
    console.log(`Summary: ${profitable}/${validResults.length} profitable wallets | Avg Return: ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}% | Total PnL: $${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}`);
  }
}

// -----------------------------------------------------------------------------
// Exported API
// -----------------------------------------------------------------------------

export { runBacktest, runBatch, BacktestConfig, BacktestResult, BatchResult };

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/copy-trade-backtest.ts <wallet|--batch> [days] [positionSize] [slippagePct]');
    console.log('');
    console.log('Single wallet:');
    console.log('  npx tsx scripts/copy-trade-backtest.ts 0x03a9f592e5eb9a34f0df6c41c3a37c1f063237ba');
    console.log('  npx tsx scripts/copy-trade-backtest.ts 0x03a9f592... 14 100 0.02');
    console.log('');
    console.log('Batch mode (top leaderboard wallets):');
    console.log('  npx tsx scripts/copy-trade-backtest.ts --batch 14 100 0.02');
    process.exit(1);
  }

  const isBatch = args[0] === '--batch';
  const days = parseInt(args[isBatch ? 1 : 1]) || DEFAULT_CONFIG.days;
  const positionSize = parseFloat(args[isBatch ? 2 : 2]) || DEFAULT_CONFIG.positionSize;
  const slippagePct = parseFloat(args[isBatch ? 3 : 3]) || DEFAULT_CONFIG.slippagePct;

  const baseConfig = {
    days,
    positionSize,
    slippagePct,
    minPrice: DEFAULT_CONFIG.minPrice,
    maxPrice: DEFAULT_CONFIG.maxPrice,
  };

  try {
    if (isBatch) {
      // Top wallets from leaderboard
      const topWallets = [
        { address: '0x03a9f592e5eb9a34f0df6c41c3a37c1f063237ba', name: '@Btlenc9' },
        { address: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: '@Latina' },
        { address: '0x060e94156048701cbf65b8e567ffe96b11742384', name: 'NBA Doubler' },
        { address: '0x84cb17a50bc2487e8d64029783c3d2abcba328ad', name: 'Breakout' },
        { address: '0xabb89972b21b304c1bed2bf26f35c8741ac9bba3', name: 'NFL Spreads' },
        { address: '0xa07c39ac29cc1bfc632db9dd6017483e43b411a0', name: '@jacobpnl' },
        { address: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: 'Runner2' },
        { address: '0x18d12d50c2aa036ba87eb0c24a1f8c7dffa4f383', name: 'NBA High Vol' },
      ];

      console.log(`Running batch backtest on ${topWallets.length} wallets...`);
      const results = await runBatch(topWallets, baseConfig);
      printBatchResults(results, baseConfig);

    } else {
      const wallet = args[0];
      const config: BacktestConfig = { ...baseConfig, wallet };

      const result = await runBacktest(config);
      printResults(result);

      console.log('\n📄 JSON Output (for programmatic use):');
      console.log(JSON.stringify({
        wallet: config.wallet,
        days: config.days,
        position_size: config.positionSize,
        slippage_pct: config.slippagePct,
        ...result.summary,
      }, null, 2));
    }

  } catch (error) {
    console.error('Error running backtest:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
