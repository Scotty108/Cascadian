/**
 * CCR-v1 Leaderboard Step 1b: Strict Candidate Pool
 *
 * Tighter filters to exclude HFT/bots:
 * - CLOB only
 * - Active in last 30 days
 * - ≥20 distinct markets
 * - ≥$500 total volume
 * - ≤1000 trades per day avg (exclude HFT)
 * - ≥$5 avg trade size (exclude dust sniping)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function getCandidatePoolStrict() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: Step 1b - Strict Candidate Pool');
  console.log('='.repeat(70));
  console.log('');
  console.log('Filters:');
  console.log('  - CLOB only (pm_trader_events_v2)');
  console.log('  - Active in last 30 days');
  console.log('  - ≥20 distinct markets traded');
  console.log('  - ≥$500 total volume');
  console.log('  - ≤1000 trades/day average (exclude HFT)');
  console.log('  - ≥$5 average trade size (exclude dust)');
  console.log('  - ≥30 total trades (statistical significance)');
  console.log('');

  const startTime = Date.now();

  const candidateQuery = `
    -- Step 1: Get wallets active in last 30 days
    WITH active_wallets AS (
      SELECT DISTINCT lower(trader_wallet) as wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 30 DAY
    ),
    -- Step 2: Get stats only for active wallets
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
    -- Step 3: Count distinct markets per wallet
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
      ws.distinct_tokens,
      wm.distinct_markets,
      ws.total_volume,
      ws.last_trade_time,
      ws.first_trade_time,
      ws.active_days,
      ws.trade_count / ws.active_days as trades_per_day,
      ws.total_volume / ws.trade_count as avg_trade_size
    FROM wallet_stats ws
    JOIN wallet_markets wm ON ws.wallet = wm.wallet
    WHERE
      -- At least 20 distinct markets
      wm.distinct_markets >= 20
      -- At least $500 volume
      AND ws.total_volume >= 500
      -- At least 30 trades (statistical significance)
      AND ws.trade_count >= 30
      -- Max 1000 trades per day (exclude HFT/bots)
      AND (ws.trade_count / ws.active_days) <= 1000
      -- Min $5 avg trade size (exclude dust)
      AND (ws.total_volume / ws.trade_count) >= 5
    ORDER BY ws.total_volume DESC
  `;

  console.log('Running strict candidate pool query...');

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
  console.log(`Candidate wallets: ${candidates.length}`);
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

    console.log('Top 30 candidates by volume:');
    console.log('-'.repeat(90));
    console.log('Wallet                                      | Markets | Trades | Trades/Day | Avg Size | Volume');
    console.log('-'.repeat(90));

    for (const c of candidates.slice(0, 30)) {
      const wallet = c.wallet.slice(0, 10) + '...' + c.wallet.slice(-4);
      const markets = String(c.distinct_markets).padStart(7);
      const trades = String(c.trade_count).padStart(6);
      const tpd = parseFloat(c.trades_per_day).toFixed(1).padStart(10);
      const avgSize = ('$' + parseFloat(c.avg_trade_size).toFixed(0)).padStart(8);
      const volume = '$' + parseFloat(c.total_volume).toLocaleString('en-US', { maximumFractionDigits: 0 });
      console.log(`${wallet.padEnd(43)} | ${markets} | ${trades} | ${tpd} | ${avgSize} | ${volume}`);
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log(`Pool size for PnL calculation: ${candidates.length} wallets`);
  console.log('='.repeat(70));

  // Save wallet list for next step
  if (candidates.length > 0 && candidates.length < 50000) {
    const walletList = candidates.map(c => c.wallet);
    console.log('');
    console.log(`Saving ${walletList.length} wallets for PnL calculation...`);

    // Write to file for next step
    const fs = await import('fs');
    fs.writeFileSync(
      'scripts/leaderboard/candidate-wallets.json',
      JSON.stringify({
        generated: new Date().toISOString(),
        count: walletList.length,
        wallets: walletList.slice(0, 10000) // Cap at 10k for now
      }, null, 2)
    );
    console.log('Saved to scripts/leaderboard/candidate-wallets.json');
  }

  return candidates;
}

getCandidatePoolStrict().catch(console.error);
