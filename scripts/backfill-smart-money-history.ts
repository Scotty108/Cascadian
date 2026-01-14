#!/usr/bin/env npx tsx
/**
 * Backfill Smart Money History
 *
 * Creates historical smart money signals by combining:
 * - Historical prices from pm_price_snapshots_15m
 * - Current position data from wio_positions_v2
 *
 * This gives us approximate historical smart money signals for charting.
 * The smart money odds are based on current positions, but the crowd_odds
 * follows historical prices.
 */

import { clickhouse } from '../lib/clickhouse/client';

async function backfillSmartMoneyHistory() {
  console.log('Starting smart money history backfill...');

  // First, check what markets have smart money presence currently
  const marketsResult = await clickhouse.query({
    query: `
      SELECT
        market_id,
        smart_money_odds,
        smart_wallet_count,
        smart_holdings_usd,
        dumb_money_odds
      FROM wio_market_snapshots_v1
      WHERE as_of_ts = (SELECT max(as_of_ts) FROM wio_market_snapshots_v1)
        AND smart_wallet_count >= 3
      ORDER BY smart_holdings_usd DESC
      LIMIT 10000
    `,
    format: 'JSONEachRow',
  });
  const markets = await marketsResult.json() as any[];

  console.log(`Found ${markets.length} markets with smart money presence`);

  // Get the token_id to condition_id mapping
  const tokenMapResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        arrayElement(token_ids, 1) as yes_token_id
      FROM pm_market_metadata
      WHERE length(token_ids) > 0
    `,
    format: 'JSONEachRow',
  });
  const tokenMapRows = await tokenMapResult.json() as any[];
  const conditionToToken = new Map<string, string>();
  const tokenToCondition = new Map<string, string>();

  for (const row of tokenMapRows) {
    if (row.yes_token_id) {
      conditionToToken.set(row.condition_id.toLowerCase(), row.yes_token_id);
      tokenToCondition.set(row.yes_token_id, row.condition_id.toLowerCase());
    }
  }
  console.log(`Loaded ${conditionToToken.size} token mappings`);

  // Generate hourly timestamps for the last 60 days
  const now = new Date();
  now.setMinutes(0, 0, 0);

  const timestamps: Date[] = [];
  for (let i = 0; i < 60 * 24; i++) { // 60 days * 24 hours
    const ts = new Date(now.getTime() - i * 60 * 60 * 1000);
    timestamps.push(ts);
  }
  console.log(`Will generate ${timestamps.length} hourly data points`);

  // Process in batches of markets
  const BATCH_SIZE = 500;
  let totalInserted = 0;

  for (let batchStart = 0; batchStart < markets.length; batchStart += BATCH_SIZE) {
    const batch = markets.slice(batchStart, batchStart + BATCH_SIZE);
    const marketIds = batch.map(m => m.market_id);
    const tokenIds = marketIds.map(id => conditionToToken.get(id)).filter(Boolean);

    if (tokenIds.length === 0) continue;

    // Get historical prices for these tokens
    const pricesResult = await clickhouse.query({
      query: `
        SELECT
          token_id,
          toStartOfHour(bucket) as hour_bucket,
          avg(last_price) as avg_price
        FROM pm_price_snapshots_15m
        WHERE token_id IN (${tokenIds.map(t => `'${t}'`).join(',')})
          AND bucket >= now() - INTERVAL 60 DAY
        GROUP BY token_id, hour_bucket
        ORDER BY token_id, hour_bucket
      `,
      format: 'JSONEachRow',
    });
    const prices = await pricesResult.json() as any[];

    // Build price lookup: token_id -> hour -> price
    const priceLookup = new Map<string, Map<string, number>>();
    for (const p of prices) {
      if (!priceLookup.has(p.token_id)) {
        priceLookup.set(p.token_id, new Map());
      }
      priceLookup.get(p.token_id)!.set(p.hour_bucket, p.avg_price);
    }

    // Generate history rows
    const rows: string[] = [];

    for (const market of batch) {
      const tokenId = conditionToToken.get(market.market_id);
      if (!tokenId) continue;

      const tokenPrices = priceLookup.get(tokenId);
      if (!tokenPrices || tokenPrices.size === 0) continue;

      // Get available hours for this market
      const availableHours = Array.from(tokenPrices.keys()).sort();
      if (availableHours.length === 0) continue;

      for (const hourStr of availableHours) {
        const crowdOdds = tokenPrices.get(hourStr) || 0.5;

        // Use current smart money odds (constant, but shows the relationship)
        const smartOdds = market.smart_money_odds;
        const dumbOdds = market.dumb_money_odds;
        const smartCount = market.smart_wallet_count;
        const smartUsd = market.smart_holdings_usd;
        const delta = smartOdds - crowdOdds;

        // Format timestamp for ClickHouse
        const ts = hourStr.replace('T', ' ').slice(0, 19);

        rows.push(
          `('${market.market_id}', '${ts}', ${crowdOdds}, ${smartOdds}, ${dumbOdds}, ${delta}, ${smartCount}, ${smartUsd}, 0)`
        );
      }
    }

    if (rows.length > 0) {
      // Insert in chunks to avoid query size limits
      const CHUNK_SIZE = 10000;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        await clickhouse.command({
          query: `
            INSERT INTO wio_smart_money_history
            (market_id, ts, crowd_odds, smart_money_odds, dumb_money_odds, smart_vs_crowd_delta, smart_wallet_count, smart_holdings_usd, total_open_interest_usd)
            VALUES ${chunk.join(',')}
          `,
        });
        totalInserted += chunk.length;
      }
    }

    console.log(`Batch ${batchStart / BATCH_SIZE + 1}: processed ${batch.length} markets, inserted ${rows.length} rows (total: ${totalInserted})`);
  }

  console.log(`\nBackfill complete! Inserted ${totalInserted} total rows`);

  // Verify
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countDistinct(market_id) as unique_markets,
        min(ts) as oldest,
        max(ts) as newest
      FROM wio_smart_money_history
    `,
    format: 'JSONEachRow',
  });
  const stats = (await verifyResult.json() as any[])[0];
  console.log('\nFinal stats:', stats);
}

backfillSmartMoneyHistory().catch(console.error);
