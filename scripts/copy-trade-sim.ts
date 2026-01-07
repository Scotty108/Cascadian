/**
 * Copy Trading Simulator - Trade by Trade
 * Simulates $1 flat bets on each resolved position using ACTUAL entry prices
 *
 * OPTIMIZED: Gets last N trades first, then joins
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000,
});

const wallet = process.argv[2] || '0xf9442951035b143f3b5a30bb4fa1f4f6b908c249';
const LIMIT = parseInt(process.argv[3] || '50');

async function simulate() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`COPY TRADING SIMULATION: ${wallet.slice(0, 14)}...`);
  console.log(`Last ${LIMIT} resolved positions with $1 flat bets`);
  console.log(`${"=".repeat(70)}\n`);

  // STEP 1: Get BUY trades for this wallet (no ORDER BY - sort in JS)
  console.log('Step 1: Fetching trades (no sort)...');
  const tradesQuery = `
    SELECT
      event_id,
      token_id,
      side,
      usdc_amount / 1000000.0 as usdc,
      token_amount / 1000000.0 as tokens,
      trade_time
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
      AND lower(side) = 'buy'
    LIMIT 5000
  `;

  const tradesResult = await ch.query({ query: tradesQuery, format: 'JSONEachRow' });
  let trades: any[] = await tradesResult.json();
  console.log(`  Found ${trades.length} buy trades`);

  // Sort by trade_time DESC in JS (avoids ClickHouse sort bottleneck)
  trades.sort((a, b) => new Date(b.trade_time).getTime() - new Date(a.trade_time).getTime());

  if (trades.length === 0) {
    console.log('No trades found for this wallet.');
    await ch.close();
    return;
  }

  // Get unique token IDs
  const tokenIds = [...new Set(trades.map(t => t.token_id.toString()))];
  console.log(`  Unique tokens: ${tokenIds.length}`);

  // STEP 2: Get token mappings for these tokens
  console.log('Step 2: Mapping tokens to conditions...');
  const tokenList = tokenIds.map(t => `'${t}'`).join(',');
  const mapQuery = `
    SELECT token_id_dec, condition_id, outcome_index, question
    FROM pm_token_to_condition_map_current
    WHERE token_id_dec IN (${tokenList})
  `;

  const mapResult = await ch.query({ query: mapQuery, format: 'JSONEachRow' });
  const tokenMap: any[] = await mapResult.json();
  const tokenToCondition = new Map(tokenMap.map(m => [m.token_id_dec, m]));
  console.log(`  Mapped: ${tokenMap.length} tokens`);

  // STEP 3: Get resolutions for these conditions
  console.log('Step 3: Fetching resolutions...');
  const conditionIds = [...new Set(tokenMap.map(m => m.condition_id.toLowerCase()))];
  if (conditionIds.length === 0) {
    console.log('No mapped conditions found.');
    await ch.close();
    return;
  }

  const conditionList = conditionIds.map(c => `'${c}'`).join(',');
  const resQuery = `
    SELECT lower(condition_id) as condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${conditionList})
      AND resolved_at IS NOT NULL
  `;

  const resResult = await ch.query({ query: resQuery, format: 'JSONEachRow' });
  const resolutions: any[] = await resResult.json();
  const resolutionMap = new Map(resolutions.map(r => [r.condition_id, r.payout_numerators]));
  console.log(`  Resolved: ${resolutions.length} conditions`);

  // STEP 4: Build positions from trades
  console.log('Step 4: Building positions...\n');

  interface PositionData {
    condition_id: string;
    outcome_index: number;
    question: string;
    total_buy_cost: number;
    total_tokens: number;
    first_buy_time: string;
  }

  const positions = new Map<string, PositionData>();

  for (const trade of trades) {
    const mapping = tokenToCondition.get(trade.token_id.toString());
    if (!mapping) continue;

    const key = `${mapping.condition_id}_${mapping.outcome_index}`;
    const existing = positions.get(key);

    if (existing) {
      existing.total_buy_cost += trade.usdc;
      existing.total_tokens += trade.tokens;
    } else {
      positions.set(key, {
        condition_id: mapping.condition_id,
        outcome_index: mapping.outcome_index,
        question: mapping.question,
        total_buy_cost: trade.usdc,
        total_tokens: trade.tokens,
        first_buy_time: trade.trade_time,
      });
    }
  }

  // STEP 5: Simulate copy trading
  let totalBet = 0;
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  const results: any[] = [];

  for (const [key, pos] of positions) {
    const payoutsStr = resolutionMap.get(pos.condition_id.toLowerCase());
    if (!payoutsStr) continue; // Not resolved

    const payouts = JSON.parse(payoutsStr);
    const won = payouts[pos.outcome_index] === 1;

    const entryPrice = pos.total_buy_cost / pos.total_tokens;
    if (entryPrice <= 0 || entryPrice >= 1) continue;

    // Simulate $1 bet
    const bet = 1.00;
    const tokensAcquired = bet / entryPrice;
    let pnl = won ? tokensAcquired - bet : -bet;

    if (won) wins++;
    else losses++;

    totalBet += bet;
    totalPnl += pnl;

    results.push({
      question: (pos.question || 'Unknown').slice(0, 45),
      entry: entryPrice,
      result: won ? 'WIN' : 'LOSS',
      pnl: pnl,
      actualBet: pos.total_buy_cost,
      actualTokens: pos.total_tokens,
    });
  }

  // Sort by time (most recent first) and limit
  const limitedResults = results.slice(0, LIMIT);

  // Display results
  console.log('POSITION-BY-POSITION RESULTS:');
  console.log('-'.repeat(90));
  console.log('| Result | Entry   | Copy PnL  | Their Bet | Market');
  console.log('-'.repeat(90));

  for (const r of limitedResults) {
    const resultStr = r.result.padEnd(5);
    const entryStr = `$${r.entry.toFixed(3)}`.padStart(7);
    const pnlStr = `$${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}`.padStart(9);
    const betStr = `$${r.actualBet.toFixed(0)}`.padStart(8);
    console.log(`| ${resultStr} | ${entryStr} | ${pnlStr} | ${betStr} | ${r.question}`);
  }

  console.log('-'.repeat(90));

  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const roi = totalBet > 0 ? (totalPnl / totalBet) * 100 : 0;

  // Wallet actual
  const walletTotalBet = limitedResults.reduce((sum, r) => sum + r.actualBet, 0);
  const walletWinnings = limitedResults.filter(r => r.result === 'WIN').reduce((sum, r) => sum + r.actualTokens, 0);
  const walletPnl = walletWinnings - walletTotalBet;
  const walletRoi = walletTotalBet > 0 ? (walletPnl / walletTotalBet) * 100 : 0;

  console.log(`\n${"=".repeat(70)}`);
  console.log('SIMULATION SUMMARY');
  console.log("=".repeat(70));
  console.log(`Positions Analyzed:  ${limitedResults.length}`);
  console.log(`Wins:                ${wins}`);
  console.log(`Losses:              ${losses}`);
  console.log(`Win Rate:            ${winRate.toFixed(1)}%`);
  console.log('-'.repeat(70));
  console.log(`COPY TRADING ($1 flat per position):`);
  console.log(`  Total Bet:         $${totalBet.toFixed(2)}`);
  console.log(`  Net PnL:           $${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`);
  console.log(`  ROI:               ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`);
  console.log('-'.repeat(70));
  console.log(`WALLET ACTUAL (same positions):`);
  console.log(`  Total Bet:         $${walletTotalBet.toFixed(2)}`);
  console.log(`  Net PnL:           $${walletPnl >= 0 ? '+' : ''}${walletPnl.toFixed(2)}`);
  console.log(`  ROI:               ${walletRoi >= 0 ? '+' : ''}${walletRoi.toFixed(1)}%`);
  console.log("=".repeat(70));

  if (limitedResults.length > 0) {
    limitedResults.sort((a, b) => b.pnl - a.pnl);
    console.log(`\nBest Copy Trade:  $${limitedResults[0]?.pnl.toFixed(2)} at $${limitedResults[0]?.entry.toFixed(3)} entry`);
    console.log(`Worst Copy Trade: $${limitedResults[limitedResults.length - 1]?.pnl.toFixed(2)} (loss)`);
  }

  await ch.close();
}

simulate().catch(console.error);
