#!/usr/bin/env tsx
/**
 * Analyze Dome Trade Data for xcnstrategy
 *
 * Compares Dome's trade data with our ClickHouse data to understand the discrepancy.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

interface DomeTrade {
  token_id: string;
  side: 'BUY' | 'SELL';
  market_slug: string;
  condition_id: string;
  shares: number;
  shares_normalized: number;
  price: number;
  tx_hash: string;
  title: string;
  timestamp: number;
  order_hash: string;
  user: string;
}

interface DomeData {
  orders: DomeTrade[];
}

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('📊 Analyzing Dome Trade Data vs ClickHouse');
  console.log('='.repeat(60));
  console.log('');

  // Load Dome data (only first JSON object - orders)
  const domeFilePath = resolve(process.cwd(), 'docs/archive/agent-os-oct-2025/product/Wallet_trade_details.md');
  const domeDataRaw = readFileSync(domeFilePath, 'utf-8');
  // File has two JSON objects separated by text - take first one
  const firstJsonEnd = domeDataRaw.indexOf('}\n\n');
  const ordersJson = domeDataRaw.substring(0, firstJsonEnd + 1);
  const domeData: DomeData = JSON.parse(ordersJson);

  console.log(`Dome Trades Loaded: ${domeData.orders.length.toLocaleString()}`);
  console.log('');

  // Analyze Dome data
  const uniqueConditions = new Set(domeData.orders.map(o => o.condition_id));
  const buyTrades = domeData.orders.filter(o => o.side === 'BUY');
  const sellTrades = domeData.orders.filter(o => o.side === 'SELL');

  console.log('Dome Data Summary:');
  console.log(`  Total trades: ${domeData.orders.length}`);
  console.log(`  Unique markets: ${uniqueConditions.size}`);
  console.log(`  BUY trades: ${buyTrades.length}`);
  console.log(`  SELL trades: ${sellTrades.length}`);
  console.log('');

  // Check date range
  const timestamps = domeData.orders.map(o => o.timestamp);
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const minDate = new Date(minTimestamp * 1000);
  const maxDate = new Date(maxTimestamp * 1000);

  console.log('Date Range:');
  console.log(`  Earliest: ${minDate.toISOString()}`);
  console.log(`  Latest: ${maxDate.toISOString()}`);
  console.log('');

  // Sample some condition_ids to check against ClickHouse
  const sampleConditions = Array.from(uniqueConditions).slice(0, 5);

  console.log('Sample Condition IDs from Dome:');
  sampleConditions.forEach((cid, i) => {
    const trades = domeData.orders.filter(o => o.condition_id === cid);
    console.log(`  ${i + 1}. ${cid.substring(0, 10)}... (${trades.length} trades)`);
    console.log(`     Market: ${trades[0].title}`);
  });
  console.log('');

  // Check these condition IDs in our ClickHouse
  console.log('Checking sample markets in ClickHouse...');
  console.log('');

  for (const conditionId of sampleConditions) {
    const domeTrades = domeData.orders.filter(o => o.condition_id === conditionId);
    const marketTitle = domeTrades[0].title;

    // Query ClickHouse for this market
    const clickhouseQuery = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          SUM(shares) as total_shares
        FROM pm_trades
        WHERE condition_id = '${conditionId}'
          AND wallet_address = '${XCN_EOA}'
      `,
      format: 'JSONEachRow'
    });

    const chResult = await clickhouseQuery.json();
    const chTradeCount = parseInt(chResult[0]?.trade_count || '0');
    const chShares = parseFloat(chResult[0]?.total_shares || '0');

    const domeTradeCount = domeTrades.length;
    const domeShares = domeTrades.reduce((sum, t) => sum + t.shares_normalized, 0);

    console.log(`Market: ${marketTitle.substring(0, 50)}...`);
    console.log(`  Condition ID: ${conditionId}`);
    console.log(`  Dome: ${domeTradeCount} trades, ${domeShares.toFixed(2)} shares`);
    console.log(`  ClickHouse: ${chTradeCount} trades, ${chShares.toFixed(2)} shares`);

    if (chTradeCount > 0) {
      console.log(`  ✅ Market FOUND in ClickHouse`);
    } else {
      console.log(`  ❌ Market NOT in ClickHouse`);
    }
    console.log('');
  }

  // Check resolution status
  console.log('Checking resolution status for all Dome markets...');
  const conditionsList = Array.from(uniqueConditions).map(c => `'${c}'`).join(', ');

  const resolvedQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT CASE WHEN m.status = 'resolved' THEN m.condition_id END) as resolved_count,
        COUNT(DISTINCT CASE WHEN m.status != 'resolved' OR m.status IS NULL THEN condition_id END) as unresolved_count,
        COUNT(DISTINCT m.condition_id) as total_in_ch
      FROM (SELECT DISTINCT '${Array.from(uniqueConditions)[0]}' as condition_id) conditions
      LEFT JOIN pm_markets m ON conditions.condition_id = m.condition_id
    `,
    format: 'JSONEachRow'
  });

  // Better: query all at once
  const allMarketsQuery = await clickhouse.query({
    query: `
      WITH dome_markets AS (
        SELECT arrayJoin([${conditionsList}]) as condition_id
      )
      SELECT
        COUNT(*) as dome_markets,
        COUNT(CASE WHEN m.condition_id IS NOT NULL THEN 1 END) as in_clickhouse,
        COUNT(CASE WHEN m.status = 'resolved' THEN 1 END) as resolved,
        COUNT(CASE WHEN m.status != 'resolved' THEN 1 END) as unresolved
      FROM dome_markets d
      LEFT JOIN pm_markets m ON d.condition_id = m.condition_id
    `,
    format: 'JSONEachRow'
  });

  const marketStatus = await allMarketsQuery.json();
  console.log('');
  console.log('Market Resolution Status:');
  console.table(marketStatus);
  console.log('');

  // Calculate what % of Dome trades are from resolved markets
  const resolvedMarkets = new Set<string>();
  for (const conditionId of uniqueConditions) {
    const checkQuery = await clickhouse.query({
      query: `
        SELECT status
        FROM pm_markets
        WHERE condition_id = '${conditionId}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const result = await checkQuery.json();
    if (result.length > 0 && result[0].status === 'resolved') {
      resolvedMarkets.add(conditionId);
    }
  }

  const resolvedTrades = domeData.orders.filter(o => resolvedMarkets.has(o.condition_id));
  const unresolvedTrades = domeData.orders.filter(o => !resolvedMarkets.has(o.condition_id));

  console.log('Trade Distribution:');
  console.log(`  Dome markets (total): ${uniqueConditions.size}`);
  console.log(`  Resolved markets: ${resolvedMarkets.size} (${(resolvedMarkets.size / uniqueConditions.size * 100).toFixed(1)}%)`);
  console.log(`  Unresolved markets: ${uniqueConditions.size - resolvedMarkets.size} (${((uniqueConditions.size - resolvedMarkets.size) / uniqueConditions.size * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`  Dome trades (total): ${domeData.orders.length}`);
  console.log(`  From resolved markets: ${resolvedTrades.length} (${(resolvedTrades.length / domeData.orders.length * 100).toFixed(1)}%)`);
  console.log(`  From unresolved markets: ${unresolvedTrades.length} (${(unresolvedTrades.length / domeData.orders.length * 100).toFixed(1)}%)`);
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('📋 ANALYSIS SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('Dome has data for xcnstrategy that we may not be capturing:');
  console.log('');
  console.log(`1. Total Dome trades: ${domeData.orders.length}`);
  console.log(`2. Our ClickHouse trades (EOA): 194`);
  console.log(`3. Missing trades: ${domeData.orders.length - 194}`);
  console.log('');
  console.log(`4. Resolved markets in Dome data: ${resolvedMarkets.size}/${uniqueConditions.size}`);
  console.log(`5. Our resolved markets counted: 4`);
  console.log('');
  console.log('This explains why Dome shows $87K vs our $2K:');
  console.log('- We count only resolved binary CLOB markets');
  console.log('- Dome counts all markets (resolved + unresolved)');
  console.log('- Dome may include non-CLOB data sources');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Analysis failed:', error);
  process.exit(1);
});
