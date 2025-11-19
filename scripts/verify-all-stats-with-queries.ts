#!/usr/bin/env npx tsx
/**
 * VERIFY ALL DATABASE STATISTICS - WITH QUERIES SHOWN
 *
 * Shows exactly what query was used for each number so you can verify yourself
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('COMPLETE DATABASE VERIFICATION - ALL NUMBERS WITH QUERIES');
  console.log('═'.repeat(100));

  // ============================================================================
  // 1. TRADES - THE MOST IMPORTANT NUMBER
  // ============================================================================
  console.log('\n1️⃣  TOTAL TRADES');
  console.log('─'.repeat(100));

  const tradeQuery = `SELECT COUNT(*) as count FROM default.vw_trades_canonical`;
  console.log(`Query: ${tradeQuery}`);

  const trades = await ch.query({ query: tradeQuery, format: 'JSONEachRow' });
  const tradeCount = (await trades.json())[0].count;
  console.log(`Result: ${parseInt(tradeCount).toLocaleString()} trades\n`);

  // Show what other trade tables exist for context
  console.log('Other trade tables (for context):');
  const tradeTables = await ch.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND name LIKE '%trade%'
        AND total_rows > 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });
  const tradeTablesData = await tradeTables.json<Array<{name: string; total_rows: number}>>();
  for (const row of tradeTablesData) {
    console.log(`  ${row.name}: ${parseInt(row.total_rows.toString()).toLocaleString()} rows`);
  }

  // ============================================================================
  // 2. WALLETS
  // ============================================================================
  console.log('\n\n2️⃣  WALLETS');
  console.log('─'.repeat(100));

  // CLOB traders
  const clobQuery = `SELECT COUNT(DISTINCT wallet_address) as count FROM default.trade_direction_assignments`;
  console.log(`CLOB traders query: ${clobQuery}`);
  const clobWallets = await ch.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobCount = (await clobWallets.json())[0].count;
  console.log(`Result: ${parseInt(clobCount).toLocaleString()} CLOB traders\n`);

  // ERC-1155 participants
  const erc1155Query = `
    SELECT COUNT(DISTINCT wallet) as count
    FROM (
      SELECT DISTINCT from_address as wallet FROM default.erc1155_transfers
      WHERE from_address != '' AND from_address != '0000000000000000000000000000000000000000'
      UNION ALL
      SELECT DISTINCT to_address as wallet FROM default.erc1155_transfers
      WHERE to_address != '' AND to_address != '0000000000000000000000000000000000000000'
    )
  `;
  console.log('ERC-1155 participants query:');
  console.log(erc1155Query);
  const erc1155Wallets = await ch.query({ query: erc1155Query, format: 'JSONEachRow' });
  const erc1155Count = (await erc1155Wallets.json())[0].count;
  console.log(`Result: ${parseInt(erc1155Count).toLocaleString()} ERC-1155 participants\n`);

  // Combined unique
  const combinedQuery = `
    SELECT COUNT(DISTINCT wallet) as count
    FROM (
      SELECT DISTINCT wallet_address as wallet FROM default.trade_direction_assignments
      UNION ALL
      SELECT DISTINCT from_address as wallet FROM default.erc1155_transfers
      WHERE from_address != '' AND from_address != '0000000000000000000000000000000000000000'
      UNION ALL
      SELECT DISTINCT to_address as wallet FROM default.erc1155_transfers
      WHERE to_address != '' AND to_address != '0000000000000000000000000000000000000000'
    )
  `;
  console.log('Combined unique wallets query:');
  console.log(combinedQuery);
  const combinedWallets = await ch.query({ query: combinedQuery, format: 'JSONEachRow' });
  const combinedCount = (await combinedWallets.json())[0].count;
  console.log(`Result: ${parseInt(combinedCount).toLocaleString()} unique wallets (CLOB + ERC-1155)\n`);

  // ============================================================================
  // 3. MARKETS
  // ============================================================================
  console.log('\n3️⃣  MARKETS');
  console.log('─'.repeat(100));

  const marketsQuery = `SELECT COUNT(DISTINCT condition_id_norm) as count FROM default.dim_markets`;
  console.log(`Query: ${marketsQuery}`);
  const markets = await ch.query({ query: marketsQuery, format: 'JSONEachRow' });
  const marketCount = (await markets.json())[0].count;
  console.log(`Result: ${parseInt(marketCount).toLocaleString()} unique markets\n`);

  // Markets with metadata
  const metadataQuery = `
    SELECT
      COUNT(*) as total,
      countIf(question != '') as with_question,
      countIf(category != '') as with_category,
      countIf(length(outcomes) > 0) as with_outcomes
    FROM default.dim_markets
  `;
  console.log('Markets metadata query:');
  console.log(metadataQuery);
  const metadata = await ch.query({ query: metadataQuery, format: 'JSONEachRow' });
  const metaData = (await metadata.json())[0];
  console.log(`Total markets: ${parseInt(metaData.total).toLocaleString()}`);
  console.log(`With question: ${parseInt(metaData.with_question).toLocaleString()} (${(metaData.with_question/metaData.total*100).toFixed(1)}%)`);
  console.log(`With category: ${parseInt(metaData.with_category).toLocaleString()} (${(metaData.with_category/metaData.total*100).toFixed(1)}%)`);
  console.log(`With outcomes: ${parseInt(metaData.with_outcomes).toLocaleString()} (${(metaData.with_outcomes/metaData.total*100).toFixed(1)}%)\n`);

  // ============================================================================
  // 4. ERC-1155 EVENTS
  // ============================================================================
  console.log('\n4️⃣  ERC-1155 BLOCKCHAIN EVENTS');
  console.log('─'.repeat(100));

  const eventsQuery = `SELECT COUNT(*) as count FROM default.erc1155_transfers`;
  console.log(`Query: ${eventsQuery}`);
  const events = await ch.query({ query: eventsQuery, format: 'JSONEachRow' });
  const eventCount = (await events.json())[0].count;
  console.log(`Result: ${parseInt(eventCount).toLocaleString()} events\n`);

  // Block range
  const blockQuery = `
    SELECT
      min(block_number) as first_block,
      max(block_number) as last_block
    FROM default.erc1155_transfers
  `;
  console.log('Block range query:');
  console.log(blockQuery);
  const blocks = await ch.query({ query: blockQuery, format: 'JSONEachRow' });
  const blockData = (await blocks.json())[0];
  console.log(`Block range: ${parseInt(blockData.first_block).toLocaleString()} → ${parseInt(blockData.last_block).toLocaleString()}\n`);

  // ============================================================================
  // 5. RESOLUTIONS
  // ============================================================================
  console.log('\n5️⃣  MARKET RESOLUTIONS');
  console.log('─'.repeat(100));

  const resolutionsQuery = `
    SELECT
      COUNT(*) as total,
      countIf(length(payout_numerators) > 0) as with_payout_vector,
      countIf(winning_index IS NOT NULL) as with_winner
    FROM default.market_resolutions_final
  `;
  console.log('Query:');
  console.log(resolutionsQuery);
  const resolutions = await ch.query({ query: resolutionsQuery, format: 'JSONEachRow' });
  const resData = (await resolutions.json())[0];
  console.log(`Total resolutions: ${parseInt(resData.total).toLocaleString()}`);
  console.log(`With payout vectors: ${parseInt(resData.with_payout_vector).toLocaleString()} (${(resData.with_payout_vector/resData.total*100).toFixed(1)}%)`);
  console.log(`With winner: ${parseInt(resData.with_winner).toLocaleString()} (${(resData.with_winner/resData.total*100).toFixed(1)}%)\n`);

  // ============================================================================
  // 6. SYSTEM WALLET MAPPING
  // ============================================================================
  console.log('\n6️⃣  SYSTEM WALLET MAPPING');
  console.log('─'.repeat(100));

  const mappingQuery = `
    SELECT
      COUNT(*) as total_mappings,
      uniqExact(system_wallet) as system_wallets,
      uniqExact(user_wallet) as unique_users,
      countIf(confidence = 'HIGH') as high_confidence,
      countIf(confidence = 'MEDIUM') as medium_confidence
    FROM cascadian_clean.system_wallet_map
  `;
  console.log('Query:');
  console.log(mappingQuery);
  const mapping = await ch.query({ query: mappingQuery, format: 'JSONEachRow' });
  const mapData = (await mapping.json())[0];
  console.log(`Total mappings: ${parseInt(mapData.total_mappings).toLocaleString()}`);
  console.log(`System wallets: ${parseInt(mapData.system_wallets).toLocaleString()}`);
  console.log(`Unique users recovered: ${parseInt(mapData.unique_users).toLocaleString()}`);
  console.log(`HIGH confidence: ${parseInt(mapData.high_confidence).toLocaleString()} (${(mapData.high_confidence/mapData.total_mappings*100).toFixed(1)}%)`);
  console.log(`MEDIUM confidence: ${parseInt(mapData.medium_confidence).toLocaleString()} (${(mapData.medium_confidence/mapData.total_mappings*100).toFixed(1)}%)\n`);

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n' + '═'.repeat(100));
  console.log('VERIFIED SUMMARY');
  console.log('═'.repeat(100));

  console.log(`\n✅ Total Trades:              ${parseInt(tradeCount).toLocaleString()}`);
  console.log(`✅ Unique Wallets:            ${parseInt(combinedCount).toLocaleString()}`);
  console.log(`✅ Markets:                   ${parseInt(marketCount).toLocaleString()}`);
  console.log(`✅ ERC-1155 Events:           ${parseInt(eventCount).toLocaleString()}`);
  console.log(`✅ Resolutions:               ${parseInt(resData.total).toLocaleString()}`);
  console.log(`✅ System Wallet Mappings:    ${parseInt(mapData.total_mappings).toLocaleString()}`);

  console.log('\n' + '═'.repeat(100));
  console.log('All queries shown above - you can verify each one yourself in ClickHouse');
  console.log('═'.repeat(100) + '\n');

  await ch.close();
}

main().catch(console.error);
