/**
 * 60: XCNSTRATEGY CLICKHOUSE COUNTS
 *
 * Mission: Get raw ClickHouse counts for wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 * to assess data completeness and coverage.
 *
 * Will NOT attempt P&L or position interpretation.
 * Only factual counts and date ranges.
 */

import { clickhouse } from './lib/clickhouse/client.js';

interface ClickHouseCounts {
  total_fills: number;
  distinct_assets: number;
  distinct_conditions: number;
  distinct_events: number;
  first_trade_ts: string;
  last_trade_ts: string;
}

async function getClickHouseCounts() {
  const targetWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('60: XCNSTRATEGY CLICKHOUSE COUNTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Mission: Get raw counts and time ranges for wallet ${targetWallet}`);
  console.log('Scope: clob_fills + ctf_token_map + gamma_markets\n');

  try {
    // Query 1: Basic counts from clob_fills
    console.log('📋 QUERY 1: Basic clob_fills counts');

    const basicQuery = `
      SELECT
        COUNT(*) as total_fills,
        COUNT(DISTINCT asset_id) as distinct_assets,
        MIN(timestamp) as first_trade_ts,
        MAX(timestamp) as last_trade_ts
      FROM clob_fills
      WHERE proxy_wallet = '${targetWallet}'
    `;

    const basicResult = await clickhouse.query({ query: basicQuery, format: 'JSONEachRow' });
    const basicCounts = await basicResult.json();
    const basic = basicCounts[0];

    console.log('Basic clob_fills counts:');
    console.log(`  Total fills: ${basic.total_fills}`);
    console.log(`  Distinct assets: ${basic.distinct_assets}`);
    console.log(`  First trade: ${basic.first_trade_ts}`);
    console.log(`  Last trade: ${basic.last_trade_ts}`);

    // Query 2: Distinct conditions via ctf_token_map
    console.log('\n📋 QUERY 2: Distinct conditions via ctf_token_map');

    const conditionsQuery = `
      SELECT
        COUNT(DISTINCT ctm.condition_id_norm) as distinct_conditions
      FROM clob_fills cf
      JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE cf.proxy_wallet = '${targetWallet}'
    `;

    const conditionsResult = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' });
    const conditions = await conditionsResult.json();

    console.log('Conditions via ctf_token_map:');
    console.log(`  Distinct conditions: ${conditions[0].distinct_conditions}`);

    // Query 3: Distinct events via gamma_markets bridge
    console.log('\n📋 QUERY 3: Distinct events via gamma_markets');

    const eventsQuery = `
      SELECT
        COUNT(DISTINCT gm.condition_id) as distinct_markets
      FROM clob_fills cf
      JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      JOIN gamma_markets gm ON ctm.condition_id_norm = gm.condition_id
      WHERE cf.proxy_wallet = '${targetWallet}'
    `;

    const eventsResult = await clickhouse.query({ query: eventsQuery, format: 'JSONEachRow' });
    const events = await eventsResult.json();

    console.log('Markets via gamma_markets:');
    console.log(`  Distinct markets: ${events[0].distinct_markets}`);

    // Query 4: Get some detailed trade samples for timeline verification
    console.log('\n📋 QUERY 4: Trade timeline sample');

    const sampleQuery = `
      SELECT
        toYYYYMM(timestamp) as month,
        COUNT(*) as trades_this_month,
        COUNT(DISTINCT asset_id) as assets_this_month
      FROM clob_fills
      WHERE proxy_wallet = '${targetWallet}'
      GROUP BY toYYYYMM(timestamp)
      ORDER BY month DESC
      LIMIT 10
    `;

    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleResult.json();

    console.log('Most recent 10 months (YYYYMM : trades : assets):');
    for (const row of samples) {
      console.log(`  ${row.month} : ${row.trades_this_month} trades : ${row.assets_this_month} assets`);
    }

    // Query 5: Compare against wallet_identity_map cached numbers
    console.log('\n📋 QUERY 5: wallet_identity_map cached counts');

    const cachedQuery = `
      SELECT
        fills_count,
        markets_traded,
        first_fill_ts,
        last_fill_ts
      FROM wallet_identity_map
      WHERE canonical_wallet = '${targetWallet}'
    `;

    const cachedResult = await clickhouse.query({ query: cachedQuery, format: 'JSONEachRow' });
    const cached = cachedResult.json ? (await cachedResult.json())[0] : null;

    if (cached) {
      console.log('wallet_identity_map cached values:');
      console.log(`  fills_count: ${cached.fills_count}`);
      console.log(`  markets_traded: ${cached.markets_traded}`);
      console.log(`  first_fill_ts: ${cached.first_fill_ts}`);
      console.log(`  last_fill_ts: ${cached.last_fill_ts}`);
    } else {
      console.log('  No cached data found in wallet_identity_map');
    }

    // Final summary
    const counts: ClickHouseCounts = {
      total_fills: parseInt(basic.total_fills),
      distinct_assets: parseInt(basic.distinct_assets),
      distinct_conditions: parseInt(conditions[0].distinct_conditions),
      distinct_events: parseInt(events[0].distinct_events),
      first_trade_ts: basic.first_trade_ts,
      last_trade_ts: basic.last_trade_ts
    };

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('CLICKHOUSE COUNTS SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');

    console.log('\nFinal ClickHouse counts:');
    console.log(`  Total fills: ${counts.total_fills.toLocaleString()}`);
    console.log(`  Distinct assets: ${counts.distinct_assets.toLocaleString()}`);
    console.log(`  Distinct conditions: ${counts.distinct_conditions.toLocaleString()}`);
    console.log(`  Distinct events: ${counts.distinct_events.toLocaleString()}`);
    console.log(`  Date range: ${counts.first_trade_ts} to ${counts.last_trade_ts}`);

    // Compare against cached
    if (cached) {
      console.log('\nComparison with wallet_identity_map:');
      console.log(`  Fills: ClickHouse ${counts.total_fills.toLocaleString()} vs Cached ${parseInt(cached.fills_count).toLocaleString()}`);
      console.log(`  Assets: ClickHouse ${counts.distinct_assets.toLocaleString()} vs Cached ${parseInt(cached.markets_traded).toLocaleString()}`);
      const datesMatch = counts.first_trade_ts === cached.first_fill_ts && counts.last_trade_ts === cached.last_fill_ts;
      console.log(`  Date range match: ${datesMatch ? '✅ YES' : '❌ NO'}`);
    }

    // Return the data for the report
    return {
      clickhouse: counts,
      cached: cached ? {
        total_fills: parseInt(cached.fills_count),
        distinct_assets: parseInt(cached.markets_traded),
        first_trade_ts: cached.first_fill_ts,
        last_trade_ts: cached.last_fill_ts
      } : null
    };

  } catch (error) {
    console.error('❌ Error during ClickHouse counts:', error);
    throw error;
  }
}

getClickHouseCounts()
  .then(data => {
    console.log('\n\n✅ Script 60 complete - ClickHouse counts retrieved');
    console.log('Next: Run script 61 to get API counts for comparison');
  })
  .catch(console.error);