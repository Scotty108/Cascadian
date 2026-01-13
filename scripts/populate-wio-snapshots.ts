/**
 * WIO Snapshots Population Script
 *
 * Populates:
 * 1. wio_open_snapshots_v1 - Current open position snapshots per wallet×market
 * 2. wio_market_snapshots_v1 - Smart/dumb money signals per market
 *
 * Can be run hourly via cron for live updates.
 *
 * Usage: npx tsx scripts/populate-wio-snapshots.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function populateOpenSnapshots(): Promise<number> {
  console.log('  Populating open position snapshots...');
  const startTime = Date.now();

  // Get current timestamp (rounded to hour)
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const asOfTs = now.toISOString().replace('T', ' ').slice(0, 19);

  // Insert current open positions as snapshots
  const query = `
    INSERT INTO wio_open_snapshots_v1
    SELECT
      p.wallet_id,
      p.condition_id as market_id,
      toDateTime('${asOfTs}') as as_of_ts,

      -- Position state
      p.side,
      p.qty_shares_remaining as open_shares_net,
      p.cost_usd as open_cost_usd,
      p.p_entry_side as avg_entry_price_side,

      -- Mark-to-market (use current mark price)
      ifNull(mp.mark_price, 0.5) as mark_price_side,
      -- Unrealized PnL: (mark_price - entry_price) * shares for long, inverse for short
      IF(p.side = 'YES',
        (ifNull(mp.mark_price, 0.5) - p.p_entry_side) * p.qty_shares_remaining,
        (p.p_entry_side - ifNull(mp.mark_price, 0.5)) * p.qty_shares_remaining
      ) as unrealized_pnl_usd,
      -- Unrealized ROI
      IF(p.cost_usd > 0,
        IF(p.side = 'YES',
          (ifNull(mp.mark_price, 0.5) - p.p_entry_side) * p.qty_shares_remaining / p.cost_usd,
          (p.p_entry_side - ifNull(mp.mark_price, 0.5)) * p.qty_shares_remaining / p.cost_usd
        ),
        0
      ) as unrealized_roi,

      -- Metadata
      p.primary_bundle_id as bundle_id,
      p.event_id

    FROM wio_positions_v2 p
    LEFT JOIN pm_latest_mark_price_v1 mp ON p.condition_id = mp.condition_id
    WHERE p.is_resolved = 0  -- Only open positions
      AND p.qty_shares_remaining > 0  -- Has holdings
  `;

  await clickhouse.command({ query });

  // Count inserted rows
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM wio_open_snapshots_v1
      WHERE as_of_ts = toDateTime('${asOfTs}')
    `,
    format: 'JSONEachRow'
  });
  const countRows = await countResult.json() as { cnt: string }[];
  const insertedCount = parseInt(countRows[0]?.cnt || '0');

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`    Inserted ${insertedCount.toLocaleString()} snapshots in ${elapsed.toFixed(1)}s`);

  return insertedCount;
}

async function populateMarketSnapshots(): Promise<number> {
  console.log('  Populating market snapshots with smart/dumb money signals...');
  const startTime = Date.now();

  // Get current timestamp (rounded to hour)
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const asOfTs = now.toISOString().replace('T', ' ').slice(0, 19);

  // Insert market snapshots with smart/dumb money aggregations
  const query = `
    INSERT INTO wio_market_snapshots_v1
    SELECT
      market_id,
      toDateTime('${asOfTs}') as as_of_ts,

      -- Crowd metrics (from mark prices)
      ifNull(mp.mark_price, 0.5) as crowd_odds,
      total_open_usd as total_open_interest_usd,

      -- Smart money metrics
      smart_odds as smart_money_odds,
      smart_shares as smart_holdings_shares,
      smart_usd as smart_holdings_usd,
      smart_roi as smart_unrealized_roi,
      toInt32(smart_count) as smart_wallet_count,

      -- Dumb money metrics
      dumb_odds as dumb_money_odds,
      dumb_shares as dumb_holdings_shares,
      dumb_usd as dumb_holdings_usd,
      dumb_roi as dumb_unrealized_roi,
      toInt32(dumb_count) as dumb_wallet_count,

      -- Divergence signals
      smart_odds - ifNull(mp.mark_price, 0.5) as smart_vs_crowd_delta,
      smart_odds - dumb_odds as smart_vs_dumb_delta,

      now() as computed_at

    FROM (
      SELECT
        os.market_id,

        -- Total open interest
        sum(os.open_cost_usd) as total_open_usd,

        -- Smart money (superforecaster, smart, profitable tiers)
        sumIf(os.open_shares_net, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_shares,
        sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_usd,
        -- Smart money weighted YES odds (weighted by cost)
        IF(sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'YES') +
           sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'NO') > 0,
          sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'YES') /
          (sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'YES') +
           sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'NO')),
          0.5
        ) as smart_odds,
        avgIf(os.unrealized_roi, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_roi,
        countDistinctIf(os.wallet_id, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_count,

        -- Dumb money (heavy_loser tier)
        sumIf(os.open_shares_net, wc.tier = 'heavy_loser') as dumb_shares,
        sumIf(os.open_cost_usd, wc.tier = 'heavy_loser') as dumb_usd,
        -- Dumb money weighted YES odds
        IF(sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'YES') +
           sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'NO') > 0,
          sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'YES') /
          (sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'YES') +
           sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'NO')),
          0.5
        ) as dumb_odds,
        avgIf(os.unrealized_roi, wc.tier = 'heavy_loser') as dumb_roi,
        countDistinctIf(os.wallet_id, wc.tier = 'heavy_loser') as dumb_count

      FROM wio_open_snapshots_v1 os
      LEFT JOIN wio_wallet_classification_v1 wc ON os.wallet_id = wc.wallet_id AND wc.window_id = 2
      WHERE os.as_of_ts = toDateTime('${asOfTs}')
      GROUP BY os.market_id
      HAVING total_open_usd > 0
    ) agg
    LEFT JOIN pm_latest_mark_price_v1 mp ON agg.market_id = mp.condition_id
  `;

  await clickhouse.command({ query });

  // Count inserted rows
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM wio_market_snapshots_v1
      WHERE as_of_ts = toDateTime('${asOfTs}')
    `,
    format: 'JSONEachRow'
  });
  const countRows = await countResult.json() as { cnt: string }[];
  const insertedCount = parseInt(countRows[0]?.cnt || '0');

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`    Inserted ${insertedCount.toLocaleString()} market snapshots in ${elapsed.toFixed(1)}s`);

  return insertedCount;
}

async function validateSnapshots(): Promise<void> {
  console.log('\nValidating snapshots...');

  // Get current timestamp (rounded to hour)
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const asOfTs = now.toISOString().replace('T', ' ').slice(0, 19);

  // Sample open snapshots
  const openResult = await clickhouse.query({
    query: `
      SELECT
        wallet_id,
        market_id,
        side,
        round(open_shares_net, 2) as shares,
        round(open_cost_usd, 2) as cost,
        round(mark_price_side, 3) as mark,
        round(unrealized_pnl_usd, 2) as upnl,
        round(unrealized_roi * 100, 1) as roi_pct
      FROM wio_open_snapshots_v1
      WHERE as_of_ts = toDateTime('${asOfTs}')
      ORDER BY open_cost_usd DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const openSamples = await openResult.json() as any[];

  console.log('\nTop 5 open positions by cost:');
  console.log('Wallet         | Side | Shares    | Cost       | Mark  | Unrealized');
  console.log('---------------|------|-----------|------------|-------|------------');
  for (const s of openSamples) {
    const wallet = s.wallet_id.slice(0, 13);
    console.log(`${wallet}... | ${s.side.padEnd(4)} | ${String(s.shares).padStart(9)} | $${String(s.cost).padStart(9)} | ${s.mark} | $${s.upnl} (${s.roi_pct}%)`);
  }

  // Sample market snapshots with divergence
  const marketResult = await clickhouse.query({
    query: `
      SELECT
        market_id,
        round(crowd_odds * 100, 1) as crowd_pct,
        round(smart_money_odds * 100, 1) as smart_pct,
        round(dumb_money_odds * 100, 1) as dumb_pct,
        round(smart_vs_crowd_delta * 100, 1) as smart_crowd_diff,
        smart_wallet_count,
        dumb_wallet_count,
        round(total_open_interest_usd, 0) as open_interest
      FROM wio_market_snapshots_v1
      WHERE as_of_ts = toDateTime('${asOfTs}')
        AND smart_wallet_count >= 3
        AND dumb_wallet_count >= 3
      ORDER BY abs(smart_vs_crowd_delta) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const marketSamples = await marketResult.json() as any[];

  console.log('\nTop 10 markets by smart vs crowd divergence:');
  console.log('Market                            | Crowd | Smart | Dumb  | S-C Diff | Smart# | Dumb#');
  console.log('----------------------------------|-------|-------|-------|----------|--------|------');
  for (const s of marketSamples) {
    const market = s.market_id.slice(0, 32);
    console.log(`${market}... | ${String(s.crowd_pct).padStart(4)}% | ${String(s.smart_pct).padStart(4)}% | ${String(s.dumb_pct).padStart(4)}% | ${String(s.smart_crowd_diff).padStart(7)}% | ${String(s.smart_wallet_count).padStart(6)} | ${String(s.dumb_wallet_count).padStart(5)}`);
  }
}

async function main() {
  console.log('============================================================');
  console.log('WIO Snapshots Population');
  console.log('============================================================\n');

  const now = new Date();
  now.setMinutes(0, 0, 0);
  console.log(`Snapshot timestamp: ${now.toISOString()}\n`);

  console.log('Step 1: Populating snapshots...');
  const openCount = await populateOpenSnapshots();
  const marketCount = await populateMarketSnapshots();

  console.log('\nStep 2: Summary');
  console.log(`  Open position snapshots: ${openCount.toLocaleString()}`);
  console.log(`  Market snapshots: ${marketCount.toLocaleString()}`);

  await validateSnapshots();

  console.log('\n============================================================');
  console.log('SNAPSHOT POPULATION COMPLETE');
  console.log('============================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
