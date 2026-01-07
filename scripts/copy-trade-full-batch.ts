/**
 * Full Batch Copy Trading Simulator
 *
 * Runs simulations for ALL provided wallets with:
 * - $1 flat bets per position
 * - Last 50 resolved positions per wallet
 * - Timeout handling and retries
 * - Final comparison report
 *
 * Usage: npx tsx scripts/copy-trade-full-batch.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

// All 19 wallets to simulate
const WALLETS = [
  '0x829598d4df411c94195094d66e309d56b1c03c7c',
  '0xf9442951035b143f3b5a30bb4fa1f4f6b908c249',
  '0x0bfb8009df6c46c1fdd79b65896cf224dc4526a7',
  '0x3b345c29419b69917d36af2c2be487a0f492cca8',
  '0x82767c3976671a4a73e7752189f4494ec4e61204',
  '0x125eff052d1a4cc9c539f564c92d20697ebf992c',
  '0x92d8a88f0a9fef812bdf5628770d6a0ecee39762',
  '0x4d49acb0ae1c463eb5b1947d174141b812ba7450',
  '0x4f9882a017fac7e1143e9fe7a619268a1a489e1a',
  '0x41fee59d7e6d75f2cf4c47fa5d0d1a50e4b055ec',
  '0x2b2866a724e73bf45af306036f12f20170b4d021',
  '0x1e5642bb6e37c5f395c75c0cb332086c9f350833',
  '0xc30f6390d6fb95c41c1c6c20e3c37b985aa22e65',
  '0x4f490a54aa5b5e9f4bd8bcf6b7103645fc0b231d',
  '0x524bc0719932851b9fe7755d527fd4af197249ac',
  '0x4044798f1d60d92369c86cf5b6f1e497e2818de5',
  '0xd2020940c4b8a45c6e4a4a52b00fedc98585964d',
  '0xaf0e8d81903a627056a60f291fe4db6a596322d5',
  '0x333fa090c317d93168feb7dd81d78d05908943be',
];

const POSITIONS_LIMIT = 50;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

interface WalletResult {
  wallet: string;
  status: 'success' | 'error' | 'no_data';
  error?: string;
  wins: number;
  losses: number;
  winRate: number;
  positionsAnalyzed: number;
  copyTotalBet: number;
  copyPnl: number;
  copyRoi: number;
  walletTotalBet: number;
  walletPnl: number;
  walletRoi: number;
  alpha: number; // copyRoi - walletRoi
  bestTrade?: { pnl: number; entry: number; market: string };
  worstTrade?: { pnl: number; entry: number; market: string };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateWallet(walletAddr: string, attempt = 1): Promise<WalletResult> {
  const shortAddr = walletAddr.slice(0, 10) + '...' + walletAddr.slice(-4);
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[${new Date().toISOString()}] Wallet ${shortAddr} (attempt ${attempt}/${MAX_RETRIES})`);

  const ch = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    request_timeout: 180000, // 3 min per query
  });

  try {
    // STEP 1: Get BUY trades (no ORDER BY - sort in JS to avoid ClickHouse bottleneck)
    console.log('  Step 1: Fetching buy trades...');
    const tradesQuery = `
      SELECT
        event_id,
        token_id,
        usdc_amount / 1000000.0 as usdc,
        token_amount / 1000000.0 as tokens,
        trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${walletAddr}')
        AND is_deleted = 0
        AND lower(side) = 'buy'
      LIMIT 10000
    `;

    const tradesResult = await ch.query({ query: tradesQuery, format: 'JSONEachRow' });
    let trades: any[] = await tradesResult.json();
    console.log(`  Found ${trades.length} buy trades`);

    if (trades.length === 0) {
      await ch.close();
      return {
        wallet: walletAddr,
        status: 'no_data',
        wins: 0, losses: 0, winRate: 0, positionsAnalyzed: 0,
        copyTotalBet: 0, copyPnl: 0, copyRoi: 0,
        walletTotalBet: 0, walletPnl: 0, walletRoi: 0, alpha: 0,
      };
    }

    // Sort by trade_time DESC in JS
    trades.sort((a, b) => new Date(b.trade_time).getTime() - new Date(a.trade_time).getTime());

    // Get unique token IDs
    const tokenIds = [...new Set(trades.map(t => t.token_id.toString()))];
    console.log(`  Unique tokens: ${tokenIds.length}`);

    // STEP 2: Get token mappings
    console.log('  Step 2: Fetching token mappings...');
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

    // STEP 3: Get resolutions
    console.log('  Step 3: Fetching resolutions...');
    const conditionIds = [...new Set(tokenMap.map(m => m.condition_id.toLowerCase()))];

    if (conditionIds.length === 0) {
      await ch.close();
      return {
        wallet: walletAddr,
        status: 'no_data',
        error: 'No mapped conditions',
        wins: 0, losses: 0, winRate: 0, positionsAnalyzed: 0,
        copyTotalBet: 0, copyPnl: 0, copyRoi: 0,
        walletTotalBet: 0, walletPnl: 0, walletRoi: 0, alpha: 0,
      };
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
    console.log('  Step 4: Building positions...');

    interface PositionData {
      condition_id: string;
      outcome_index: number;
      question: string;
      total_buy_cost: number;
      total_tokens: number;
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
          question: mapping.question || 'Unknown',
          total_buy_cost: trade.usdc,
          total_tokens: trade.tokens,
        });
      }
    }

    // STEP 5: Simulate copy trading
    console.log('  Step 5: Running simulation...');

    let wins = 0;
    let losses = 0;
    let copyTotalBet = 0;
    let copyPnl = 0;
    let walletTotalBet = 0;
    let walletWinnings = 0;
    let positionsAnalyzed = 0;

    interface TradeResult {
      pnl: number;
      entry: number;
      market: string;
      won: boolean;
    }
    const tradeResults: TradeResult[] = [];

    for (const [key, pos] of positions) {
      if (positionsAnalyzed >= POSITIONS_LIMIT) break;

      const payoutsStr = resolutionMap.get(pos.condition_id.toLowerCase());
      if (!payoutsStr) continue; // Not resolved yet

      const payouts = JSON.parse(payoutsStr);
      const won = payouts[pos.outcome_index] === 1;

      const entryPrice = pos.total_buy_cost / pos.total_tokens;
      if (entryPrice <= 0 || entryPrice >= 1) continue;

      // Copy trading: $1 flat bet
      const bet = 1.00;
      const tokensAcquired = bet / entryPrice;
      const pnl = won ? tokensAcquired - bet : -bet;

      copyTotalBet += bet;
      copyPnl += pnl;

      // Wallet actual
      walletTotalBet += pos.total_buy_cost;
      if (won) {
        walletWinnings += pos.total_tokens;
        wins++;
      } else {
        losses++;
      }

      tradeResults.push({
        pnl,
        entry: entryPrice,
        market: pos.question.slice(0, 50),
        won,
      });

      positionsAnalyzed++;
    }

    await ch.close();

    if (positionsAnalyzed === 0) {
      return {
        wallet: walletAddr,
        status: 'no_data',
        error: 'No resolved positions',
        wins: 0, losses: 0, winRate: 0, positionsAnalyzed: 0,
        copyTotalBet: 0, copyPnl: 0, copyRoi: 0,
        walletTotalBet: 0, walletPnl: 0, walletRoi: 0, alpha: 0,
      };
    }

    const walletPnl = walletWinnings - walletTotalBet;
    const copyRoi = (copyPnl / copyTotalBet) * 100;
    const walletRoi = walletTotalBet > 0 ? (walletPnl / walletTotalBet) * 100 : 0;

    // Find best and worst trades
    tradeResults.sort((a, b) => b.pnl - a.pnl);
    const bestTrade = tradeResults[0];
    const worstTrade = tradeResults[tradeResults.length - 1];

    console.log(`  ✓ Complete: ${wins}W/${losses}L, Copy ROI: ${copyRoi >= 0 ? '+' : ''}${copyRoi.toFixed(1)}%, Wallet ROI: ${walletRoi >= 0 ? '+' : ''}${walletRoi.toFixed(1)}%`);

    return {
      wallet: walletAddr,
      status: 'success',
      wins,
      losses,
      winRate: wins / (wins + losses),
      positionsAnalyzed,
      copyTotalBet,
      copyPnl,
      copyRoi,
      walletTotalBet,
      walletPnl,
      walletRoi,
      alpha: copyRoi - walletRoi,
      bestTrade: bestTrade ? { pnl: bestTrade.pnl, entry: bestTrade.entry, market: bestTrade.market } : undefined,
      worstTrade: worstTrade ? { pnl: worstTrade.pnl, entry: worstTrade.entry, market: worstTrade.market } : undefined,
    };

  } catch (error: any) {
    await ch.close();

    if (error.message?.includes('Timeout') && attempt < MAX_RETRIES) {
      console.log(`  ⚠ Timeout - retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await sleep(RETRY_DELAY_MS);
      return simulateWallet(walletAddr, attempt + 1);
    }

    console.log(`  ✗ Error: ${error.message?.slice(0, 100)}`);
    return {
      wallet: walletAddr,
      status: 'error',
      error: error.message?.slice(0, 200),
      wins: 0, losses: 0, winRate: 0, positionsAnalyzed: 0,
      copyTotalBet: 0, copyPnl: 0, copyRoi: 0,
      walletTotalBet: 0, walletPnl: 0, walletRoi: 0, alpha: 0,
    };
  }
}

async function runBatch() {
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' COPY TRADING BATCH SIMULATION '.padStart(55).padEnd(78) + '║');
  console.log('║' + ` ${WALLETS.length} Wallets | ${POSITIONS_LIMIT} Positions Each | $1 Flat Bets `.padStart(55).padEnd(78) + '║');
  console.log('║' + ` Started: ${new Date().toISOString()} `.padStart(55).padEnd(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  const results: WalletResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < WALLETS.length; i++) {
    const wallet = WALLETS[i];
    console.log(`\n[${i + 1}/${WALLETS.length}] Processing...`);

    const result = await simulateWallet(wallet);
    results.push(result);

    // Save progress after each wallet
    const progressPath = '/tmp/copy-trade-batch-progress.json';
    fs.writeFileSync(progressPath, JSON.stringify({
      completed: i + 1,
      total: WALLETS.length,
      results
    }, null, 2));
  }

  const elapsed = (Date.now() - startTime) / 1000 / 60;

  // Generate final report
  console.log('\n\n');
  console.log('╔' + '═'.repeat(130) + '╗');
  console.log('║' + ' FINAL COPY TRADING COMPARISON REPORT '.padStart(84).padEnd(130) + '║');
  console.log('╚' + '═'.repeat(130) + '╝');
  console.log(`\nCompleted in ${elapsed.toFixed(1)} minutes\n`);

  // Filter successful results and sort by copy ROI
  const successfulResults = results.filter(r => r.status === 'success' && r.positionsAnalyzed > 0);
  successfulResults.sort((a, b) => b.copyRoi - a.copyRoi);

  // Print table header
  console.log('┌' + '─'.repeat(18) + '┬' + '─'.repeat(5) + '┬' + '─'.repeat(7) + '┬' + '─'.repeat(6) + '┬' + '─'.repeat(11) + '┬' + '─'.repeat(10) + '┬' + '─'.repeat(12) + '┬' + '─'.repeat(11) + '┬' + '─'.repeat(9) + '┐');
  console.log('│ Wallet           │ Pos │ W/L   │ Win% │ Copy PnL  │ Copy ROI │ Wallet PnL │ Wallet ROI│ Alpha   │');
  console.log('├' + '─'.repeat(18) + '┼' + '─'.repeat(5) + '┼' + '─'.repeat(7) + '┼' + '─'.repeat(6) + '┼' + '─'.repeat(11) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(12) + '┼' + '─'.repeat(11) + '┼' + '─'.repeat(9) + '┤');

  let totalCopyPnl = 0;
  let totalCopyBet = 0;
  let totalWalletPnl = 0;
  let totalWalletBet = 0;
  let totalWins = 0;
  let totalLosses = 0;

  for (const r of successfulResults) {
    const walletShort = r.wallet.slice(0, 6) + '...' + r.wallet.slice(-4);
    const wl = `${r.wins}/${r.losses}`;
    const winPct = `${(r.winRate * 100).toFixed(0)}%`;
    const copyPnlStr = `$${r.copyPnl >= 0 ? '+' : ''}${r.copyPnl.toFixed(2)}`;
    const copyRoiStr = `${r.copyRoi >= 0 ? '+' : ''}${r.copyRoi.toFixed(1)}%`;
    const walletPnlStr = `$${r.walletPnl >= 0 ? '+' : ''}${r.walletPnl.toFixed(0)}`;
    const walletRoiStr = `${r.walletRoi >= 0 ? '+' : ''}${r.walletRoi.toFixed(1)}%`;
    const alphaStr = `${r.alpha >= 0 ? '+' : ''}${r.alpha.toFixed(1)}%`;

    console.log(`│ ${walletShort.padEnd(16)} │ ${r.positionsAnalyzed.toString().padStart(3)} │ ${wl.padStart(5)} │ ${winPct.padStart(4)} │ ${copyPnlStr.padStart(9)} │ ${copyRoiStr.padStart(8)} │ ${walletPnlStr.padStart(10)} │ ${walletRoiStr.padStart(9)} │ ${alphaStr.padStart(7)} │`);

    totalCopyPnl += r.copyPnl;
    totalCopyBet += r.copyTotalBet;
    totalWalletPnl += r.walletPnl;
    totalWalletBet += r.walletTotalBet;
    totalWins += r.wins;
    totalLosses += r.losses;
  }

  console.log('└' + '─'.repeat(18) + '┴' + '─'.repeat(5) + '┴' + '─'.repeat(7) + '┴' + '─'.repeat(6) + '┴' + '─'.repeat(11) + '┴' + '─'.repeat(10) + '┴' + '─'.repeat(12) + '┴' + '─'.repeat(11) + '┴' + '─'.repeat(9) + '┘');

  // Errors and no-data
  const errors = results.filter(r => r.status === 'error');
  const noData = results.filter(r => r.status === 'no_data');

  if (errors.length > 0 || noData.length > 0) {
    console.log('\n⚠ Wallets with issues:');
    for (const r of [...errors, ...noData]) {
      console.log(`  ${r.wallet.slice(0, 10)}... - ${r.status}: ${r.error || 'No resolved positions'}`);
    }
  }

  // Aggregate stats
  console.log('\n' + '═'.repeat(80));
  console.log('AGGREGATE STATISTICS');
  console.log('═'.repeat(80));
  console.log(`Wallets Analyzed:     ${successfulResults.length}/${WALLETS.length}`);
  console.log(`Total Positions:      ${successfulResults.reduce((sum, r) => sum + r.positionsAnalyzed, 0)}`);
  console.log(`Total Wins/Losses:    ${totalWins}/${totalLosses} (${((totalWins / (totalWins + totalLosses)) * 100).toFixed(1)}% win rate)`);
  console.log('');
  console.log(`COPY TRADING (Equal $1 Bets):`);
  console.log(`  Total Bet:          $${totalCopyBet.toFixed(2)}`);
  console.log(`  Total PnL:          $${totalCopyPnl >= 0 ? '+' : ''}${totalCopyPnl.toFixed(2)}`);
  console.log(`  Average ROI:        ${totalCopyBet > 0 ? ((totalCopyPnl / totalCopyBet) * 100).toFixed(1) : 0}%`);
  console.log('');
  console.log(`WALLET ACTUAL (Variable Bets):`);
  console.log(`  Total Bet:          $${totalWalletBet.toFixed(2)}`);
  console.log(`  Total PnL:          $${totalWalletPnl >= 0 ? '+' : ''}${totalWalletPnl.toFixed(2)}`);
  console.log(`  Average ROI:        ${totalWalletBet > 0 ? ((totalWalletPnl / totalWalletBet) * 100).toFixed(1) : 0}%`);
  console.log('═'.repeat(80));

  // Top performers
  console.log('\n🏆 TOP 5 BY COPY TRADING ROI:');
  for (let i = 0; i < Math.min(5, successfulResults.length); i++) {
    const r = successfulResults[i];
    console.log(`  ${i + 1}. ${r.wallet.slice(0, 10)}... | Copy ROI: ${r.copyRoi >= 0 ? '+' : ''}${r.copyRoi.toFixed(1)}% | Alpha: ${r.alpha >= 0 ? '+' : ''}${r.alpha.toFixed(1)}%`);
    if (r.bestTrade) {
      console.log(`     Best: $${r.bestTrade.pnl >= 0 ? '+' : ''}${r.bestTrade.pnl.toFixed(2)} at ${(r.bestTrade.entry * 100).toFixed(0)}¢ - "${r.bestTrade.market}"`);
    }
  }

  // Wallets where copy trading beats actual
  const copyBeatsWallet = successfulResults.filter(r => r.alpha > 0);
  const walletBeatsCopy = successfulResults.filter(r => r.alpha < 0);

  console.log('\n📊 ALPHA ANALYSIS:');
  console.log(`  Copy Trading outperforms Wallet: ${copyBeatsWallet.length} wallets`);
  console.log(`  Wallet outperforms Copy Trading: ${walletBeatsCopy.length} wallets`);

  if (copyBeatsWallet.length > 0) {
    const avgAlphaPositive = copyBeatsWallet.reduce((sum, r) => sum + r.alpha, 0) / copyBeatsWallet.length;
    console.log(`  Avg Alpha when Copy wins: +${avgAlphaPositive.toFixed(1)}%`);
  }
  if (walletBeatsCopy.length > 0) {
    const avgAlphaNegative = walletBeatsCopy.reduce((sum, r) => sum + r.alpha, 0) / walletBeatsCopy.length;
    console.log(`  Avg Alpha when Wallet wins: ${avgAlphaNegative.toFixed(1)}%`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`Report generated: ${new Date().toISOString()}`);
  console.log('Results saved to: /tmp/copy-trade-batch-progress.json');
  console.log('═'.repeat(80));

  // Save final report
  const reportPath = '/tmp/copy-trade-final-report.json';
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    elapsedMinutes: elapsed,
    summary: {
      walletsAnalyzed: successfulResults.length,
      totalPositions: successfulResults.reduce((sum, r) => sum + r.positionsAnalyzed, 0),
      totalWins,
      totalLosses,
      winRate: totalWins / (totalWins + totalLosses),
      copyTotalBet: totalCopyBet,
      copyTotalPnl: totalCopyPnl,
      copyAvgRoi: totalCopyBet > 0 ? (totalCopyPnl / totalCopyBet) * 100 : 0,
      walletTotalBet: totalWalletBet,
      walletTotalPnl: totalWalletPnl,
      walletAvgRoi: totalWalletBet > 0 ? (totalWalletPnl / totalWalletBet) * 100 : 0,
    },
    results: successfulResults,
    errors,
    noData,
  }, null, 2));
}

runBatch().catch(console.error);
