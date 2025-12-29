/**
 * Calculate lifetime t-stat for @xcnstrategy
 * - Overall t-stat
 * - Per-event breakdown (eggs, Fed, inflation, etc.)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const XCNSTRATEGY = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const W_MAX = 1000;

interface TStatResult {
  event_type: string;
  fills: number;
  markets: number;
  volume: number;
  mean_bps: number;
  std_bps: number;
  sharpe: number;
  t_stat: number;
  n_eff: number;
}

async function getMarketsTraded(wallet: string) {
  // Get all markets this wallet traded with questions
  const query = `
    SELECT DISTINCT
      m.question,
      m.category,
      toString(t.token_id) as token_id
    FROM pm_trader_events_v2 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON toString(t.token_id) = m.token_id_dec
    WHERE t.trader_wallet = {wallet:String}
      AND t.is_deleted = 0
    ORDER BY m.question
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  return await result.json() as any[];
}

async function computeTStatForEventType(wallet: string, eventFilter: string, eventName: string): Promise<TStatResult | null> {
  // Compute t-stat for trades matching a specific event pattern
  // Uses resolution price as reference (more reliable than 14d price snapshots)

  const query = `
    WITH
    -- Get trades for this event type with condition mapping
    event_trades AS (
      SELECT
        t.event_id,
        any(t.token_id) as token_id,
        any(t.side) as side,
        any(t.usdc_amount) / 1000000.0 as notional,
        any(t.usdc_amount) / any(t.token_amount) as fill_price,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_v5 m ON toString(t.token_id) = m.token_id_dec
      WHERE t.trader_wallet = {wallet:String}
        AND t.is_deleted = 0
        AND t.token_amount > 0
        AND t.role = 'taker'
        AND lower(m.question) LIKE {filter:String}
      GROUP BY t.event_id
    ),
    -- Get resolution prices via condition_id + outcome_index
    with_resolution AS (
      SELECT
        e.event_id,
        e.token_id,
        e.notional,
        if(lower(e.side) = 'buy', 1, -1) as direction,
        e.fill_price,
        r.resolved_price as resolution_price,
        least(sqrt(e.notional), {w_max:Float64}) as weight
      FROM event_trades e
      INNER JOIN pm_resolution_prices_corrected r
        ON e.condition_id = r.condition_id
        AND e.outcome_index = r.outcome_index
    ),
    -- Compute stats
    stats AS (
      SELECT
        count() as fills,
        countDistinct(token_id) as markets,
        sum(notional) as volume,
        sum(weight) as total_weight,
        sum(weight * weight) as total_weight_sq,
        sum(weight * direction * (resolution_price - fill_price) * 10000) / sum(weight) as wmean,
        sum(weight * pow(direction * (resolution_price - fill_price) * 10000, 2)) / sum(weight)
          - pow(sum(weight * direction * (resolution_price - fill_price) * 10000) / sum(weight), 2) as wvar
      FROM with_resolution
    )
    SELECT
      fills,
      markets,
      volume,
      wmean as mean_bps,
      sqrt(greatest(wvar, 0)) as std_bps,
      total_weight,
      total_weight_sq,
      pow(total_weight, 2) / nullIf(total_weight_sq, 0) as n_eff
    FROM stats
    WHERE fills >= 5
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: {
        wallet: wallet.toLowerCase(),
        filter: eventFilter,
        w_max: W_MAX,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    if (rows.length === 0 || !rows[0].fills) return null;

    const row = rows[0];
    const mean = parseFloat(row.mean_bps) || 0;
    const std = parseFloat(row.std_bps) || 1;
    const nEff = parseFloat(row.n_eff) || 1;
    const sharpe = mean / (std + 1);
    const tStat = sharpe * Math.sqrt(nEff);

    return {
      event_type: eventName,
      fills: parseInt(row.fills),
      markets: parseInt(row.markets),
      volume: parseFloat(row.volume) || 0,
      mean_bps: mean,
      std_bps: std,
      sharpe,
      t_stat: tStat,
      n_eff: nEff,
    };
  } catch (err: any) {
    console.error(`Error for ${eventName}: ${err.message}`);
    return null;
  }
}

async function computeOverallTStat(wallet: string): Promise<TStatResult | null> {
  // Compute overall lifetime t-stat using resolution prices
  const query = `
    WITH
    all_trades AS (
      SELECT
        t.event_id,
        any(t.token_id) as token_id,
        any(t.side) as side,
        any(t.usdc_amount) / 1000000.0 as notional,
        any(t.usdc_amount) / any(t.token_amount) as fill_price,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_v5 m ON toString(t.token_id) = m.token_id_dec
      WHERE t.trader_wallet = {wallet:String}
        AND t.is_deleted = 0
        AND t.token_amount > 0
        AND t.role = 'taker'
      GROUP BY t.event_id
    ),
    with_resolution AS (
      SELECT
        e.event_id,
        e.token_id,
        e.notional,
        if(lower(e.side) = 'buy', 1, -1) as direction,
        e.fill_price,
        r.resolved_price as resolution_price,
        least(sqrt(e.notional), {w_max:Float64}) as weight
      FROM all_trades e
      INNER JOIN pm_resolution_prices_corrected r
        ON e.condition_id = r.condition_id
        AND e.outcome_index = r.outcome_index
    ),
    stats AS (
      SELECT
        count() as fills,
        countDistinct(token_id) as markets,
        sum(notional) as volume,
        sum(weight) as total_weight,
        sum(weight * weight) as total_weight_sq,
        sum(weight * direction * (resolution_price - fill_price) * 10000) / sum(weight) as wmean,
        sum(weight * pow(direction * (resolution_price - fill_price) * 10000, 2)) / sum(weight)
          - pow(sum(weight * direction * (resolution_price - fill_price) * 10000) / sum(weight), 2) as wvar
      FROM with_resolution
    )
    SELECT
      fills,
      markets,
      volume,
      wmean as mean_bps,
      sqrt(greatest(wvar, 0)) as std_bps,
      total_weight,
      total_weight_sq,
      pow(total_weight, 2) / nullIf(total_weight_sq, 0) as n_eff
    FROM stats
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: {
        wallet: wallet.toLowerCase(),
        w_max: W_MAX,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    if (rows.length === 0 || !rows[0].fills) return null;

    const row = rows[0];
    const mean = parseFloat(row.mean_bps) || 0;
    const std = parseFloat(row.std_bps) || 1;
    const nEff = parseFloat(row.n_eff) || 1;
    const sharpe = mean / (std + 1);
    const tStat = sharpe * Math.sqrt(nEff);

    return {
      event_type: 'OVERALL',
      fills: parseInt(row.fills),
      markets: parseInt(row.markets),
      volume: parseFloat(row.volume) || 0,
      mean_bps: mean,
      std_bps: std,
      sharpe,
      t_stat: tStat,
      n_eff: nEff,
    };
  } catch (err: any) {
    console.error(`Error for overall: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('=== @xcnstrategy LIFETIME T-STAT ANALYSIS ===');
  console.log(`Wallet: ${XCNSTRATEGY}`);
  console.log('');
  console.log('Methodology:');
  console.log('- Markout = direction × (resolution_price - fill_price) × 10000 bps');
  console.log('- Weight = min(sqrt(notional), 1000)');
  console.log('- Sharpe = weighted_mean / (weighted_std + 1)');
  console.log('- T-stat = Sharpe × √N_eff');
  console.log('- Using RESOLUTION prices (more reliable than 14d snapshots)');
  console.log('');

  // First, see what markets they traded
  console.log('--- MARKETS TRADED (sample) ---');
  const markets = await getMarketsTraded(XCNSTRATEGY);
  const uniqueQuestions = [...new Set(markets.map(m => m.question))].filter(Boolean);
  console.log(`Total unique markets: ${uniqueQuestions.length}`);

  // Show sample of market types
  const eggMarkets = uniqueQuestions.filter(q => q?.toLowerCase().includes('egg'));
  const fedMarkets = uniqueQuestions.filter(q => q?.toLowerCase().includes('fed') || q?.toLowerCase().includes('rate'));
  const inflationMarkets = uniqueQuestions.filter(q => q?.toLowerCase().includes('inflation'));
  const cryptoMarkets = uniqueQuestions.filter(q => q?.toLowerCase().includes('bitcoin') || q?.toLowerCase().includes('ethereum'));

  console.log(`Egg markets: ${eggMarkets.length}`);
  console.log(`Fed/Rate markets: ${fedMarkets.length}`);
  console.log(`Inflation markets: ${inflationMarkets.length}`);
  console.log(`Crypto markets: ${cryptoMarkets.length}`);
  console.log('');

  // Compute overall t-stat
  console.log('--- OVERALL LIFETIME T-STAT ---');
  const overall = await computeOverallTStat(XCNSTRATEGY);
  if (overall) {
    console.log(`Fills: ${overall.fills.toLocaleString()}`);
    console.log(`Markets: ${overall.markets}`);
    console.log(`Volume: $${Math.round(overall.volume).toLocaleString()}`);
    console.log(`Mean markout: ${overall.mean_bps.toFixed(1)} bps`);
    console.log(`Std: ${overall.std_bps.toFixed(1)} bps`);
    console.log(`Sharpe: ${overall.sharpe.toFixed(3)}`);
    console.log(`N_eff: ${overall.n_eff.toFixed(1)}`);
    console.log(`T-STAT: ${overall.t_stat.toFixed(2)}`);

    const verdict = overall.t_stat > 4 ? '✅ VERY STRONG (t > 4)'
                  : overall.t_stat > 2 ? '👀 STATISTICALLY SIGNIFICANT (t > 2)'
                  : overall.t_stat > 0 ? '⚠️ WEAK'
                  : '❌ NEGATIVE';
    console.log(`Verdict: ${verdict}`);
  } else {
    console.log('No data available');
  }
  console.log('');

  // Define event types to analyze
  const eventTypes = [
    { name: 'Eggs (dozen eggs)', filter: '%dozen eggs%' },
    { name: 'Eggs (price of eggs)', filter: '%price of eggs%' },
    { name: 'Fed rates', filter: '%fed%rate%' },
    { name: 'Inflation', filter: '%inflation%' },
    { name: 'Xi Jinping', filter: '%xi jinping%' },
    { name: 'Bitcoin', filter: '%bitcoin%' },
    { name: 'Ethereum', filter: '%ethereum%' },
    { name: 'Tesla', filter: '%tesla%' },
    { name: 'Trump', filter: '%trump%' },
    { name: 'Kamala/Harris', filter: '%harris%' },
    { name: 'Election', filter: '%election%' },
    { name: 'Popular vote', filter: '%popular vote%' },
  ];

  console.log('--- PER-EVENT T-STAT BREAKDOWN ---');
  console.log('');
  console.log('Event Type           | Fills | Markets | Volume     | Mean(bps) | Sharpe | T-Stat | Verdict');
  console.log('---------------------|-------|---------|------------|-----------|--------|--------|--------');

  const results: TStatResult[] = [];

  for (const { name, filter } of eventTypes) {
    const stat = await computeTStatForEventType(XCNSTRATEGY, filter, name);
    if (stat) {
      results.push(stat);
      const verdict = stat.t_stat > 4 ? '✅ STRONG'
                    : stat.t_stat > 2 ? '👀 SIG'
                    : stat.t_stat > 0 ? '⚠️ WEAK'
                    : '❌ NEG';
      console.log(
        `${name.padEnd(20)} | ${stat.fills.toString().padStart(5)} | ${stat.markets.toString().padStart(7)} | $${Math.round(stat.volume).toLocaleString().padStart(9)} | ${stat.mean_bps.toFixed(1).padStart(9)} | ${stat.sharpe.toFixed(2).padStart(6)} | ${stat.t_stat.toFixed(1).padStart(6)} | ${verdict}`
      );
    }
  }

  // Summary
  console.log('');
  console.log('=== SUMMARY ===');
  console.log('');

  // Sort by t-stat
  results.sort((a, b) => b.t_stat - a.t_stat);

  console.log('Best performing event types for @xcnstrategy:');
  for (const r of results.filter(r => r.t_stat > 2)) {
    console.log(`  ✅ ${r.event_type}: T-stat ${r.t_stat.toFixed(1)} (${r.fills} fills, ${r.mean_bps.toFixed(0)} bps mean)`);
  }

  console.log('');
  console.log('Weak/negative event types:');
  for (const r of results.filter(r => r.t_stat <= 2)) {
    console.log(`  ⚠️ ${r.event_type}: T-stat ${r.t_stat.toFixed(1)}`);
  }

  if (overall) {
    console.log('');
    console.log('KEY INSIGHT:');
    const eggStats = results.filter(r => r.event_type.includes('Egg'));
    if (eggStats.length > 0) {
      const bestEgg = eggStats.reduce((a, b) => a.t_stat > b.t_stat ? a : b);
      console.log(`- Overall t-stat: ${overall.t_stat.toFixed(1)}`);
      console.log(`- Best egg t-stat: ${bestEgg.t_stat.toFixed(1)}`);
      if (bestEgg.t_stat > overall.t_stat) {
        console.log(`- Eggs are their specialty! T-stat ${(bestEgg.t_stat - overall.t_stat).toFixed(1)} higher than overall`);
      }
    }
  }
}

main().catch(console.error);
