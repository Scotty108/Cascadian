/**
 * Batch P&L Calculator
 *
 * Uses validated Polymarket formula from their subgraph:
 * realizedPnL = Σ sellAmount × (sellPrice - avgBuyPrice)
 *
 * Calculates P&L for ALL wallets in cohort and outputs rankings.
 *
 * Usage: npx tsx scripts/copytrade/batch-pnl-calculator.ts [--limit N]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '1000');

interface Position {
  amount: number;
  avgPrice: number;
}

interface WalletPnL {
  wallet: string;
  gain: number;
  loss: number;
  netPnl: number;
  tradeCount: number;
  tokensTraded: number;
  unresolvedValue: number;
}

async function calculateWalletPnL(
  wallet: string,
  trades: any[],
  resolutionMap: Map<string, number | null>,
  livePriceMap: Map<string, number>
): Promise<WalletPnL> {
  const positions = new Map<string, Position>();
  let totalGain = 0;
  let totalLoss = 0;

  // Process trades chronologically
  for (const trade of trades) {
    const tokenId = trade.token_id;
    const side = trade.side;
    const tokenAmount = parseFloat(trade.token_amount);
    const usdcAmount = parseFloat(trade.usdc_amount);
    const price = tokenAmount > 0 ? usdcAmount / tokenAmount : 0;

    if (!positions.has(tokenId)) {
      positions.set(tokenId, { amount: 0, avgPrice: 0 });
    }

    const pos = positions.get(tokenId)!;

    if (side === 'buy') {
      if (pos.amount + tokenAmount > 0) {
        pos.avgPrice = (pos.avgPrice * pos.amount + price * tokenAmount) / (pos.amount + tokenAmount);
      }
      pos.amount += tokenAmount;
    } else if (side === 'sell') {
      const adjustedAmount = Math.min(tokenAmount, pos.amount);
      const pnl = adjustedAmount * (price - pos.avgPrice);
      if (pnl > 0) totalGain += pnl;
      else totalLoss += Math.abs(pnl);
      pos.amount = Math.max(0, pos.amount - tokenAmount);
    }
  }

  // Process resolutions and open positions
  let unresolvedValue = 0;

  for (const [tokenId, pos] of positions.entries()) {
    if (pos.amount > 0) {
      const resPrice = resolutionMap.get(tokenId);
      if (resPrice !== null && resPrice !== undefined) {
        // Resolved - count as sell at resolution price
        const pnl = pos.amount * (resPrice - pos.avgPrice);
        if (pnl > 0) totalGain += pnl;
        else totalLoss += Math.abs(pnl);
      } else {
        // Unresolved - use live price or estimate
        const livePrice = livePriceMap.get(tokenId) ?? 0.5;
        const value = pos.amount * livePrice;
        unresolvedValue += value;

        // Also count unrealized P&L
        const unrealizedPnl = pos.amount * (livePrice - pos.avgPrice);
        if (unrealizedPnl > 0) totalGain += unrealizedPnl;
        else totalLoss += Math.abs(unrealizedPnl);
      }
    }
  }

  const tokensTraded = new Set(trades.map(t => t.token_id)).size;

  return {
    wallet,
    gain: totalGain,
    loss: totalLoss,
    netPnl: totalGain - totalLoss,
    tradeCount: trades.length,
    tokensTraded,
    unresolvedValue
  };
}

async function main() {
  console.log('=== BATCH P&L CALCULATOR ===\n');
  console.log(`Processing up to ${LIMIT} wallets\n`);

  // Step 1: Get wallets from 60-day cohort
  console.log('Step 1: Getting wallets from 60-day cohort...');
  const walletsQ = `
    SELECT trader_wallet, count() as trade_count
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND trade_time >= now() - INTERVAL 60 DAY
    GROUP BY trader_wallet
    ORDER BY trade_count DESC
    LIMIT ${LIMIT}
  `;
  const walletsR = await clickhouse.query({ query: walletsQ, format: 'JSONEachRow' });
  const wallets = await walletsR.json() as any[];
  console.log(`  Found ${wallets.length} wallets\n`);

  // Step 2: Load resolution prices
  console.log('Step 2: Loading resolution prices...');
  const resQ = `
    SELECT
      m.token_id_dec as token_id,
      r.resolved_price
    FROM pm_token_to_condition_map_v5 m
    JOIN vw_pm_resolution_prices r
      ON m.condition_id = r.condition_id
      AND m.outcome_index = r.outcome_index
    WHERE r.resolved_price IS NOT NULL
    UNION ALL
    SELECT
      p.token_id_dec as token_id,
      r.resolved_price
    FROM pm_token_to_condition_patch p
    JOIN vw_pm_resolution_prices r
      ON p.condition_id = r.condition_id
      AND p.outcome_index = r.outcome_index
    WHERE r.resolved_price IS NOT NULL
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await resR.json() as any[];
  const resolutionMap = new Map<string, number>(
    resolutions.map(r => [r.token_id, parseFloat(r.resolved_price)])
  );
  console.log(`  Loaded ${resolutions.length} resolution prices\n`);

  // Step 3: Load live prices for unresolved tokens
  console.log('Step 3: Loading live prices for open positions...');
  const livePriceQ = `
    SELECT
      token_id,
      argMax(usdc_amount / token_amount, trade_time) as live_price
    FROM pm_trader_events_v2
    WHERE trade_time > now() - INTERVAL 1 HOUR
      AND is_deleted = 0
      AND token_amount > 0
    GROUP BY token_id
  `;
  const livePriceR = await clickhouse.query({ query: livePriceQ, format: 'JSONEachRow' });
  const livePrices = await livePriceR.json() as any[];
  const livePriceMap = new Map<string, number>(
    livePrices.map(p => [p.token_id, parseFloat(p.live_price)])
  );
  console.log(`  Loaded ${livePrices.length} live prices\n`);

  // Step 4: Process each wallet ONE AT A TIME (avoid timeout)
  console.log('Step 4: Calculating P&L for each wallet...');

  const results: WalletPnL[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i].trader_wallet;

    // Get trades for this wallet
    const tradesQ = `
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1e6 as token_amount,
        any(usdc_amount) / 1e6 as usdc_amount,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
      GROUP BY event_id
      ORDER BY trade_time ASC
    `;
    const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
    const trades = await tradesR.json() as any[];

    // Calculate P&L
    const pnl = await calculateWalletPnL(wallet, trades, resolutionMap, livePriceMap);
    results.push(pnl);

    if ((i + 1) % 10 === 0 || i + 1 === wallets.length) {
      console.log(`  Processed ${i + 1}/${wallets.length} wallets...`);
    }
  }

  // Step 5: Sort by net P&L and output rankings
  console.log('\nStep 5: Generating rankings...');
  results.sort((a, b) => b.netPnl - a.netPnl);

  // Top 20 winners
  console.log('\n=== TOP 20 WINNERS ===');
  console.log('| Rank | Wallet | Net P&L | Gain | Loss | Trades | Tokens |');
  console.log('|------|--------|---------|------|------|--------|--------|');
  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i];
    console.log(
      `| ${i + 1} | ${r.wallet.slice(0, 10)}... | $${r.netPnl.toFixed(2)} | $${r.gain.toFixed(2)} | -$${r.loss.toFixed(2)} | ${r.tradeCount} | ${r.tokensTraded} |`
    );
  }

  // Bottom 20 losers
  console.log('\n=== TOP 20 LOSERS ===');
  console.log('| Rank | Wallet | Net P&L | Gain | Loss | Trades | Tokens |');
  console.log('|------|--------|---------|------|------|--------|--------|');
  for (let i = results.length - 1; i >= Math.max(0, results.length - 20); i--) {
    const r = results[i];
    console.log(
      `| ${results.length - i} | ${r.wallet.slice(0, 10)}... | $${r.netPnl.toFixed(2)} | $${r.gain.toFixed(2)} | -$${r.loss.toFixed(2)} | ${r.tradeCount} | ${r.tokensTraded} |`
    );
  }

  // Export to CSV
  console.log('\nExporting results...');
  if (!fs.existsSync('exports')) fs.mkdirSync('exports');

  let csv = 'rank,wallet,net_pnl,gain,loss,trade_count,tokens_traded,unresolved_value\n';
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    csv += `${i + 1},${r.wallet},${r.netPnl.toFixed(2)},${r.gain.toFixed(2)},${r.loss.toFixed(2)},${r.tradeCount},${r.tokensTraded},${r.unresolvedValue.toFixed(2)}\n`;
  }
  fs.writeFileSync('exports/wallet_pnl_rankings.csv', csv);
  console.log(`  Exported to exports/wallet_pnl_rankings.csv`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total wallets processed: ${results.length}`);
  console.log(`Winners (P&L > 0): ${results.filter(r => r.netPnl > 0).length}`);
  console.log(`Losers (P&L < 0): ${results.filter(r => r.netPnl < 0).length}`);
  console.log(`Break-even: ${results.filter(r => r.netPnl === 0).length}`);

  const totalPnl = results.reduce((sum, r) => sum + r.netPnl, 0);
  console.log(`Total P&L across all wallets: $${totalPnl.toFixed(2)}`);
}

main().catch(console.error);
