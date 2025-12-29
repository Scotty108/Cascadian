/**
 * Verify Egg Market Traders - Filter out system wallets
 *
 * Checks:
 * 1. Maker/taker ratio (system wallets often 100% maker)
 * 2. Buy/sell balance (real traders have directional bias)
 * 3. Actual realized PnL from resolutions
 * 4. Compare to @xcnstrategy pattern
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const XCNSTRATEGY = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Top egg traders from previous query
const EGG_TRADERS = [
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xaee8e802e29a2dd32d6234a3d28e3bd7e2ca6eeb',
  '0xe278e3c172e37d91190476012625829008f0b608',
  '0x1f6535f7592cc8f3af8f20dcd92c0ca1a4151592',
  '0xd218e474776403a330142299f7796e8ba32eb5c9',
  '0x9c09fd8faed8b42564969d7b657261a5565a1ba5',
  XCNSTRATEGY, // Include original for comparison
];

async function analyzeWalletPattern(wallet: string) {
  // Get trading pattern analysis
  const query = `
    WITH
    all_trades AS (
      SELECT
        event_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      count() as total_trades,
      countIf(role = 'taker') as taker_trades,
      countIf(role = 'maker') as maker_trades,
      countIf(lower(side) = 'buy') as buy_trades,
      countIf(lower(side) = 'sell') as sell_trades,
      sum(usdc) as total_volume,
      sumIf(usdc, lower(side) = 'buy') as buy_volume,
      sumIf(usdc, lower(side) = 'sell') as sell_volume,
      min(trade_time) as first_trade,
      max(trade_time) as last_trade,
      -- Directional bias: how asymmetric are buys vs sells
      abs(sumIf(usdc, lower(side) = 'buy') - sumIf(usdc, lower(side) = 'sell')) / sum(usdc) as directional_bias
    FROM all_trades
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  return (await result.json())[0] as any;
}

async function getEggMarketActivity(wallet: string) {
  // Specifically look at egg market trading
  const query = `
    WITH
    egg_tokens AS (
      SELECT DISTINCT token_id_dec
      FROM pm_token_to_condition_map_v5
      WHERE lower(question) LIKE '%dozen eggs%'
         OR lower(question) LIKE '%price of eggs%'
    ),
    egg_trades AS (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND toString(token_id) IN (SELECT token_id_dec FROM egg_tokens)
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      count() as egg_trades,
      sum(usdc) as egg_volume,
      countIf(lower(side) = 'buy') as egg_buys,
      countIf(lower(side) = 'sell') as egg_sells,
      sumIf(usdc, lower(side) = 'buy') as egg_buy_vol,
      sumIf(usdc, lower(side) = 'sell') as egg_sell_vol
    FROM egg_trades
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  return (await result.json())[0] as any;
}

async function checkIfSystemWallet(wallet: string) {
  // System wallets often have specific patterns:
  // 1. Trade on many markets simultaneously
  // 2. Very balanced buy/sell (market making)
  // 3. 100% maker role
  // 4. Trade at very specific intervals

  const query = `
    WITH
    trades AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      count() as total,
      countDistinct(token_id) as unique_markets,
      count() / countDistinct(token_id) as trades_per_market,
      countDistinct(toDate(trade_time)) as active_days,
      count() / countDistinct(toDate(trade_time)) as trades_per_day
    FROM trades
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  return (await result.json())[0] as any;
}

async function main() {
  console.log('=== VERIFYING EGG MARKET TRADERS ===');
  console.log('');
  console.log('Checking for system wallet indicators:');
  console.log('- Maker/taker ratio (bots are often 100% maker)');
  console.log('- Buy/sell balance (real traders have directional bias)');
  console.log('- Trades per market (bots spread across many markets)');
  console.log('');

  const results: any[] = [];

  for (const wallet of EGG_TRADERS) {
    const isXcn = wallet.toLowerCase() === XCNSTRATEGY.toLowerCase();
    const label = isXcn ? ' ← @xcnstrategy (reference)' : '';

    console.log(`\n--- ${wallet}${label} ---`);

    const pattern = await analyzeWalletPattern(wallet);
    const eggActivity = await getEggMarketActivity(wallet);
    const systemCheck = await checkIfSystemWallet(wallet);

    const takerPct = (pattern.taker_trades / pattern.total_trades * 100).toFixed(1);
    const buyPct = (pattern.buy_trades / pattern.total_trades * 100).toFixed(1);
    const directionalBias = (pattern.directional_bias * 100).toFixed(1);

    console.log(`Total trades: ${pattern.total_trades.toLocaleString()}`);
    console.log(`Taker: ${takerPct}% | Maker: ${(100 - parseFloat(takerPct)).toFixed(1)}%`);
    console.log(`Buys: ${buyPct}% | Sells: ${(100 - parseFloat(buyPct)).toFixed(1)}%`);
    console.log(`Directional bias: ${directionalBias}%`);
    console.log(`Volume: $${Math.round(pattern.total_volume).toLocaleString()}`);
    console.log(`Egg trades: ${eggActivity.egg_trades} ($${Math.round(eggActivity.egg_volume).toLocaleString()})`);
    console.log(`Unique markets: ${systemCheck.unique_markets} | Trades/market: ${systemCheck.trades_per_market.toFixed(1)}`);
    console.log(`Active days: ${systemCheck.active_days} | Trades/day: ${systemCheck.trades_per_day.toFixed(1)}`);
    console.log(`Period: ${pattern.first_trade} to ${pattern.last_trade}`);

    // Flag potential issues
    const flags: string[] = [];
    if (parseFloat(takerPct) < 10) flags.push('🤖 LOW_TAKER (likely market maker)');
    if (parseFloat(directionalBias) < 5) flags.push('⚖️ NO_DIRECTIONAL_BIAS (balanced trading)');
    if (systemCheck.trades_per_day > 500) flags.push('🔥 HIGH_FREQUENCY');
    if (systemCheck.unique_markets > 500) flags.push('🌐 MANY_MARKETS (spread thin)');
    if (parseFloat(takerPct) > 90 && parseFloat(directionalBias) > 20) flags.push('✅ LOOKS_HUMAN');

    if (flags.length > 0) {
      console.log(`Flags: ${flags.join(' | ')}`);
    }

    results.push({
      wallet,
      isXcn,
      takerPct: parseFloat(takerPct),
      buyPct: parseFloat(buyPct),
      directionalBias: parseFloat(directionalBias),
      totalTrades: pattern.total_trades,
      totalVolume: pattern.total_volume,
      eggTrades: eggActivity.egg_trades,
      eggVolume: eggActivity.egg_volume,
      uniqueMarkets: systemCheck.unique_markets,
      tradesPerDay: systemCheck.trades_per_day,
      flags,
    });
  }

  // Summary comparison
  console.log('\n\n=== SUMMARY COMPARISON ===');
  console.log('');
  console.log('Wallet                                     | Taker% | Bias% | Egg Vol    | Flags');
  console.log('-------------------------------------------|--------|-------|------------|------');

  for (const r of results) {
    const label = r.isXcn ? ' ← REF' : '';
    const flagStr = r.flags.length > 0 ? r.flags[0].split(' ')[0] : '';
    console.log(`${r.wallet} | ${r.takerPct.toFixed(0).padStart(5)}% | ${r.directionalBias.toFixed(0).padStart(4)}% | $${Math.round(r.eggVolume).toLocaleString().padStart(9)} | ${flagStr}${label}`);
  }

  // Identify real traders (similar to xcnstrategy pattern)
  console.log('\n=== RECOMMENDED: Real traders with edge ===');
  const xcnRef = results.find(r => r.isXcn);
  const goodTraders = results.filter(r =>
    !r.isXcn &&
    r.takerPct > 30 && // Not pure market maker
    r.directionalBias > 10 && // Has conviction
    r.eggVolume > 10000 && // Meaningful egg exposure
    !r.flags.some((f: string) => f.includes('🤖') || f.includes('⚖️'))
  );

  if (goodTraders.length > 0) {
    for (const t of goodTraders) {
      console.log(`✅ ${t.wallet}`);
      console.log(`   https://polymarket.com/profile/${t.wallet}`);
      console.log(`   Egg volume: $${Math.round(t.eggVolume).toLocaleString()} | Taker: ${t.takerPct.toFixed(0)}% | Bias: ${t.directionalBias.toFixed(0)}%`);
    }
  } else {
    console.log('No wallets match the @xcnstrategy pattern closely');
  }

  console.log('\n=== LIKELY SYSTEM WALLETS (avoid) ===');
  const bots = results.filter(r =>
    !r.isXcn &&
    (r.takerPct < 20 || r.directionalBias < 5 || r.flags.some((f: string) => f.includes('🤖')))
  );

  for (const t of bots) {
    console.log(`❌ ${t.wallet}`);
    console.log(`   Reason: ${t.flags.join(', ') || 'Pattern mismatch'}`);
  }
}

main().catch(console.error);
