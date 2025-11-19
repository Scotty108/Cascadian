#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function main() {
  console.log('=== P&L MISMATCH DIAGNOSTIC ===\n');

  // 1. OVERALL RESOLUTION COVERAGE
  console.log('1. RESOLUTION COVERAGE ANALYSIS');
  console.log('─'.repeat(80));

  const coverageQuery = `
    WITH
      total_conditions AS (
        SELECT COUNT(DISTINCT condition_id_norm) as cnt
        FROM vw_trades_canonical
        WHERE condition_id_norm != ''
      ),
      resolved_conditions AS (
        SELECT COUNT(DISTINCT condition_id_norm) as cnt
        FROM market_resolutions_final
        WHERE condition_id_norm != ''
      ),
      conditions_in_both AS (
        SELECT COUNT(DISTINCT t.condition_id_norm) as cnt
        FROM vw_trades_canonical t
        INNER JOIN market_resolutions_final r ON t.condition_id_norm = r.condition_id_norm
        WHERE t.condition_id_norm != ''
      )
    SELECT
      (SELECT cnt FROM total_conditions) as total_traded_conditions,
      (SELECT cnt FROM resolved_conditions) as total_resolutions,
      (SELECT cnt FROM conditions_in_both) as matched_conditions,
      round((SELECT cnt FROM conditions_in_both) / (SELECT cnt FROM total_conditions) * 100, 2) as coverage_pct
  `;

  const coverageResult = await client.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverage = await coverageResult.json();
  console.log('Coverage Summary:');
  console.log(JSON.stringify(coverage[0], null, 2));
  console.log();

  // 2. ANALYZE PROBLEM WALLET: 0x4ce73141dbfce41e65db3723e31059a730f0abad
  const problemWallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
  console.log(`\n2. DETAILED ANALYSIS: ${problemWallet}`);
  console.log('─'.repeat(80));
  console.log('Polymarket shows: $332K');
  console.log('Our calculation: -$677');
  console.log();

  // Get their positions
  const positionsQuery = `
    SELECT
      condition_id_norm,
      outcome_index,
      SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE -shares END) as net_shares,
      SUM(CASE WHEN trade_direction = 'BUY' THEN -usd_value ELSE usd_value END) as net_cost,
      COUNT(*) as trade_count,
      MIN(timestamp) as first_trade,
      MAX(timestamp) as last_trade
    FROM vw_trades_canonical
    WHERE lower(wallet_address_norm) = lower('${problemWallet}')
      AND condition_id_norm != ''
    GROUP BY condition_id_norm, outcome_index
    HAVING ABS(net_shares) > 0.01
    ORDER BY ABS(net_cost) DESC
    LIMIT 20
  `;

  const positionsResult = await client.query({ query: positionsQuery, format: 'JSONEachRow' });
  const positions = await positionsResult.json();

  console.log(`\nOpen Positions (${positions.length} positions):`);
  console.log();

  // 3. FOR EACH POSITION, CHECK DATA AVAILABILITY
  let totalMissingResolutions = 0;
  let totalMissingPrices = 0;
  let totalHasBoth = 0;
  let positionsAnalyzed = 0;

  for (const pos of positions.slice(0, 10)) { // Analyze top 10
    positionsAnalyzed++;
    console.log(`\nPosition ${positionsAnalyzed}:`);
    console.log(`  Condition ID: ${pos.condition_id_norm}`);
    console.log(`  Outcome: ${pos.outcome_index}`);
    console.log(`  Net Shares: ${Number(pos.net_shares).toFixed(2)}`);
    console.log(`  Net Cost: $${Number(pos.net_cost).toFixed(2)}`);
    console.log(`  Trades: ${pos.trade_count}`);

    // Check resolution
    const resolutionQuery = `
      SELECT
        winning_index,
        resolved_at,
        payout_numerators,
        payout_denominator
      FROM market_resolutions_final
      WHERE condition_id_norm = '${pos.condition_id_norm}'
      LIMIT 1
    `;
    const resResult = await client.query({ query: resolutionQuery, format: 'JSONEachRow' });
    const resolutions = await resResult.json();
    const hasResolution = resolutions.length > 0;

    // Check midprice (in cascadian_clean database)
    // Note: midprices uses market_cid (same as condition_id_norm) and outcome (1-indexed)
    const midpriceQuery = `
      SELECT
        midprice,
        updated_at
      FROM cascadian_clean.midprices_latest
      WHERE market_cid = concat('0x', '${pos.condition_id_norm}')
        AND outcome = ${Number(pos.outcome_index) + 1}
      LIMIT 1
    `;
    const midResult = await client.query({ query: midpriceQuery, format: 'JSONEachRow' });
    const midprices = await midResult.json();
    const hasMidprice = midprices.length > 0;

    // Check last trade price as fallback
    const lastPriceQuery = `
      SELECT entry_price
      FROM vw_trades_canonical
      WHERE condition_id_norm = '${pos.condition_id_norm}'
        AND outcome_index = ${pos.outcome_index}
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    const lastPriceResult = await client.query({ query: lastPriceQuery, format: 'JSONEachRow' });
    const lastPrices = await lastPriceResult.json();
    const lastTradePrice = lastPrices.length > 0 ? lastPrices[0].entry_price : null;

    console.log(`  Resolution: ${hasResolution ? '✓ YES' : '✗ MISSING'}`);
    if (hasResolution) {
      console.log(`    Winner: ${resolutions[0].winning_index}`);
      console.log(`    Resolved: ${resolutions[0].resolved_at}`);
    }

    console.log(`  Midprice: ${hasMidprice ? '✓ YES' : '✗ MISSING'}`);
    if (hasMidprice) {
      console.log(`    Price: $${Number(midprices[0].midprice).toFixed(4)}`);
      console.log(`    Updated: ${midprices[0].updated_at}`);
    }

    console.log(`  Last Trade Price: ${lastTradePrice ? '$' + Number(lastTradePrice).toFixed(4) : '✗ NONE'}`);

    // Calculate what P&L would be with different data
    const netShares = Number(pos.net_shares);
    const netCost = Number(pos.net_cost);

    if (hasResolution) {
      const winnerIndex = Number(resolutions[0].winning_index);
      const isWinner = winnerIndex === Number(pos.outcome_index);
      const pnl = isWinner ? netShares - netCost : -netCost;
      console.log(`  → P&L (resolved): $${pnl.toFixed(2)} ${isWinner ? '(WINNER)' : '(LOSER)'}`);
    } else if (hasMidprice) {
      const price = Number(midprices[0].midprice);
      const pnl = (netShares * price) - netCost;
      console.log(`  → P&L (midprice): $${pnl.toFixed(2)}`);
    } else if (lastTradePrice) {
      const price = Number(lastTradePrice);
      const pnl = (netShares * price) - netCost;
      console.log(`  → P&L (last trade): $${pnl.toFixed(2)}`);
    } else {
      console.log(`  → P&L: CANNOT CALCULATE (no data)`);
      console.log(`  → Would show: -$${netCost.toFixed(2)} (pure cost basis loss)`);
    }

    // Track stats
    if (!hasResolution) totalMissingResolutions++;
    if (!hasMidprice) totalMissingPrices++;
    if (hasResolution && hasMidprice) totalHasBoth++;
  }

  console.log('\n\n4. DATA AVAILABILITY SUMMARY');
  console.log('─'.repeat(80));
  console.log(`Positions analyzed: ${positionsAnalyzed}`);
  console.log(`Missing resolutions: ${totalMissingResolutions} (${(totalMissingResolutions/positionsAnalyzed*100).toFixed(1)}%)`);
  console.log(`Missing midprices: ${totalMissingPrices} (${(totalMissingPrices/positionsAnalyzed*100).toFixed(1)}%)`);
  console.log(`Have both resolution + midprice: ${totalHasBoth} (${(totalHasBoth/positionsAnalyzed*100).toFixed(1)}%)`);

  // 5. CHECK FOR OTHER RESOLUTION TABLES
  console.log('\n\n5. SEARCH FOR OTHER RESOLUTION DATA SOURCES');
  console.log('─'.repeat(80));

  const tablesQuery = `
    SELECT name, total_rows
    FROM system.tables
    WHERE database = 'polymarket'
      AND (name LIKE '%resolution%' OR name LIKE '%outcome%' OR name LIKE '%payout%')
    ORDER BY total_rows DESC
  `;
  const tablesResult = await client.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tables = await tablesResult.json();

  console.log('Found tables:');
  for (const table of tables) {
    console.log(`  ${table.name}: ${Number(table.total_rows).toLocaleString()} rows`);
  }

  // 6. SMOKING GUN DIAGNOSIS
  console.log('\n\n6. SMOKING GUN DIAGNOSIS');
  console.log('─'.repeat(80));

  const coveragePct = coverage[0]?.coverage_pct || 0;
  const missingPct = (totalMissingResolutions/positionsAnalyzed*100).toFixed(1);
  const missingPricePct = (totalMissingPrices/positionsAnalyzed*100).toFixed(1);

  console.log(`
For wallet ${problemWallet}:
  Polymarket shows: $332,000
  Our calculation: -$677
  Difference: $332,677

ROOT CAUSE:
  - ${totalMissingResolutions}/${positionsAnalyzed} positions lack resolution data (${missingPct}%)
  - ${totalMissingPrices}/${positionsAnalyzed} positions lack current midprices (${missingPricePct}%)
  - When a position has NO resolution and NO midprice, we show -$cost_basis (full loss)
  - Polymarket has resolution/price data we're missing

SPECIFIC GAPS:
  1. Old resolved markets: We have trades but no resolution outcome
  2. Active markets: We have trades but no current midprice
  3. Resolution data is incomplete: ${coveragePct}% coverage

WHAT POLYMARKET HAS THAT WE DON'T:
  - Complete resolution history (they resolved the markets we're missing)
  - Real-time market prices (orderbook midpoint)
  - These allow them to value positions correctly

FIX REQUIRED:
  1. Backfill missing resolutions from Polymarket API or blockchain
  2. Add fallback to last_trade_price when midprice unavailable
  3. Mark positions as "data unavailable" rather than showing as losses
  `);

  // 7. SHOW EXACT QUERIES TO FIX
  console.log('\n7. QUERIES TO FIX THE ISSUE');
  console.log('─'.repeat(80));
  console.log(`
-- Find all condition_ids we have trades for but no resolution:
SELECT DISTINCT t.condition_id
FROM vw_trades_canonical t
LEFT JOIN market_resolutions_final r ON lower(t.condition_id) = lower(r.condition_id)
WHERE r.condition_id IS NULL
  AND t.condition_id != '' AND t.condition_id != '0x'
LIMIT 100;

-- Find all active positions missing midprices:
WITH positions AS (
  SELECT
    condition_id,
    outcome_index,
    SUM(CASE WHEN direction = 'BUY' THEN shares ELSE -shares END) as net_shares
  FROM vw_trades_canonical
  WHERE lower(wallet_address) = lower('${problemWallet}')
  GROUP BY condition_id, outcome_index
  HAVING ABS(net_shares) > 0.01
)
SELECT p.*, m.price
FROM positions p
LEFT JOIN midprices_latest m ON lower(p.condition_id) = lower(m.condition_id)
  AND p.outcome_index = m.outcome_index
WHERE m.price IS NULL;

-- Alternative: Use last trade price as fallback
SELECT
  condition_id,
  outcome_index,
  price as last_trade_price
FROM vw_trades_canonical
WHERE lower(condition_id) = lower('<cid>')
  AND outcome_index = <idx>
ORDER BY block_timestamp DESC
LIMIT 1;
  `);

  await client.close();
}

main().catch(console.error);
