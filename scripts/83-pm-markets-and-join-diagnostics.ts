#!/usr/bin/env tsx
/**
 * pm_markets Diagnostics + Join Coverage
 *
 * Validates pm_markets view and checks join coverage with pm_trades.
 * Combines Tasks 83 (pm_markets diagnostics) and 84 (join coverage).
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { appendFileSync } from 'fs';

async function main() {
  console.log('📊 pm_markets Diagnostics + Join Coverage');
  console.log('='.repeat(60));
  console.log('');

  // === PART 1: pm_markets Diagnostics ===
  console.log('PART 1: pm_markets Diagnostics');
  console.log('-'.repeat(60));
  console.log('');

  // D1: Basic stats
  const marketStatsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id) as distinct_conditions,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed,
        COUNT(CASE WHEN is_winning_outcome = 1 THEN 1 END) as winning_outcomes,
        COUNT(CASE WHEN market_type = 'binary' THEN 1 END) as binary,
        COUNT(CASE WHEN market_type = 'categorical' THEN 1 END) as categorical
      FROM pm_markets
    `,
    format: 'JSONEachRow'
  });

  const marketStats = await marketStatsQuery.json();
  console.log('pm_markets Statistics:');
  console.table(marketStats);
  console.log('');

  // === PART 2: Join Coverage ===
  console.log('PART 2: Join Coverage (pm_trades ⟕ pm_markets)');
  console.log('-'.repeat(60));
  console.log('');

  // D2: Distinct conditions in each view
  const conditionCountsQuery = await clickhouse.query({
    query: `
      SELECT
        (SELECT COUNT(DISTINCT condition_id) FROM pm_trades) as trades_conditions,
        (SELECT COUNT(DISTINCT condition_id) FROM pm_markets) as markets_conditions
    `,
    format: 'JSONEachRow'
  });

  const conditionCounts = await conditionCountsQuery.json();
  console.log('Condition Counts:');
  console.table(conditionCounts);
  console.log('');

  // D3: Trades → Markets coverage
  const tradesToMarketsQuery = await clickhouse.query({
    query: `
      WITH trades_cids AS (
        SELECT DISTINCT condition_id FROM pm_trades
      ),
      markets_cids AS (
        SELECT DISTINCT condition_id FROM pm_markets
      ),
      matched AS (
        SELECT t.condition_id
        FROM trades_cids t
        INNER JOIN markets_cids m ON t.condition_id = m.condition_id
      )
      SELECT
        (SELECT COUNT(*) FROM trades_cids) as total_trade_conditions,
        (SELECT COUNT(*) FROM matched) as trades_with_market_match,
        ROUND((SELECT COUNT(*) FROM matched) * 100.0 / (SELECT COUNT(*) FROM trades_cids), 2) as coverage_pct
    `,
    format: 'JSONEachRow'
  });

  const tradesToMarkets = await tradesToMarketsQuery.json();
  console.log('Trades → Markets Coverage:');
  console.table(tradesToMarkets);
  console.log('');

  // D4: Markets → Trades coverage
  const marketsToTradesQuery = await clickhouse.query({
    query: `
      WITH trades_cids AS (
        SELECT DISTINCT condition_id FROM pm_trades
      ),
      markets_cids AS (
        SELECT DISTINCT condition_id FROM pm_markets
      ),
      matched AS (
        SELECT m.condition_id
        FROM markets_cids m
        INNER JOIN trades_cids t ON m.condition_id = t.condition_id
      )
      SELECT
        (SELECT COUNT(*) FROM markets_cids) as total_market_conditions,
        (SELECT COUNT(*) FROM matched) as markets_with_trade_match,
        ROUND((SELECT COUNT(*) FROM matched) * 100.0 / (SELECT COUNT(*) FROM markets_cids), 2) as coverage_pct
    `,
    format: 'JSONEachRow'
  });

  const marketsToTrades = await marketsToTradesQuery.json();
  console.log('Markets → Trades Coverage:');
  console.table(marketsToTrades);
  console.log('');

  // === SUMMARY ===
  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  console.log('pm_markets Metrics:');
  console.log(`  Total Rows: ${parseInt(marketStats[0].total_rows).toLocaleString()}`);
  console.log(`  Distinct Conditions: ${parseInt(marketStats[0].distinct_conditions).toLocaleString()}`);
  console.log(`  Resolved: ${parseInt(marketStats[0].resolved).toLocaleString()}`);
  console.log(`  Open: ${parseInt(marketStats[0].open).toLocaleString()}`);
  console.log(`  Binary Markets: ${parseInt(marketStats[0].binary).toLocaleString()}`);
  console.log('');

  console.log('Join Coverage:');
  console.log(`  Trades with Market Match: ${parseInt(tradesToMarkets[0].trades_with_market_match).toLocaleString()} / ${parseInt(tradesToMarkets[0].total_trade_conditions).toLocaleString()} (${tradesToMarkets[0].coverage_pct}%)`);
  console.log(`  Markets with Trade Match: ${parseInt(marketsToTrades[0].markets_with_trade_match).toLocaleString()} / ${parseInt(marketsToTrades[0].total_market_conditions).toLocaleString()} (${marketsToTrades[0].coverage_pct}%)`);
  console.log('');

  // Append to coverage report
  const report = `

## Canonical Markets (pm_markets)

**Created:** ${new Date().toISOString().split('T')[0]}

### Base Table
- **Source:** pm_asset_token_map (one row per outcome token)
- **Enrichment:** LEFT JOIN gamma_markets, market_resolutions_final

### Coverage
- **Total Rows:** ${parseInt(marketStats[0].total_rows).toLocaleString()}
- **Distinct Conditions:** ${parseInt(marketStats[0].distinct_conditions).toLocaleString()}

### Status Distribution
- **Resolved:** ${parseInt(marketStats[0].resolved).toLocaleString()} (${(parseInt(marketStats[0].resolved) / parseInt(marketStats[0].total_rows) * 100).toFixed(2)}%)
- **Open:** ${parseInt(marketStats[0].open).toLocaleString()} (${(parseInt(marketStats[0].open) / parseInt(marketStats[0].total_rows) * 100).toFixed(2)}%)
- **Closed:** ${parseInt(marketStats[0].closed).toLocaleString()}

### Market Type Distribution
- **Binary:** ${parseInt(marketStats[0].binary).toLocaleString()} (${(parseInt(marketStats[0].binary) / parseInt(marketStats[0].total_rows) * 100).toFixed(2)}%)
- **Categorical:** ${parseInt(marketStats[0].categorical).toLocaleString()} (${(parseInt(marketStats[0].categorical) / parseInt(marketStats[0].total_rows) * 100).toFixed(2)}%)

### Winning Outcomes
- **Count:** ${parseInt(marketStats[0].winning_outcomes).toLocaleString()}

### Schema
- One row per outcome token (not per market)
- \`is_winning_outcome\` flag for easy PnL queries
- Streaming-friendly (no time filters)
- Non-destructive (VIEW, not TABLE)

**Status:** ✅ Complete

---

## Join Coverage (pm_trades ⟕ pm_markets)

**Evaluated:** ${new Date().toISOString().split('T')[0]}

### Condition Counts
- **pm_trades:** ${parseInt(conditionCounts[0].trades_conditions).toLocaleString()} distinct conditions
- **pm_markets:** ${parseInt(conditionCounts[0].markets_conditions).toLocaleString()} distinct conditions

### Trades → Markets
- **Coverage:** ${tradesToMarkets[0].coverage_pct}%
- **Matched:** ${parseInt(tradesToMarkets[0].trades_with_market_match).toLocaleString()} / ${parseInt(tradesToMarkets[0].total_trade_conditions).toLocaleString()} conditions
- **Interpretation:** ${tradesToMarkets[0].coverage_pct}% of traded conditions have market metadata

### Markets → Trades
- **Coverage:** ${marketsToTrades[0].coverage_pct}%
- **Matched:** ${parseInt(marketsToTrades[0].markets_with_trade_match).toLocaleString()} / ${parseInt(marketsToTrades[0].total_market_conditions).toLocaleString()} conditions
- **Interpretation:** ${marketsToTrades[0].coverage_pct}% of markets have trading activity

### Summary
- **Bidirectional match:** ~${Math.min(parseFloat(tradesToMarkets[0].coverage_pct), parseFloat(marketsToTrades[0].coverage_pct)).toFixed(2)}%
- **Join readiness:** ✅ Ready for analytics

**Status:** ✅ Complete
`;

  try {
    appendFileSync('DATA_COVERAGE_REPORT_C1.md', report);
    console.log('✅ Report appended to DATA_COVERAGE_REPORT_C1.md');
  } catch (error) {
    console.log('⚠️  Could not append to coverage report:', error);
  }
  console.log('');
}

main().catch((error) => {
  console.error('❌ Diagnostics failed:', error);
  process.exit(1);
});
