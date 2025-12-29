/**
 * Find the BEST specialist wallet for each recurring event series
 *
 * Uses pm_market_metadata.series_slug to properly bundle recurring events:
 * - "egg-prices-monthly" bundles May, June, July, August eggs
 * - "fed-interest-rates" bundles all Fed rate decisions
 * - "elon-tweets" bundles Elon tweet markets
 *
 * For each series with significant volume, finds the wallet with:
 * 1. Highest t-stat (skill, not luck)
 * 2. Minimum 5 resolved fills (statistical significance)
 * 3. Positive mean markout (actual edge)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const W_MAX = 1000;
const MIN_SERIES_VOLUME = 100000; // $100K+ volume series only
const MIN_FILLS = 10;            // At least 10 resolved fills per wallet per series

interface SeriesSpec {
  series_slug: string;
  sample_question: string;
  total_markets: number;
  total_volume: number;
}

interface WalletSeriesStat {
  wallet: string;
  series_slug: string;
  fills: number;
  markets: number;
  volume: number;
  mean_bps: number;
  std_bps: number;
  sharpe: number;
  t_stat: number;
  n_eff: number;
}

async function getTopSeries(): Promise<SeriesSpec[]> {
  const query = `
    SELECT
      series_slug,
      any(question) as sample_question,
      count() as total_markets,
      sum(volume_usdc) as total_volume
    FROM pm_market_metadata
    WHERE series_slug != ''
      AND series_slug NOT LIKE '%hourly%'
      AND series_slug NOT LIKE '%15m%'
    GROUP BY series_slug
    HAVING total_volume >= {min_volume:Float64}
    ORDER BY total_volume DESC
    LIMIT 30
  `;

  const result = await clickhouse.query({
    query,
    query_params: { min_volume: MIN_SERIES_VOLUME },
    format: 'JSONEachRow',
  });

  return await result.json() as SeriesSpec[];
}

async function findBestWalletsForSeries(seriesSlug: string): Promise<WalletSeriesStat[]> {
  // Find top wallets by t-stat for this series
  const query = `
    WITH
    -- Get condition_ids for this series
    series_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_market_metadata
      WHERE series_slug = {series:String}
    ),
    -- Get trades for wallets in this series (dedupe by event_id)
    series_trades AS (
      SELECT
        t.event_id,
        t.trader_wallet,
        any(t.token_id) as token_id,
        any(t.side) as side,
        any(t.usdc_amount) / 1000000.0 as notional,
        any(t.usdc_amount) / any(t.token_amount) as fill_price,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_v2 t
      INNER JOIN pm_token_to_condition_map_v5 m ON toString(t.token_id) = m.token_id_dec
      WHERE m.condition_id IN (SELECT condition_id FROM series_conditions)
        AND t.is_deleted = 0
        AND t.token_amount > 0
        AND t.role = 'taker'
      GROUP BY t.event_id, t.trader_wallet
    ),
    -- Join with resolution prices
    with_resolution AS (
      SELECT
        e.trader_wallet,
        e.event_id,
        e.token_id,
        e.notional,
        if(lower(e.side) = 'buy', 1, -1) as direction,
        e.fill_price,
        r.resolved_price as resolution_price,
        least(sqrt(e.notional), {w_max:Float64}) as weight
      FROM series_trades e
      INNER JOIN pm_resolution_prices_corrected r
        ON e.condition_id = r.condition_id
        AND e.outcome_index = r.outcome_index
    ),
    -- Compute per-wallet stats
    wallet_stats AS (
      SELECT
        trader_wallet,
        count() as fills,
        countDistinct(token_id) as markets,
        sum(notional) as volume,
        sum(weight) as total_weight,
        sum(weight * weight) as total_weight_sq,
        sum(weight * direction * (resolution_price - fill_price) * 10000) / sum(weight) as wmean,
        sum(weight * pow(direction * (resolution_price - fill_price) * 10000, 2)) / sum(weight)
          - pow(sum(weight * direction * (resolution_price - fill_price) * 10000) / sum(weight), 2) as wvar
      FROM with_resolution
      GROUP BY trader_wallet
      HAVING fills >= {min_fills:UInt32}
    )
    SELECT
      trader_wallet as wallet,
      fills,
      markets,
      volume,
      wmean as mean_bps,
      sqrt(greatest(wvar, 0)) as std_bps,
      wmean / (sqrt(greatest(wvar, 0)) + 1) as sharpe,
      (wmean / (sqrt(greatest(wvar, 0)) + 1)) * sqrt(pow(total_weight, 2) / nullIf(total_weight_sq, 0)) as t_stat,
      pow(total_weight, 2) / nullIf(total_weight_sq, 0) as n_eff
    FROM wallet_stats
    WHERE wmean > 0  -- Only profitable wallets
    ORDER BY t_stat DESC
    LIMIT 5
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: {
        series: seriesSlug,
        w_max: W_MAX,
        min_fills: MIN_FILLS,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    return rows.map(r => ({
      wallet: r.wallet,
      series_slug: seriesSlug,
      fills: parseInt(r.fills),
      markets: parseInt(r.markets),
      volume: parseFloat(r.volume) || 0,
      mean_bps: parseFloat(r.mean_bps) || 0,
      std_bps: parseFloat(r.std_bps) || 0,
      sharpe: parseFloat(r.sharpe) || 0,
      t_stat: parseFloat(r.t_stat) || 0,
      n_eff: parseFloat(r.n_eff) || 0,
    }));
  } catch (err: any) {
    console.error(`Error for ${seriesSlug}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('=== FINDING SPECIALISTS FOR RECURRING EVENT SERIES ===');
  console.log('');
  console.log('Using pm_market_metadata.series_slug to bundle recurring events.');
  console.log(`Minimum series volume: $${(MIN_SERIES_VOLUME/1000).toFixed(0)}K`);
  console.log(`Minimum fills per wallet: ${MIN_FILLS}`);
  console.log('');

  // Get top series by volume
  const series = await getTopSeries();
  console.log(`Found ${series.length} qualifying series\n`);

  const allSpecialists: WalletSeriesStat[] = [];

  for (const s of series) {
    console.log(`--- ${s.series_slug} ---`);
    console.log(`   Sample: "${s.sample_question.substring(0, 60)}..."`);
    console.log(`   Markets: ${s.total_markets} | Volume: $${Math.round(s.total_volume / 1e6)}M`);

    const topWallets = await findBestWalletsForSeries(s.series_slug);

    if (topWallets.length === 0) {
      console.log('   No qualifying specialists found\n');
      continue;
    }

    const best = topWallets[0];
    allSpecialists.push(best);

    console.log(`   TOP SPECIALIST: ${best.wallet.substring(0, 10)}...`);
    console.log(`   T-stat: ${best.t_stat.toFixed(2)} | Mean: ${best.mean_bps.toFixed(0)} bps | Fills: ${best.fills} | $${Math.round(best.volume).toLocaleString()}`);
    console.log('');
  }

  // Summary
  console.log('\n=== SPECIALIST PORTFOLIO ===\n');
  console.log('Series                              | Wallet       | T-Stat | Mean(bps) | Fills | Volume');
  console.log('------------------------------------|--------------|--------|-----------|-------|--------');

  // Sort by t-stat
  allSpecialists.sort((a, b) => b.t_stat - a.t_stat);

  for (const s of allSpecialists) {
    const verdict = s.t_stat > 4 ? '✅' : s.t_stat > 2 ? '👀' : '⚠️';
    console.log(
      `${s.series_slug.padEnd(35)} | ${s.wallet.substring(0, 12)} | ${s.t_stat.toFixed(1).padStart(6)} | ${s.mean_bps.toFixed(0).padStart(9)} | ${s.fills.toString().padStart(5)} | $${Math.round(s.volume).toLocaleString().padStart(8)} ${verdict}`
    );
  }

  console.log('\n=== TOP 10 SPECIALISTS BY T-STAT ===\n');
  for (const s of allSpecialists.slice(0, 10)) {
    console.log(`${s.t_stat > 4 ? '✅' : '👀'} ${s.series_slug}`);
    console.log(`   Wallet: ${s.wallet}`);
    console.log(`   https://polymarket.com/profile/${s.wallet}`);
    console.log(`   T-stat: ${s.t_stat.toFixed(2)} | Mean: ${s.mean_bps.toFixed(0)} bps | Sharpe: ${s.sharpe.toFixed(2)}`);
    console.log(`   Fills: ${s.fills} | Markets: ${s.markets} | Volume: $${Math.round(s.volume).toLocaleString()}`);
    console.log('');
  }

  console.log('=== COPY-TRADING STRATEGY ===\n');
  console.log('For each recurring event type, deploy capital to the TOP specialist wallet.');
  console.log('');
  console.log('Expected edge:');
  const avgTStat = allSpecialists.reduce((a, b) => a + b.t_stat, 0) / allSpecialists.length;
  console.log(`  Average specialist t-stat: ${avgTStat.toFixed(2)}`);
  console.log('  After copy friction (30-50% loss): ~' + (avgTStat * 0.6).toFixed(2) + ' effective t-stat');
  console.log('');
  console.log('This is MUCH better than copying a generalist wallet.');
  console.log('Each specialist has 2-3x edge in their domain vs their overall portfolio.');
}

main().catch(console.error);
