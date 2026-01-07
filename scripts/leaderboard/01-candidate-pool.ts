/**
 * CCR-v1 Leaderboard Step 1: Candidate Pool
 *
 * Cheap filters first:
 * - CLOB only (pm_trader_events_v2)
 * - Active in last 30 days
 * - ≥20 distinct markets traded
 * - Has meaningful activity (≥$200 volume to avoid dust)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

async function getCandidatePool() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: Step 1 - Candidate Pool');
  console.log('='.repeat(70));
  console.log('');
  console.log('Filters:');
  console.log('  - CLOB only (pm_trader_events_v2)');
  console.log('  - Active in last 30 days');
  console.log('  - ≥20 distinct markets traded');
  console.log('  - ≥$200 total volume (avoid dust)');
  console.log('');

  const startTime = Date.now();

  // Optimized: Filter by 30-day activity FIRST to reduce dataset
  // Then count markets and volume for those wallets only
  const candidateQuery = `
    -- Step 1: Get wallets active in last 30 days (fast filter)
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
        min(trade_time) as first_trade_time
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
      dateDiff('day', ws.first_trade_time, ws.last_trade_time) as active_days
    FROM wallet_stats ws
    JOIN wallet_markets wm ON ws.wallet = wm.wallet
    WHERE
      -- At least 20 distinct markets
      wm.distinct_markets >= 20
      -- At least $200 volume (avoid dust)
      AND ws.total_volume >= 200
    ORDER BY ws.total_volume DESC
  `;

  console.log('Running candidate pool query...');

  const result = await clickhouse.query({
    query: candidateQuery,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 300  // 5 minutes
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

  // Summary stats
  if (candidates.length > 0) {
    const totalVolume = candidates.reduce((s, c) => s + parseFloat(c.total_volume), 0);
    const avgMarkets = candidates.reduce((s, c) => s + c.distinct_markets, 0) / candidates.length;
    const avgTrades = candidates.reduce((s, c) => s + c.trade_count, 0) / candidates.length;

    console.log('Pool Statistics:');
    console.log(`  Total volume: $${(totalVolume / 1e6).toFixed(2)}M`);
    console.log(`  Avg markets per wallet: ${avgMarkets.toFixed(1)}`);
    console.log(`  Avg trades per wallet: ${avgTrades.toFixed(1)}`);
    console.log('');

    // Top 20 by volume
    console.log('Top 20 candidates by volume:');
    console.log('-'.repeat(70));
    console.log('Wallet                                      | Markets | Trades | Volume');
    console.log('-'.repeat(70));

    for (const c of candidates.slice(0, 20)) {
      const wallet = c.wallet.slice(0, 10) + '...' + c.wallet.slice(-4);
      const markets = String(c.distinct_markets).padStart(7);
      const trades = String(c.trade_count).padStart(6);
      const volume = '$' + parseFloat(c.total_volume).toLocaleString('en-US', { maximumFractionDigits: 0 });
      console.log(`${wallet.padEnd(43)} | ${markets} | ${trades} | ${volume}`);
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log(`Pool size for PnL calculation: ${candidates.length} wallets`);
  console.log('='.repeat(70));

  return candidates;
}

getCandidatePool().catch(console.error);
