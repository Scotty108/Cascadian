/**
 * Copy Trading Batch Simulator
 * Simulates $1 flat bets on resolved positions for ALL golden wallets in ONE query
 *
 * Much more efficient than per-wallet queries since it's a single table scan
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 600000, // 10 min for batch
});

// Load golden wallets from CSV
const csvPath = path.join(__dirname, 'leaderboard/golden-superforecasters.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');
const lines = csvContent.trim().split('\n').slice(1); // Skip header
const goldenWallets = lines.map(line => line.split(',')[0].toLowerCase());

const POSITIONS_PER_WALLET = 50;

async function batchSimulate() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`BATCH COPY TRADING SIMULATION`);
  console.log(`Wallets: ${goldenWallets.length} | Positions per wallet: ${POSITIONS_PER_WALLET}`);
  console.log(`${'='.repeat(80)}\n`);

  const walletList = goldenWallets.map(w => `'${w}'`).join(',');

  // STEP 1: Get recent BUY trades for all golden wallets
  console.log('Step 1: Fetching buy trades for all wallets...');
  const tradesQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      event_id,
      token_id,
      usdc_amount / 1000000.0 as usdc,
      token_amount / 1000000.0 as tokens,
      trade_time
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) IN (${walletList})
      AND is_deleted = 0
      AND lower(side) = 'buy'
    ORDER BY trade_time DESC
    LIMIT 10000
  `;

  const tradesResult = await ch.query({ query: tradesQuery, format: 'JSONEachRow' });
  const allTrades: any[] = await tradesResult.json();
  console.log(`  Found ${allTrades.length} buy trades across all wallets`);

  // Group trades by wallet
  const tradesByWallet = new Map<string, any[]>();
  for (const trade of allTrades) {
    const w = trade.wallet;
    if (!tradesByWallet.has(w)) tradesByWallet.set(w, []);
    tradesByWallet.get(w)!.push(trade);
  }

  // Collect unique token IDs
  const tokenIds = [...new Set(allTrades.map(t => t.token_id.toString()))];
  console.log(`  Unique tokens: ${tokenIds.length}`);

  // STEP 2: Get token mappings
  console.log('Step 2: Fetching token mappings...');
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
  console.log(`  Resolved: ${resolutions.length} conditions\n`);

  // STEP 4: Simulate per wallet
  console.log('Step 4: Running simulations...\n');

  interface WalletResult {
    wallet: string;
    wins: number;
    losses: number;
    winRate: number;
    copyPnl: number;
    copyRoi: number;
    walletPnl: number;
    walletRoi: number;
    positionsAnalyzed: number;
  }

  const results: WalletResult[] = [];

  for (const walletAddr of goldenWallets) {
    const walletTrades = tradesByWallet.get(walletAddr) || [];
    if (walletTrades.length === 0) {
      console.log(`  ${walletAddr.slice(0, 10)}... - No trades found`);
      continue;
    }

    // Build positions
    interface PositionData {
      condition_id: string;
      outcome_index: number;
      total_buy_cost: number;
      total_tokens: number;
    }

    const positions = new Map<string, PositionData>();

    for (const trade of walletTrades) {
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
          total_buy_cost: trade.usdc,
          total_tokens: trade.tokens,
        });
      }
    }

    // Simulate
    let copyBet = 0;
    let copyPnl = 0;
    let walletBet = 0;
    let walletWinnings = 0;
    let wins = 0;
    let losses = 0;
    let posCount = 0;

    for (const [key, pos] of positions) {
      if (posCount >= POSITIONS_PER_WALLET) break;

      const payoutsStr = resolutionMap.get(pos.condition_id.toLowerCase());
      if (!payoutsStr) continue; // Not resolved

      const payouts = JSON.parse(payoutsStr);
      const won = payouts[pos.outcome_index] === 1;

      const entryPrice = pos.total_buy_cost / pos.total_tokens;
      if (entryPrice <= 0 || entryPrice >= 1) continue;

      // Copy trading: $1 flat bet
      const bet = 1.00;
      const tokensAcquired = bet / entryPrice;
      const pnl = won ? tokensAcquired - bet : -bet;

      copyBet += bet;
      copyPnl += pnl;

      // Wallet actual
      walletBet += pos.total_buy_cost;
      if (won) walletWinnings += pos.total_tokens;

      if (won) wins++;
      else losses++;
      posCount++;
    }

    if (posCount === 0) {
      console.log(`  ${walletAddr.slice(0, 10)}... - No resolved positions`);
      continue;
    }

    const walletPnl = walletWinnings - walletBet;

    results.push({
      wallet: walletAddr,
      wins,
      losses,
      winRate: wins / (wins + losses),
      copyPnl,
      copyRoi: (copyPnl / copyBet) * 100,
      walletPnl,
      walletRoi: walletBet > 0 ? (walletPnl / walletBet) * 100 : 0,
      positionsAnalyzed: posCount,
    });
  }

  // Sort by copy ROI
  results.sort((a, b) => b.copyRoi - a.copyRoi);

  // Display results
  console.log('='.repeat(120));
  console.log('BATCH SIMULATION RESULTS (sorted by Copy ROI)');
  console.log('='.repeat(120));
  console.log('| Wallet         | Pos | Wins | Win% | Copy PnL | Copy ROI | Wallet PnL | Wallet ROI | Alpha |');
  console.log('-'.repeat(120));

  let totalCopyPnl = 0;
  let totalCopyBet = 0;
  let totalWalletPnl = 0;
  let totalWalletBet = 0;

  for (const r of results) {
    const walletShort = r.wallet.slice(0, 14) + '...';
    const copyPnlStr = `$${r.copyPnl >= 0 ? '+' : ''}${r.copyPnl.toFixed(2)}`.padStart(9);
    const copyRoiStr = `${r.copyRoi >= 0 ? '+' : ''}${r.copyRoi.toFixed(1)}%`.padStart(9);
    const walletPnlStr = `$${r.walletPnl >= 0 ? '+' : ''}${r.walletPnl.toFixed(0)}`.padStart(10);
    const walletRoiStr = `${r.walletRoi >= 0 ? '+' : ''}${r.walletRoi.toFixed(1)}%`.padStart(10);
    const alpha = r.copyRoi - r.walletRoi;
    const alphaStr = `${alpha >= 0 ? '+' : ''}${alpha.toFixed(1)}%`.padStart(7);
    const winRateStr = `${(r.winRate * 100).toFixed(0)}%`.padStart(4);

    console.log(`| ${walletShort} | ${r.positionsAnalyzed.toString().padStart(3)} | ${r.wins.toString().padStart(4)} | ${winRateStr} | ${copyPnlStr} | ${copyRoiStr} | ${walletPnlStr} | ${walletRoiStr} | ${alphaStr} |`);

    totalCopyPnl += r.copyPnl;
    totalCopyBet += r.positionsAnalyzed;
    totalWalletPnl += r.walletPnl;
    totalWalletBet += r.positionsAnalyzed * 100; // rough estimate
  }

  console.log('-'.repeat(120));
  console.log(`\nAGGREGATE ACROSS ALL WALLETS:`);
  console.log(`  Total Copy Trading PnL: $${totalCopyPnl >= 0 ? '+' : ''}${totalCopyPnl.toFixed(2)} on $${totalCopyBet.toFixed(0)} bet`);
  console.log(`  Average Copy ROI: ${(totalCopyPnl / totalCopyBet * 100).toFixed(1)}%`);
  console.log(`  Wallets Simulated: ${results.length}`);
  console.log('='.repeat(120));

  await ch.close();
}

batchSimulate().catch(console.error);
