/**
 * CCR-v1 Leaderboard Step 1c: Copy-Trade Viable Candidates
 *
 * Ultra-strict filters for 12-16s copy-trade delay:
 * - ≤50 trades/day (human-speed trading)
 * - ≥$50 avg trade size (meaningful positions)
 * - ≥50 distinct markets (experienced trader)
 * - ≥$1000 total volume
 * - ≥100 total trades
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function getCopyTradeViable() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: Copy-Trade Viable Candidates');
  console.log('='.repeat(70));
  console.log('');
  console.log('Filters (optimized for 12-16s copy delay):');
  console.log('  - CLOB only');
  console.log('  - Active in last 30 days');
  console.log('  - ≥50 distinct markets (experienced)');
  console.log('  - ≥$1,000 total volume');
  console.log('  - ≥100 total trades');
  console.log('  - ≤50 trades/day avg (human-speed, not HFT)');
  console.log('  - ≥$50 avg trade size (meaningful positions)');
  console.log('');

  const startTime = Date.now();

  const candidateQuery = `
    WITH active_wallets AS (
      SELECT DISTINCT lower(trader_wallet) as wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 30 DAY
    ),
    wallet_stats AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(*) as trade_count,
        countDistinct(token_id) as distinct_tokens,
        sum(usdc_amount) / 1e6 as total_volume,
        max(trade_time) as last_trade_time,
        min(trade_time) as first_trade_time,
        dateDiff('day', min(trade_time), max(trade_time)) + 1 as active_days
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND lower(trader_wallet) IN (SELECT wallet FROM active_wallets)
      GROUP BY lower(trader_wallet)
    ),
    wallet_markets AS (
      SELECT
        lower(t.trader_wallet) as wallet,
        countDistinct(m.condition_id) as distinct_markets
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE t.is_deleted = 0
        AND lower(t.trader_wallet) IN (SELECT wallet FROM active_wallets)
      GROUP BY lower(t.trader_wallet)
    )
    SELECT
      ws.wallet,
      ws.trade_count,
      wm.distinct_markets,
      ws.total_volume,
      ws.active_days,
      ws.trade_count / ws.active_days as trades_per_day,
      ws.total_volume / ws.trade_count as avg_trade_size,
      ws.first_trade_time,
      ws.last_trade_time
    FROM wallet_stats ws
    JOIN wallet_markets wm ON ws.wallet = wm.wallet
    WHERE
      -- At least 50 distinct markets (experienced trader)
      wm.distinct_markets >= 50
      -- At least $1000 volume
      AND ws.total_volume >= 1000
      -- At least 100 trades
      AND ws.trade_count >= 100
      -- Max 50 trades per day (human-speed, not bots)
      AND (ws.trade_count / ws.active_days) <= 50
      -- Min $50 avg trade size
      AND (ws.total_volume / ws.trade_count) >= 50
    ORDER BY ws.total_volume DESC
  `;

  console.log('Running copy-trade viable query...');

  const result = await clickhouse.query({
    query: candidateQuery,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 300
    }
  });
  const candidates = (await result.json()) as any[];

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('');
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Query time: ${elapsed}s`);
  console.log(`Copy-trade viable wallets: ${candidates.length}`);
  console.log('');

  if (candidates.length > 0) {
    const totalVolume = candidates.reduce((s, c) => s + parseFloat(c.total_volume), 0);
    const avgMarkets = candidates.reduce((s, c) => s + c.distinct_markets, 0) / candidates.length;
    const avgTrades = candidates.reduce((s, c) => s + c.trade_count, 0) / candidates.length;
    const avgTradesPerDay = candidates.reduce((s, c) => s + parseFloat(c.trades_per_day), 0) / candidates.length;
    const avgTradeSize = candidates.reduce((s, c) => s + parseFloat(c.avg_trade_size), 0) / candidates.length;

    console.log('Pool Statistics:');
    console.log(`  Total volume: $${(totalVolume / 1e6).toFixed(2)}M`);
    console.log(`  Avg markets per wallet: ${avgMarkets.toFixed(1)}`);
    console.log(`  Avg trades per wallet: ${avgTrades.toFixed(1)}`);
    console.log(`  Avg trades/day: ${avgTradesPerDay.toFixed(1)}`);
    console.log(`  Avg trade size: $${avgTradeSize.toFixed(2)}`);
    console.log('');

    console.log('Top 50 Copy-Trade Viable by Volume:');
    console.log('-'.repeat(100));
    console.log('Wallet                                      | Markets | Trades | Days | T/Day | AvgSize | Volume');
    console.log('-'.repeat(100));

    for (const c of candidates.slice(0, 50)) {
      const wallet = c.wallet.slice(0, 10) + '...' + c.wallet.slice(-4);
      const markets = String(c.distinct_markets).padStart(7);
      const trades = String(c.trade_count).padStart(6);
      const days = String(c.active_days).padStart(4);
      const tpd = parseFloat(c.trades_per_day).toFixed(1).padStart(5);
      const avgSize = ('$' + parseFloat(c.avg_trade_size).toFixed(0)).padStart(7);
      const volume = '$' + (parseFloat(c.total_volume) / 1e6).toFixed(2) + 'M';
      console.log(`${wallet.padEnd(43)} | ${markets} | ${trades} | ${days} | ${tpd} | ${avgSize} | ${volume}`);
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log(`Copy-trade viable pool: ${candidates.length} wallets`);
  console.log('='.repeat(70));

  // Save for next step
  if (candidates.length > 0) {
    const fs = await import('fs');
    fs.writeFileSync(
      'scripts/leaderboard/copytrade-candidates.json',
      JSON.stringify({
        generated: new Date().toISOString(),
        filters: {
          min_markets: 50,
          min_volume: 1000,
          min_trades: 100,
          max_trades_per_day: 50,
          min_avg_trade_size: 50
        },
        count: candidates.length,
        wallets: candidates.map(c => ({
          wallet: c.wallet,
          markets: c.distinct_markets,
          trades: c.trade_count,
          volume: parseFloat(c.total_volume),
          trades_per_day: parseFloat(c.trades_per_day),
          avg_trade_size: parseFloat(c.avg_trade_size)
        }))
      }, null, 2)
    );
    console.log('');
    console.log(`Saved ${candidates.length} candidates to scripts/leaderboard/copytrade-candidates.json`);
  }

  return candidates;
}

getCopyTradeViable().catch(console.error);
