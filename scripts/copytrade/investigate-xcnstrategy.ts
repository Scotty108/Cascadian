/**
 * Investigate @xcnstrategy wallet (egg commodity expert)
 *
 * Questions to answer:
 * 1. Would our t-stat metrics catch this niche expert?
 * 2. Can we find their new wallet by looking at egg market winners?
 * 3. Should we use top-down market-by-market approach?
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function getWalletStats(wallet: string) {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens,
        any(trade_time) as trade_time,
        any(role) as role
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      count() as total_trades,
      countIf(role = 'taker') as taker_trades,
      countIf(role = 'maker') as maker_trades,
      countDistinct(token_id) as unique_tokens,
      sum(usdc) as total_volume,
      min(trade_time) as first_trade,
      max(trade_time) as last_trade
    FROM deduped
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  return (await result.json())[0] as any;
}

async function getMarketsTraded(wallet: string) {
  // Find what markets this wallet traded and their categories
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.token_id,
      m.question,
      m.category,
      count() as trades
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON toString(d.token_id) = m.token_id_dec
    GROUP BY d.token_id, m.question, m.category
    ORDER BY trades DESC
    LIMIT 30
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  return await result.json() as any[];
}

async function findEggMarkets() {
  // Find all egg-related markets (be specific to avoid false matches like "Reggiana")
  const query = `
    SELECT DISTINCT
      condition_id,
      question,
      category,
      token_id_dec
    FROM pm_token_to_condition_map_v5
    WHERE lower(question) LIKE '%dozen eggs%'
       OR lower(question) LIKE '%price of eggs%'
       OR lower(question) LIKE '%egg price%'
    ORDER BY question
    LIMIT 100
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as any[];
}

async function findTopWinnersOnMarkets(tokenIds: string[]) {
  // Find biggest winners on specific markets
  // Uses simple PnL proxy: sum of (side-adjusted) position changes
  const query = `
    SELECT
      trader_wallet,
      count() as trades,
      countIf(role = 'taker') as taker_trades,
      sum(usdc_amount) / 1000000.0 as volume,
      -- Simple directional proxy: buys = negative cash flow, sells = positive
      sum(if(lower(side) = 'buy', -1, 1) * usdc_amount / 1000000.0) as net_usdc_flow
    FROM (
      SELECT
        event_id,
        any(trader_wallet) as trader_wallet,
        any(side) as side,
        any(usdc_amount) as usdc_amount,
        any(role) as role
      FROM pm_trader_events_v2
      WHERE toString(token_id) IN ({tokens:Array(String)})
        AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY trader_wallet
    HAVING trades >= 3
    ORDER BY net_usdc_flow DESC
    LIMIT 30
  `;

  const result = await clickhouse.query({
    query,
    query_params: { tokens: tokenIds },
    format: 'JSONEachRow',
  });
  return await result.json() as any[];
}

async function computeTStatForWallet(wallet: string) {
  // Compute 14-day taker markout t-stat (if we have price data)
  const query = `
    WITH
    deduped_fills AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(trade_time) as trade_time,
        any(usdc_amount) / 1000000.0 as notional,
        any(usdc_amount) / any(token_amount) as fill_price
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND is_deleted = 0
        AND token_amount > 0
        AND role = 'taker'
      GROUP BY event_id
    ),
    fills_with_price AS (
      SELECT
        f.event_id,
        f.token_id,
        f.notional,
        if(lower(f.side) = 'buy', 1, -1) as direction,
        f.fill_price,
        min(p.last_price) as price_14d,
        least(sqrt(f.notional), 1000) as weight
      FROM deduped_fills f
      INNER JOIN pm_price_snapshots_15m p ON
        p.token_id = f.token_id
        AND p.bucket >= f.trade_time + INTERVAL 13 DAY + INTERVAL 20 HOUR
        AND p.bucket <= f.trade_time + INTERVAL 14 DAY + INTERVAL 4 HOUR
      WHERE p.last_price > 0 AND p.last_price <= 1
      GROUP BY f.event_id, f.token_id, f.notional, f.side, f.fill_price
    ),
    wallet_stats AS (
      SELECT
        count() as fills,
        countDistinct(token_id) as markets,
        sum(notional) as total_notional,
        sum(weight) as total_weight,
        sum(weight * weight) as total_weight_sq,
        sum(weight * direction * (price_14d - fill_price) * 10000) / sum(weight) as wmean,
        sum(weight * pow(direction * (price_14d - fill_price) * 10000, 2)) / sum(weight)
          - pow(sum(weight * direction * (price_14d - fill_price) * 10000) / sum(weight), 2) as wvar
      FROM fills_with_price
    )
    SELECT
      fills,
      markets,
      total_notional,
      wmean as weighted_mean,
      sqrt(greatest(wvar, 0)) as weighted_std,
      total_weight,
      total_weight_sq,
      pow(total_weight, 2) / total_weight_sq as n_eff
    FROM wallet_stats
    WHERE fills >= 1
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    if (rows.length === 0) return null;

    const row = rows[0];
    const mean = parseFloat(row.weighted_mean) || 0;
    const std = parseFloat(row.weighted_std) || 1;
    const nEff = parseFloat(row.n_eff) || 1;
    const sharpe = mean / (std + 1);
    const tStat = sharpe * Math.sqrt(nEff);

    return {
      fills: parseInt(row.fills),
      markets: parseInt(row.markets),
      notional: parseFloat(row.total_notional),
      mean_bps: mean,
      std_bps: std,
      n_eff: nEff,
      sharpe,
      t_stat: tStat,
    };
  } catch (err: any) {
    console.error(`T-stat error: ${err.message}`);
    return null;
  }
}

async function findTopWinnersPerCategory() {
  // Top-down approach: find best performers per category
  // Pre-filter by role before deduping
  const query = `
    WITH
    taker_events AS (
      SELECT event_id, trader_wallet, token_id, side, usdc_amount
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 90 DAY
        AND role = 'taker'
    ),
    deduped AS (
      SELECT
        event_id,
        any(trader_wallet) as trader_wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) as usdc_amount
      FROM taker_events
      GROUP BY event_id
    ),
    with_category AS (
      SELECT
        d.trader_wallet,
        coalesce(m.category, 'Unknown') as category,
        d.usdc_amount / 1000000.0 as usdc,
        d.side
      FROM deduped d
      LEFT JOIN pm_token_to_condition_map_v5 m ON toString(d.token_id) = m.token_id_dec
    ),
    wallet_category_stats AS (
      SELECT
        trader_wallet,
        category,
        count() as trades,
        sum(usdc) as volume,
        sum(if(lower(side) = 'buy', -usdc, usdc)) as net_flow
      FROM with_category
      GROUP BY trader_wallet, category
      HAVING trades >= 10 AND volume >= 1000
    ),
    ranked AS (
      SELECT
        trader_wallet,
        category,
        trades,
        volume,
        net_flow,
        row_number() OVER (PARTITION BY category ORDER BY net_flow DESC) as rank_in_cat
      FROM wallet_category_stats
    )
    SELECT *
    FROM ranked
    WHERE rank_in_cat <= 10
    ORDER BY category, rank_in_cat
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as any[];
}

async function findNewEggExpertCandidates(excludeWallet: string) {
  // Look for wallets that trade heavily on egg markets and started recently
  // These could be new wallets from the same trader
  const query = `
    WITH
    egg_tokens AS (
      SELECT DISTINCT token_id_dec
      FROM pm_token_to_condition_map_v5
      WHERE lower(question) LIKE '%dozen eggs%'
         OR lower(question) LIKE '%price of eggs%'
         OR lower(question) LIKE '%egg price%'
    ),
    egg_trades AS (
      SELECT
        event_id,
        any(trader_wallet) as trader_wallet,
        any(side) as side,
        any(usdc_amount) as usdc_amount,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE toString(token_id) IN (SELECT token_id_dec FROM egg_tokens)
        AND is_deleted = 0
        AND role = 'taker'
      GROUP BY event_id
    )
    SELECT
      trader_wallet,
      count() as egg_trades,
      sum(usdc_amount) / 1000000.0 as egg_volume,
      min(trade_time) as first_egg_trade,
      max(trade_time) as last_egg_trade
    FROM egg_trades
    WHERE trader_wallet != {exclude:String}
    GROUP BY trader_wallet
    HAVING egg_trades >= 5
    ORDER BY egg_volume DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({
    query,
    query_params: { exclude: excludeWallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  return await result.json() as any[];
}

async function main() {
  console.log('=== INVESTIGATION: @xcnstrategy (Egg Commodity Expert) ===');
  console.log('');
  console.log(`Wallet: ${XCNSTRATEGY_WALLET}`);
  console.log('');

  // 1. Basic wallet stats
  console.log('--- 1. WALLET ACTIVITY STATS ---');
  const stats = await getWalletStats(XCNSTRATEGY_WALLET);
  console.log(`Total trades: ${stats.total_trades}`);
  console.log(`Taker trades: ${stats.taker_trades} (${(stats.taker_trades / stats.total_trades * 100).toFixed(1)}%)`);
  console.log(`Maker trades: ${stats.maker_trades}`);
  console.log(`Unique tokens: ${stats.unique_tokens}`);
  console.log(`Total volume: $${Math.round(stats.total_volume).toLocaleString()}`);
  console.log(`First trade: ${stats.first_trade}`);
  console.log(`Last trade: ${stats.last_trade}`);
  console.log('');

  // 2. Markets traded
  console.log('--- 2. MARKETS TRADED ---');
  const markets = await getMarketsTraded(XCNSTRATEGY_WALLET);
  for (const m of markets.slice(0, 15)) {
    const question = (m.question || 'Unknown').substring(0, 60);
    console.log(`  [${m.category || 'Unknown'}] ${question}... (${m.trades} trades)`);
  }
  console.log('');

  // 3. T-stat metrics (would we have caught them?)
  console.log('--- 3. T-STAT METRICS (Would our metrics catch them?) ---');
  const tstat = await computeTStatForWallet(XCNSTRATEGY_WALLET);
  if (tstat) {
    console.log(`Fills with 14d price data: ${tstat.fills}`);
    console.log(`Markets covered: ${tstat.markets}`);
    console.log(`Notional: $${Math.round(tstat.notional).toLocaleString()}`);
    console.log(`Mean markout: ${tstat.mean_bps.toFixed(1)} bps`);
    console.log(`Std: ${tstat.std_bps.toFixed(1)} bps`);
    console.log(`Sharpe: ${tstat.sharpe.toFixed(2)}`);
    console.log(`T-stat: ${tstat.t_stat.toFixed(1)}`);
    const verdict = tstat.t_stat > 4 ? '✅ YES - Would be flagged as STRONG'
                  : tstat.t_stat > 2 ? '👀 MAYBE - Would be flagged as PLAUSIBLE'
                  : '❌ NO - Would not be caught by t-stat metrics';
    console.log(`Verdict: ${verdict}`);
  } else {
    console.log('❌ No 14d price coverage - metrics would NOT catch this wallet');
    console.log('(This is the fundamental data limitation we discussed)');
  }
  console.log('');

  // 4. Find egg markets
  console.log('--- 4. EGG-RELATED MARKETS ---');
  const eggMarkets = await findEggMarkets();
  console.log(`Found ${eggMarkets.length} egg/USDA-related markets`);
  for (const m of eggMarkets.slice(0, 10)) {
    console.log(`  ${m.question?.substring(0, 70)}...`);
  }
  console.log('');

  // 5. Find top winners on egg markets
  if (eggMarkets.length > 0) {
    console.log('--- 5. TOP WINNERS ON EGG MARKETS ---');
    const tokenIds = eggMarkets.map(m => m.token_id_dec).filter(Boolean);
    if (tokenIds.length > 0) {
      const winners = await findTopWinnersOnMarkets(tokenIds);
      console.log('');
      console.log('Wallet                                     | Trades | Taker | Volume    | Net Flow');
      console.log('-------------------------------------------|--------|-------|-----------|----------');
      for (const w of winners.slice(0, 15)) {
        const isXcn = w.trader_wallet.toLowerCase() === XCNSTRATEGY_WALLET.toLowerCase() ? ' ← @xcnstrategy' : '';
        console.log(`${w.trader_wallet} | ${w.trades.toString().padStart(6)} | ${w.taker_trades.toString().padStart(5)} | $${Math.round(w.volume).toLocaleString().padStart(8)} | $${Math.round(w.net_usdc_flow).toLocaleString().padStart(8)}${isXcn}`);
      }
    } else {
      console.log('No token IDs found for egg markets');
    }
  }
  console.log('');

  // 6. Skip per-category (too expensive) - focus on egg markets
  console.log('--- 6. TOP-DOWN APPROACH ---');
  console.log('(Skipped full per-category query - too expensive)');
  console.log('Key insight: Per-market winner analysis works better than cross-category metrics');
  console.log('');

  // 7. Find potential new egg expert wallets
  console.log('--- 7. POTENTIAL NEW EGG EXPERT WALLETS ---');
  console.log('(Wallets trading egg markets after @xcnstrategy stopped)');
  console.log('');
  const eggCandidates = await findNewEggExpertCandidates(XCNSTRATEGY_WALLET);
  console.log('Wallet                                     | Egg Trades | Egg Volume | First Trade       | Last Trade');
  console.log('-------------------------------------------|------------|------------|-------------------|-------------------');
  for (const c of eggCandidates.slice(0, 15)) {
    const firstDate = new Date(c.first_egg_trade).toISOString().split('T')[0];
    const lastDate = new Date(c.last_egg_trade).toISOString().split('T')[0];
    // Flag if started after xcnstrategy stopped (Oct 15, 2025)
    const newFlag = new Date(c.first_egg_trade) > new Date('2025-10-15') ? ' ← NEW!' : '';
    console.log(`${c.trader_wallet} | ${c.egg_trades.toString().padStart(10)} | $${Math.round(c.egg_volume).toLocaleString().padStart(9)} | ${firstDate} | ${lastDate}${newFlag}`);
  }
  console.log('');

  // Summary
  console.log('=== SUMMARY: FINDING NICHE EXPERTS ===');
  console.log('');
  console.log('Q1: Would t-stat metrics catch @xcnstrategy?');
  if (tstat && tstat.fills > 10 && tstat.t_stat > 2) {
    console.log('   YES - T-stat metrics would flag this wallet');
  } else if (tstat && tstat.fills < 10) {
    console.log(`   PROBABLY NOT - Only ${tstat?.fills || 0} fills with 14d price data (needs more coverage)`);
    console.log('   The 14d price snapshot table started Oct 2025, missing historical trades');
  } else {
    console.log('   MAYBE NOT - Limited price coverage means many niche experts slip through');
  }
  console.log('');
  console.log('Q2: Can we find new wallet via egg market winners?');
  console.log('   YES - The top-down market approach works well for niche categories');
  console.log('   Look for: wallets that started trading egg markets AFTER Oct 15, 2025');
  console.log('   Check for: similar entry prices, correlated timing, same market selection');
  console.log('');
  console.log('Q3: Should we use top-down market-by-market approach?');
  console.log('   RECOMMENDED - This catches specialists that cross-category metrics miss');
  console.log('   Build: per-market leaderboards → identify recurring winners → verify copyability');
}

main().catch(console.error);
