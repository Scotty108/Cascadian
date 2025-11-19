#!/usr/bin/env tsx
/**
 * Check if the 171k missing markets are actually resolved or still active
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function checkMissingMarketsStatus() {
  console.log('\n🔍 CHECKING STATUS OF 171K MISSING MARKETS\n');
  console.log('=' .repeat(80));

  // 1. Do we have ANY market status/metadata table?
  console.log('\n1️⃣ SEARCHING FOR MARKET METADATA TABLES');
  console.log('-'.repeat(80));

  const tables = await client.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows
      FROM system.tables
      WHERE (name LIKE '%market%' OR name LIKE '%condition%')
        AND database IN ('default', 'cascadian_clean', 'polymarket')
        AND engine NOT LIKE '%View%'
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const tableRows = await tables.json<any>();
  console.log('\nAvailable market-related tables:');
  tableRows.forEach((row: any) => {
    const rowCount = row.total_rows ? row.total_rows.toLocaleString() : '0';
    console.log(`  ${row.database}.${row.name} (${row.engine}): ${rowCount} rows`);
  });

  // 2. Check if we have market_metadata or similar
  const hasMetadata = tableRows.some((t: any) =>
    t.name.includes('metadata') || t.name.includes('market') && !t.name.includes('resolution')
  );

  if (hasMetadata) {
    console.log('\n2️⃣ CHECKING MARKET METADATA FOR RESOLUTION STATUS');
    console.log('-'.repeat(80));

    // Try to find markets table with condition_id
    const metadataTable = tableRows.find((t: any) =>
      (t.name.includes('metadata') || t.name === 'markets') && t.total_rows > 0
    );

    if (metadataTable) {
      const schema = await client.query({
        query: `DESCRIBE TABLE ${metadataTable.database}.${metadataTable.name}`,
        format: 'JSONEachRow'
      });

      const schemaRows = await schema.json<any>();
      console.log(`\nSchema of ${metadataTable.database}.${metadataTable.name}:`);
      schemaRows.forEach((col: any) => {
        console.log(`  ${col.name}: ${col.type}`);
      });

      // Check if it has condition_id and status fields
      const hasConditionId = schemaRows.some((col: any) =>
        col.name.includes('condition') && col.name.includes('id')
      );
      const hasStatus = schemaRows.some((col: any) =>
        col.name.toLowerCase().includes('status') || col.name.toLowerCase().includes('closed')
      );

      if (hasConditionId && hasStatus) {
        console.log('\n✅ Found table with condition_id and status!');
        console.log('Checking resolution status of missing markets...\n');

        // Get the actual column names
        const conditionIdCol = schemaRows.find((col: any) =>
          col.name.includes('condition') && col.name.includes('id')
        ).name;
        const statusCol = schemaRows.find((col: any) =>
          col.name.toLowerCase().includes('status') || col.name.toLowerCase().includes('closed')
        ).name;

        const statusCheck = await client.query({
          query: `
            WITH missing_cids AS (
              SELECT DISTINCT t.cid_hex
              FROM cascadian_clean.fact_trades_clean t
              LEFT JOIN (
                SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
                FROM default.market_resolutions_final
                WHERE winning_index IS NOT NULL
              ) r ON t.cid_hex = r.cid_hex
              WHERE t.cid_hex != '' AND r.cid_hex IS NULL
            )
            SELECT
              m.${statusCol} as status,
              COUNT(*) as count
            FROM missing_cids mc
            INNER JOIN ${metadataTable.database}.${metadataTable.name} m
              ON lower('0x' || m.${conditionIdCol}) = mc.cid_hex
            GROUP BY m.${statusCol}
            ORDER BY count DESC
          `,
          format: 'JSONEachRow'
        });

        const statusRows = await statusCheck.json<any>();
        console.log('Status breakdown of 171k missing markets:');
        statusRows.forEach((row: any) => {
          console.log(`  ${row.status}: ${row.count.toLocaleString()}`);
        });
      }
    }
  }

  // 3. Check trade recency for missing markets
  console.log('\n3️⃣ TRADE RECENCY FOR MISSING MARKETS');
  console.log('-'.repeat(80));

  const recencyCheck = await client.query({
    query: `
      WITH missing_cids AS (
        SELECT DISTINCT t.cid_hex
        FROM cascadian_clean.fact_trades_clean t
        LEFT JOIN (
          SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
          FROM default.market_resolutions_final
          WHERE winning_index IS NOT NULL
        ) r ON t.cid_hex = r.cid_hex
        WHERE t.cid_hex != '' AND r.cid_hex IS NULL
      )
      SELECT
        toStartOfMonth(t.block_timestamp) as trade_month,
        COUNT(DISTINCT t.cid_hex) as unique_markets,
        COUNT(*) as total_trades,
        SUM(t.usdc_amount) as total_volume_usdc
      FROM cascadian_clean.fact_trades_clean t
      INNER JOIN missing_cids mc ON t.cid_hex = mc.cid_hex
      GROUP BY trade_month
      ORDER BY trade_month DESC
      LIMIT 12
    `,
    format: 'JSONEachRow'
  });

  const recencyRows = await recencyCheck.json<any>();
  console.log('\nTrade activity for missing markets (last 12 months):');
  recencyRows.forEach((row: any) => {
    console.log(`  ${row.trade_month}: ${row.unique_markets.toLocaleString()} markets, ${row.total_trades.toLocaleString()} trades, $${(row.total_volume_usdc / 1_000_000).toFixed(2)}M volume`);
  });

  // 4. Sample some missing markets with high trade volume
  console.log('\n4️⃣ TOP MISSING MARKETS BY VOLUME (Need Resolution Data)');
  console.log('-'.repeat(80));

  const topMissing = await client.query({
    query: `
      WITH missing_cids AS (
        SELECT DISTINCT t.cid_hex
        FROM cascadian_clean.fact_trades_clean t
        LEFT JOIN (
          SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
          FROM default.market_resolutions_final
          WHERE winning_index IS NOT NULL
        ) r ON t.cid_hex = r.cid_hex
        WHERE t.cid_hex != '' AND r.cid_hex IS NULL
      )
      SELECT
        t.cid_hex,
        COUNT(*) as trade_count,
        COUNT(DISTINCT t.wallet_address) as unique_traders,
        SUM(t.usdc_amount) as total_volume_usdc,
        MIN(t.block_timestamp) as first_trade,
        MAX(t.block_timestamp) as last_trade
      FROM cascadian_clean.fact_trades_clean t
      INNER JOIN missing_cids mc ON t.cid_hex = mc.cid_hex
      GROUP BY t.cid_hex
      ORDER BY total_volume_usdc DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const topRows = await topMissing.json<any>();
  console.log('\nTop 20 missing markets by volume:');
  console.log('-'.repeat(80));
  topRows.forEach((row: any, idx: number) => {
    console.log(`\n${idx + 1}. ${row.cid_hex}`);
    console.log(`   Volume: $${(row.total_volume_usdc / 1_000_000).toFixed(2)}M | Trades: ${row.trade_count.toLocaleString()} | Traders: ${row.unique_traders.toLocaleString()}`);
    console.log(`   Period: ${row.first_trade} → ${row.last_trade}`);
  });

  // 5. Calculate potential PnL coverage if we backfill
  console.log('\n5️⃣ POTENTIAL PNL COVERAGE IF WE BACKFILL');
  console.log('-'.repeat(80));

  const coverageAnalysis = await client.query({
    query: `
      WITH resolution_status AS (
        SELECT
          SUM(CASE WHEN r.cid_hex IS NOT NULL THEN t.usdc_amount ELSE 0 END) as volume_with_resolution,
          SUM(t.usdc_amount) as total_volume,
          COUNT(DISTINCT CASE WHEN r.cid_hex IS NOT NULL THEN t.cid_hex END) as markets_with_resolution,
          COUNT(DISTINCT t.cid_hex) as total_markets
        FROM cascadian_clean.fact_trades_clean t
        LEFT JOIN (
          SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
          FROM default.market_resolutions_final
          WHERE winning_index IS NOT NULL
        ) r ON t.cid_hex = r.cid_hex
        WHERE t.cid_hex != ''
      )
      SELECT
        volume_with_resolution,
        total_volume,
        (volume_with_resolution / total_volume * 100) as volume_coverage_pct,
        markets_with_resolution,
        total_markets,
        (markets_with_resolution / total_markets * 100) as market_coverage_pct,
        (total_volume - volume_with_resolution) as volume_missing_resolution
      FROM resolution_status
    `,
    format: 'JSONEachRow'
  });

  const coverage = await coverageAnalysis.json<any>();
  if (coverage.length > 0) {
    const stats = coverage[0];
    console.log('\nCurrent PnL calculation coverage:');
    console.log(`  Markets: ${stats.markets_with_resolution.toLocaleString()} / ${stats.total_markets.toLocaleString()} (${stats.market_coverage_pct.toFixed(2)}%)`);
    console.log(`  Volume: $${(stats.volume_with_resolution / 1_000_000).toFixed(2)}M / $${(stats.total_volume / 1_000_000).toFixed(2)}M (${stats.volume_coverage_pct.toFixed(2)}%)`);
    console.log(`\n❌ Missing resolution data for:`);
    console.log(`  ${(stats.total_markets - stats.markets_with_resolution).toLocaleString()} markets`);
    console.log(`  $${(stats.volume_missing_resolution / 1_000_000).toFixed(2)}M in trading volume`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ ANALYSIS COMPLETE\n');

  await client.close();
}

checkMissingMarketsStatus().catch(console.error);
