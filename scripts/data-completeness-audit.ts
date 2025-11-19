#!/usr/bin/env npx tsx
/**
 * DATA COMPLETENESS AUDIT
 *
 * Verify we have all data needed for comprehensive wallet analytics:
 * - PnL calculation
 * - Win rate
 * - Omega ratio
 * - ROI per wallet by category/tag
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '='.repeat(100));
  console.log('DATA COMPLETENESS AUDIT FOR WALLET ANALYTICS');
  console.log('='.repeat(100));

  // 1. Check trades data coverage
  console.log('\n[1] TRADES DATA (CLOB Fills)');
  console.log('-'.repeat(100));

  const tradesTimeRange = await ch.query({
    query: `
      SELECT
        MIN(created_at) as earliest_trade,
        MAX(created_at) as latest_trade,
        COUNT(*) as total_trades,
        COUNT(DISTINCT wallet_address) as unique_wallets
      FROM default.trade_direction_assignments
      WHERE created_at IS NOT NULL
    `,
    format: 'JSONEachRow'
  });
  const tradesData = (await tradesTimeRange.json())[0];

  console.log(`  Earliest trade: ${tradesData.earliest_trade}`);
  console.log(`  Latest trade: ${tradesData.latest_trade}`);
  console.log(`  Total trades: ${parseInt(tradesData.total_trades).toLocaleString()}`);
  console.log(`  Unique wallets: ${parseInt(tradesData.unique_wallets).toLocaleString()}`);

  const tradeDays = Math.floor((new Date(tradesData.latest_trade).getTime() - new Date(tradesData.earliest_trade).getTime()) / (1000 * 60 * 60 * 24));
  console.log(`  Date span: ${tradeDays} days`);

  // 2. Check ERC-1155 settlements coverage
  console.log('\n[2] BLOCKCHAIN SETTLEMENTS (ERC-1155)');
  console.log('-'.repeat(100));

  const erc1155TimeRange = await ch.query({
    query: `
      SELECT
        MIN(block_number) as earliest_block,
        MAX(block_number) as latest_block,
        COUNT(*) as total_transfers,
        COUNT(DISTINCT token_id) as unique_condition_ids
      FROM default.erc1155_transfers
    `,
    format: 'JSONEachRow'
  });
  const erc1155Data = (await erc1155TimeRange.json())[0];

  console.log(`  Earliest block: ${parseInt(erc1155Data.earliest_block).toLocaleString()}`);
  console.log(`  Latest block: ${parseInt(erc1155Data.latest_block).toLocaleString()}`);
  console.log(`  Total transfers: ${parseInt(erc1155Data.total_transfers).toLocaleString()}`);
  console.log(`  Unique condition_ids: ${parseInt(erc1155Data.unique_condition_ids).toLocaleString()}`);

  // 3. Check for market resolutions data
  console.log('\n[3] MARKET RESOLUTIONS (CRITICAL FOR PNL)');
  console.log('-'.repeat(100));

  try {
    const resolutionTables = await ch.query({
      query: `
        SELECT
          name,
          engine,
          total_rows
        FROM system.tables
        WHERE database = 'default'
          AND (
            name LIKE '%resolution%'
            OR name LIKE '%payout%'
            OR name LIKE '%outcome%'
          )
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const resTables = await resolutionTables.json();

    if (resTables.length > 0) {
      console.log(`  Found ${resTables.length} resolution-related tables:`);
      for (const table of resTables) {
        console.log(`    - ${table.name}: ${parseInt(table.total_rows).toLocaleString()} rows`);
      }
    } else {
      console.log(`  ⚠️  NO RESOLUTION TABLES FOUND`);
      console.log(`  ❌ CRITICAL GAP: Cannot calculate PnL without resolution data!`);
    }
  } catch (e: any) {
    console.log(`  ⚠️  Error checking resolution tables: ${e.message}`);
  }

  // 4. Check for market metadata (categories, tags)
  console.log('\n[4] MARKET METADATA (Categories & Tags)');
  console.log('-'.repeat(100));

  try {
    const metadataTables = await ch.query({
      query: `
        SELECT
          name,
          engine,
          total_rows
        FROM system.tables
        WHERE database = 'default'
          AND (
            name LIKE '%market%'
            OR name LIKE '%metadata%'
            OR name LIKE '%category%'
            OR name LIKE '%tag%'
          )
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const metaTables = await metadataTables.json();

    if (metaTables.length > 0) {
      console.log(`  Found ${metaTables.length} metadata tables:`);
      for (const table of metaTables) {
        console.log(`    - ${table.name}: ${parseInt(table.total_rows).toLocaleString()} rows`);
      }
    } else {
      console.log(`  ⚠️  NO MARKET METADATA TABLES FOUND`);
      console.log(`  ⚠️  GAP: Cannot calculate ROI by category without market metadata`);
    }
  } catch (e: any) {
    console.log(`  ⚠️  Error checking metadata tables: ${e.message}`);
  }

  // 5. Check for price data (unrealized PnL)
  console.log('\n[5] PRICE DATA (For Unrealized PnL)');
  console.log('-'.repeat(100));

  try {
    const priceTables = await ch.query({
      query: `
        SELECT
          name,
          engine,
          total_rows
        FROM system.tables
        WHERE database = 'default'
          AND (
            name LIKE '%price%'
            OR name LIKE '%midprice%'
            OR name LIKE '%book%'
          )
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const priceTablesData = await priceTables.json();

    if (priceTablesData.length > 0) {
      console.log(`  Found ${priceTablesData.length} price tables:`);
      for (const table of priceTablesData) {
        console.log(`    - ${table.name}: ${parseInt(table.total_rows).toLocaleString()} rows`);
      }
    } else {
      console.log(`  ⚠️  NO PRICE TABLES FOUND`);
      console.log(`  ⚠️  GAP: Cannot calculate unrealized PnL without current prices`);
    }
  } catch (e: any) {
    console.log(`  ⚠️  Error checking price tables: ${e.message}`);
  }

  // 6. Summary of what we need
  console.log('\n' + '='.repeat(100));
  console.log('DATA REQUIREMENTS FOR FULL WALLET ANALYTICS');
  console.log('='.repeat(100));

  console.log(`
📊 Required Data Sources:

1. ✅ TRADES (CLOB Fills)
   - Source: Polymarket CLOB API
   - Status: HAVE (130M trades)
   - Coverage: ${tradeDays} days

2. ✅ SETTLEMENTS (ERC-1155 Transfers)
   - Source: Polygon blockchain
   - Status: BACKFILLING (7.5M → target 10-13M)
   - Coverage: Block ${parseInt(erc1155Data.earliest_block).toLocaleString()} → ${parseInt(erc1155Data.latest_block).toLocaleString()}

3. ❓ MARKET RESOLUTIONS (CRITICAL!)
   - Source: UMACtfAdapter events OR Polymarket API OR Gamma API
   - Required for: PnL calculation (winning outcome + payout vectors)
   - Data needed:
     * condition_id
     * winning_outcome_index
     * payout_numerators (array)
     * payout_denominator
     * resolution_timestamp

4. ❓ MARKET METADATA
   - Source: Polymarket /markets API
   - Required for: ROI by category, filtering by tag
   - Data needed:
     * market_id / condition_id
     * category (politics, sports, crypto, etc.)
     * tags (election-2024, NFL, etc.)
     * question text
     * outcomes array

5. ❓ PRICE DATA
   - Source: Polymarket prices API or CLOB book snapshots
   - Required for: Unrealized PnL on open positions
   - Data needed:
     * condition_id
     * outcome_index
     * current_price
     * timestamp

6. ❓ WALLET POSITIONS
   - Source: Can be calculated from trades + settlements
   - Required for: Current holdings, unrealized PnL
   - Data needed:
     * wallet_address
     * condition_id
     * outcome_index
     * shares_held
     * cost_basis
`);

  console.log('\n' + '='.repeat(100));
  console.log('NEXT STEPS');
  console.log('='.repeat(100));

  console.log(`
🔍 IMMEDIATE INVESTIGATIONS NEEDED:

1. Check if we have resolution data in any table
2. Check earliest CLOB trade timestamp (might need earlier data)
3. Identify which APIs to call for missing data:
   - Polymarket /markets API (metadata)
   - Polymarket /prices API (current prices)
   - Gamma Markets API (resolutions)
   - UMACtfAdapter blockchain events (on-chain resolutions)

4. Determine block range gaps:
   - Polymarket launched: ~2020
   - CTF contract deployed: Block ???
   - Our ERC-1155 backfill: Blocks 37,515,000+
   - Might need earlier blocks!

5. Plan additional backfills:
   - Market resolutions (HIGHEST PRIORITY)
   - Market metadata (categories/tags)
   - Price snapshots
   - Earlier blocks if needed
`);

  await ch.close();
}

main().catch(console.error);
