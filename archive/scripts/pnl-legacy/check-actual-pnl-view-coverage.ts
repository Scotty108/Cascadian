#!/usr/bin/env tsx
/**
 * Check actual PnL view coverage to verify user's claim
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

async function checkActualCoverage() {
  console.log('\n🔍 CHECKING ACTUAL PNL VIEW COVERAGE\n');
  console.log('=' .repeat(80));

  // 1. Check if vw_wallet_positions exists
  console.log('\n1️⃣ CHECKING IF VIEW EXISTS');
  console.log('-'.repeat(80));

  const viewExists = await client.query({
    query: `
      SELECT name, engine
      FROM system.tables
      WHERE database = 'cascadian_clean'
        AND name LIKE '%pnl%' OR name LIKE '%wallet_position%'
    `,
    format: 'JSONEachRow'
  });

  const views = await viewExists.json<any>();
  console.log('\nPnL-related views/tables:');
  views.forEach((v: any) => {
    console.log(`  ${v.name} (${v.engine})`);
  });

  // 2. Check vw_wallet_positions coverage
  if (views.some((v: any) => v.name === 'vw_wallet_positions')) {
    console.log('\n2️⃣ VW_WALLET_POSITIONS COVERAGE');
    console.log('-'.repeat(80));

    const coverage = await client.query({
      query: `
        SELECT
          COUNT(DISTINCT cid_hex) as unique_markets,
          SUM(CASE WHEN is_resolved THEN 1 ELSE 0 END) as resolved_positions,
          COUNT(*) as total_positions,
          COUNT(DISTINCT CASE WHEN is_resolved THEN cid_hex END) as resolved_markets
        FROM cascadian_clean.vw_wallet_positions
      `,
      format: 'JSONEachRow'
    });

    const cov = await coverage.json<any>();
    console.log('\nvw_wallet_positions stats:');
    console.log(`  Total positions: ${cov[0].total_positions.toLocaleString()}`);
    console.log(`  Resolved positions: ${cov[0].resolved_positions.toLocaleString()}`);
    console.log(`  Unique markets: ${cov[0].unique_markets.toLocaleString()}`);
    console.log(`  Resolved markets: ${cov[0].resolved_markets.toLocaleString()}`);
    console.log(`  Resolution rate: ${((cov[0].resolved_markets / cov[0].unique_markets) * 100).toFixed(2)}%`);
  }

  // 3. Check what's actually in the resolution CTE
  console.log('\n3️⃣ CHECKING RESOLUTION CTE COVERAGE');
  console.log('-'.repeat(80));

  const resolutionCTE = await client.query({
    query: `
      WITH resolutions AS (
        SELECT
          lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid_hex,
          winning_index,
          payout_numerators,
          payout_denominator
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL
          AND payout_denominator > 0
      )
      SELECT
        COUNT(DISTINCT cid_hex) as unique_resolution_cids
      FROM resolutions
    `,
    format: 'JSONEachRow'
  });

  const resCTE = await resolutionCTE.json<any>();
  console.log(`\nResolution CTE produces: ${resCTE[0].unique_resolution_cids.toLocaleString()} unique CIDs`);

  // 4. Compare with fact_trades_clean
  console.log('\n4️⃣ COMPARING RESOLUTION CTE WITH TRADES');
  console.log('-'.repeat(80));

  const comparison = await client.query({
    query: `
      WITH resolutions AS (
        SELECT DISTINCT
          lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL
          AND payout_denominator > 0
      )
      SELECT
        COUNT(DISTINCT t.cid_hex) as total_trade_cids,
        COUNT(DISTINCT CASE WHEN r.cid_hex IS NOT NULL THEN t.cid_hex END) as matched_cids,
        COUNT(DISTINCT CASE WHEN r.cid_hex IS NULL THEN t.cid_hex END) as unmatched_cids
      FROM cascadian_clean.fact_trades_clean t
      LEFT JOIN resolutions r ON t.cid_hex = r.cid_hex
      WHERE t.cid_hex != ''
    `,
    format: 'JSONEachRow'
  });

  const comp = await comparison.json<any>();
  console.log('\nJoin coverage with leftPad normalization:');
  console.log(`  Total trade CIDs: ${comp[0].total_trade_cids.toLocaleString()}`);
  console.log(`  Matched CIDs: ${comp[0].matched_cids.toLocaleString()}`);
  console.log(`  Unmatched CIDs: ${comp[0].unmatched_cids.toLocaleString()}`);
  console.log(`  Match rate: ${((comp[0].matched_cids / comp[0].total_trade_cids) * 100).toFixed(2)}%`);

  // 5. Compare with toString normalization
  console.log('\n5️⃣ COMPARING WITH TOSTRING NORMALIZATION');
  console.log('-'.repeat(80));

  const toStringComp = await client.query({
    query: `
      WITH resolutions AS (
        SELECT DISTINCT
          lower('0x' || toString(condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL
          AND payout_denominator > 0
      )
      SELECT
        COUNT(DISTINCT t.cid_hex) as total_trade_cids,
        COUNT(DISTINCT CASE WHEN r.cid_hex IS NOT NULL THEN t.cid_hex END) as matched_cids,
        COUNT(DISTINCT CASE WHEN r.cid_hex IS NULL THEN t.cid_hex END) as unmatched_cids
      FROM cascadian_clean.fact_trades_clean t
      LEFT JOIN resolutions r ON t.cid_hex = r.cid_hex
      WHERE t.cid_hex != ''
    `,
    format: 'JSONEachRow'
  });

  const toStr = await toStringComp.json<any>();
  console.log('\nJoin coverage with toString normalization:');
  console.log(`  Total trade CIDs: ${toStr[0].total_trade_cids.toLocaleString()}`);
  console.log(`  Matched CIDs: ${toStr[0].matched_cids.toLocaleString()}`);
  console.log(`  Unmatched CIDs: ${toStr[0].unmatched_cids.toLocaleString()}`);
  console.log(`  Match rate: ${((toStr[0].matched_cids / toStr[0].total_trade_cids) * 100).toFixed(2)}%`);

  // 6. Check duplicates in market_resolutions_final
  console.log('\n6️⃣ CHECKING FOR DUPLICATES IN MARKET_RESOLUTIONS_FINAL');
  console.log('-'.repeat(80));

  const duplicates = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id_norm) as unique_cids,
        COUNT(*) - COUNT(DISTINCT condition_id_norm) as duplicate_count
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL
    `,
    format: 'JSONEachRow'
  });

  const dups = await duplicates.json<any>();
  console.log('\nmarket_resolutions_final duplication:');
  console.log(`  Total rows: ${dups[0].total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs: ${dups[0].unique_cids.toLocaleString()}`);
  console.log(`  Duplicates: ${dups[0].duplicate_count.toLocaleString()}`);

  if (dups[0].duplicate_count > 0) {
    console.log('\n7️⃣ SAMPLE DUPLICATE CONDITION_IDS');
    console.log('-'.repeat(80));

    const dupSamples = await client.query({
      query: `
        SELECT
          condition_id_norm,
          COUNT(*) as count,
          groupArray(winning_index) as winning_indices,
          groupArray(source) as sources
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL
        GROUP BY condition_id_norm
        HAVING count > 1
        ORDER BY count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const dupList = await dupSamples.json<any>();
    console.log('\nTop 10 duplicated condition_ids:');
    dupList.forEach((row: any, idx: number) => {
      console.log(`\n${idx + 1}. CID: ${row.condition_id_norm}`);
      console.log(`   Count: ${row.count}`);
      console.log(`   Winning indices: ${row.winning_indices}`);
      console.log(`   Sources: ${row.sources}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ COVERAGE CHECK COMPLETE\n');

  await client.close();
}

checkActualCoverage().catch(console.error);
