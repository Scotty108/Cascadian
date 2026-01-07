/**
 * CCR-v1 Leaderboard: Final Candidate Pool
 *
 * Two-step approach to avoid memory issues:
 * 1. Get TRUE CLOB-only active wallet list
 * 2. Run stats query on those wallets only
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

async function getFinalCandidates() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: Final Candidate Pool');
  console.log('='.repeat(70));
  console.log('');
  console.log('Building TRUE CLOB-only, copy-trade viable wallet pool...\n');

  const startTime = Date.now();

  // Single optimized query that gets everything we need
  // Key: Join with a smaller intermediate set
  const query = `
    -- Get ERC1155 wallets to exclude (once)
    WITH erc1155_wallets AS (
      SELECT DISTINCT lower(from_address) as w FROM pm_erc1155_transfers
      UNION DISTINCT
      SELECT DISTINCT lower(to_address) as w FROM pm_erc1155_transfers
    ),
    -- Get TRUE CLOB-only wallets active in 30 days
    clob_only_active AS (
      SELECT lower(trader_wallet) as wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 30 DAY
        AND lower(trader_wallet) NOT IN (SELECT w FROM erc1155_wallets)
      GROUP BY lower(trader_wallet)
    ),
    -- Get wallet stats (only for CLOB-only active)
    wallet_stats AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(*) as trade_count,
        sum(usdc_amount) / 1e6 as total_volume,
        max(trade_time) as last_trade,
        min(trade_time) as first_trade,
        dateDiff('day', min(trade_time), max(trade_time)) + 1 as active_days
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND lower(trader_wallet) IN (SELECT wallet FROM clob_only_active)
      GROUP BY lower(trader_wallet)
      HAVING
        total_volume >= 500
        AND trade_count >= 30
        AND (trade_count / active_days) <= 100
        AND (total_volume / trade_count) >= 10
    ),
    -- Count distinct markets
    wallet_markets AS (
      SELECT
        lower(t.trader_wallet) as wallet,
        countDistinct(m.condition_id) as distinct_markets
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE t.is_deleted = 0
        AND lower(t.trader_wallet) IN (SELECT wallet FROM wallet_stats)
      GROUP BY lower(t.trader_wallet)
      HAVING distinct_markets >= 20
    )
    SELECT
      ws.wallet,
      ws.trade_count,
      wm.distinct_markets,
      ws.total_volume,
      ws.active_days,
      round(ws.trade_count / ws.active_days, 1) as trades_per_day,
      round(ws.total_volume / ws.trade_count, 2) as avg_trade_size,
      ws.first_trade,
      ws.last_trade
    FROM wallet_stats ws
    JOIN wallet_markets wm ON ws.wallet = wm.wallet
    ORDER BY ws.total_volume DESC
    LIMIT 50000
  `;

  console.log('Running optimized candidate query...');

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 600,
      max_memory_usage: 8000000000 // 8GB
    }
  });

  const candidates = (await result.json()) as any[];
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`Query completed in ${elapsed}s\n`);
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Total copy-trade viable candidates: ${candidates.length.toLocaleString()}`);
  console.log('');

  if (candidates.length > 0) {
    const totalVolume = candidates.reduce((s, c) => s + parseFloat(c.total_volume), 0);
    const avgMarkets = candidates.reduce((s, c) => s + c.distinct_markets, 0) / candidates.length;
    const avgTrades = candidates.reduce((s, c) => s + c.trade_count, 0) / candidates.length;
    const avgTPD = candidates.reduce((s, c) => s + parseFloat(c.trades_per_day), 0) / candidates.length;

    console.log('Pool Statistics:');
    console.log(`  Total volume: $${(totalVolume / 1e6).toFixed(2)}M`);
    console.log(`  Avg markets/wallet: ${avgMarkets.toFixed(1)}`);
    console.log(`  Avg trades/wallet: ${avgTrades.toFixed(0)}`);
    console.log(`  Avg trades/day: ${avgTPD.toFixed(1)}`);
    console.log('');

    console.log('Top 30 by Volume:');
    console.log('-'.repeat(95));
    console.log('Wallet                                      | Markets | Trades | T/Day | AvgSize | Volume');
    console.log('-'.repeat(95));

    for (const c of candidates.slice(0, 30)) {
      const wallet = c.wallet.slice(0, 10) + '...' + c.wallet.slice(-4);
      const markets = String(c.distinct_markets).padStart(7);
      const trades = String(c.trade_count).padStart(6);
      const tpd = parseFloat(c.trades_per_day).toFixed(1).padStart(5);
      const avg = ('$' + parseFloat(c.avg_trade_size).toFixed(0)).padStart(7);
      const vol = ('$' + (parseFloat(c.total_volume) / 1e6).toFixed(2) + 'M').padStart(10);
      console.log(`${wallet.padEnd(43)} | ${markets} | ${trades} | ${tpd} | ${avg} | ${vol}`);
    }

    // Save to file
    const outputPath = 'scripts/leaderboard/final-candidates.json';
    fs.writeFileSync(outputPath, JSON.stringify({
      generated: new Date().toISOString(),
      filters: {
        clob_only: true,
        active_30_days: true,
        min_volume: 500,
        min_trades: 30,
        min_markets: 20,
        max_trades_per_day: 100,
        min_avg_trade_size: 10
      },
      count: candidates.length,
      wallets: candidates
    }, null, 2));

    console.log(`\nSaved ${candidates.length} candidates to ${outputPath}`);
  }

  return candidates;
}

getFinalCandidates().catch(console.error);
