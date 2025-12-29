/**
 * Test Copy-Trading Confidence Gate
 *
 * Validates the confidence scoring module against benchmark wallets.
 *
 * Run with: npx tsx scripts/pnl/test-confidence-gate.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  scoreWallet,
  passesFilter,
  formatScore,
  DEFAULT_FILTER,
  CopyTradingFilter,
} from '../../lib/pnl/copyTradingConfidence';

async function main() {
  const client = getClickHouseClient();

  console.log('=== CONFIDENCE GATE TEST ===\n');

  // Load benchmark wallets with their PnL
  console.log('Loading benchmark wallets...');
  const benchmarkResult = await client.query({
    query: `
      WITH latest AS (
        SELECT wallet, max(captured_at) as latest_capture
        FROM pm_ui_pnl_benchmarks_v1
        GROUP BY wallet
      )
      SELECT b.wallet, b.pnl_value as ui_pnl
      FROM pm_ui_pnl_benchmarks_v1 b
      INNER JOIN latest l ON b.wallet = l.wallet AND b.captured_at = l.latest_capture
    `,
    format: 'JSONEachRow',
  });
  const benchmarks = (await benchmarkResult.json()) as any[];
  console.log(`Loaded ${benchmarks.length} benchmark wallets\n`);

  // Get trade stats for each wallet
  console.log('Loading trade stats...');
  const walletList = benchmarks.map((b) => `'${b.wallet.toLowerCase()}'`).join(',');

  const tradeStats = await client.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        count() as trade_count,
        countIf(trade_time >= now() - INTERVAL 30 DAY) as trades_30d,
        sumIf(usdc_amount, side = 'buy') / 1000000.0 as buy_usdc,
        sumIf(usdc_amount, side = 'sell') / 1000000.0 as sell_usdc,
        countIf(side = 'buy') as buy_count,
        countIf(side = 'sell') as sell_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND role = 'maker'
        AND lower(trader_wallet) IN (${walletList})
      GROUP BY wallet
    `,
    format: 'JSONEachRow',
  });
  const tradeStatsMap = new Map<string, any>();
  for (const row of (await tradeStats.json()) as any[]) {
    tradeStatsMap.set(row.wallet.toLowerCase(), row);
  }

  // Get redemption stats
  console.log('Loading redemption stats...');
  const redemptionStats = await client.query({
    query: `
      SELECT
        lower(user_address) as wallet,
        count() as redemption_count,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemption_usdc
      FROM pm_ctf_events
      WHERE event_type = 'PayoutRedemption'
        AND is_deleted = 0
        AND lower(user_address) IN (${walletList})
      GROUP BY wallet
    `,
    format: 'JSONEachRow',
  });
  const redemptionMap = new Map<string, { count: number; usdc: number }>();
  for (const row of (await redemptionStats.json()) as any[]) {
    redemptionMap.set(row.wallet.toLowerCase(), {
      count: Number(row.redemption_count),
      usdc: Number(row.redemption_usdc),
    });
  }

  console.log('Scoring wallets...\n');

  // Score all benchmark wallets
  const scores = [];
  for (const b of benchmarks) {
    const wallet = b.wallet.toLowerCase();
    const trades = tradeStatsMap.get(wallet);
    const redemption = redemptionMap.get(wallet) || { count: 0, usdc: 0 };

    if (!trades) continue;

    const score = scoreWallet({
      wallet,
      tradeCount: Number(trades.trade_count),
      trades30d: Number(trades.trades_30d),
      buyUsdc: Number(trades.buy_usdc),
      sellUsdc: Number(trades.sell_usdc),
      buyCount: Number(trades.buy_count),
      sellCount: Number(trades.sell_count),
      redemptionCount: redemption.count,
      redemptionUsdc: redemption.usdc,
    });

    scores.push({
      ...score,
      uiPnl: Number(b.ui_pnl),
    });
  }

  // Summary by tier
  console.log('=== TIER DISTRIBUTION ===\n');
  const byTier = {
    high: scores.filter((s) => s.tier === 'high'),
    medium: scores.filter((s) => s.tier === 'medium'),
    low: scores.filter((s) => s.tier === 'low'),
  };

  console.log(`HIGH confidence: ${byTier.high.length} wallets`);
  console.log(`MEDIUM confidence: ${byTier.medium.length} wallets`);
  console.log(`LOW confidence: ${byTier.low.length} wallets`);

  // Show top wallets by score
  console.log('\n\n=== TOP 15 BY SCORE ===\n');
  const sorted = scores.sort((a, b) => b.score - a.score);
  for (const s of sorted.slice(0, 15)) {
    const uiPnl = s.uiPnl >= 0 ? `$${(s.uiPnl / 1000).toFixed(0)}k` : `-$${(Math.abs(s.uiPnl) / 1000).toFixed(0)}k`;
    console.log(`${s.wallet.slice(0, 12)}.. | ${formatScore(s)} | UI: ${uiPnl}`);
  }

  // Test filter combinations
  console.log('\n\n=== FILTER COMBINATIONS ===\n');

  const filters: { name: string; filter: CopyTradingFilter }[] = [
    { name: 'Default', filter: DEFAULT_FILTER },
    { name: 'High only', filter: { ...DEFAULT_FILTER, minTier: 'high' } },
    { name: 'Min $5k PnL', filter: { ...DEFAULT_FILTER, minPnl: 5000 } },
    { name: 'Min 100 trades', filter: { ...DEFAULT_FILTER, minTrades: 100 } },
    { name: 'Strict', filter: { minTrades: 100, minTrades30d: 10, minPnl: 5000, minTier: 'high' } },
  ];

  for (const { name, filter } of filters) {
    const passing = scores.filter((s) => passesFilter(s, filter));
    console.log(`${name}: ${passing.length} wallets pass`);
  }

  // Show wallets that pass strict filter
  console.log('\n\n=== WALLETS PASSING STRICT FILTER ===\n');
  const strictFilter: CopyTradingFilter = { minTrades: 100, minTrades30d: 10, minPnl: 5000, minTier: 'high' };
  const strictPassing = scores.filter((s) => passesFilter(s, strictFilter));

  console.log(`Found ${strictPassing.length} wallets:\n`);
  for (const s of strictPassing.slice(0, 10)) {
    const uiPnl = s.uiPnl >= 0 ? `$${(s.uiPnl / 1000).toFixed(0)}k` : `-$${(Math.abs(s.uiPnl) / 1000).toFixed(0)}k`;
    console.log(`${s.wallet.slice(0, 12)}.. | ${formatScore(s)}`);
    console.log(`  UI PnL: ${uiPnl} | Reasons: ${s.reasons.join(', ')}`);
  }
}

main().catch(console.error);
