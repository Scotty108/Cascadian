#!/usr/bin/env ts-node
/**
 * CRITICAL: Diagnose FixedString(64) join bug in market_resolutions_final
 *
 * Problem: Only 57k of 224k resolutions are matching in PnL joins
 * Hypothesis: FixedString(64) null-byte padding is breaking joins
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

async function diagnoseJoinBug() {
  console.log('\n🔍 DIAGNOSING FIXEDSTRING JOIN BUG\n');
  console.log('=' .repeat(80));

  // 1. Check actual data types and formats
  console.log('\n1️⃣ SCHEMA VERIFICATION');
  console.log('-'.repeat(80));

  const schema = await client.query({
    query: `
      SELECT
        name,
        type,
        position
      FROM system.columns
      WHERE database = 'default'
        AND table = 'market_resolutions_final'
        AND name IN ('condition_id', 'condition_id_norm')
      ORDER BY position
    `,
    format: 'JSONEachRow'
  });

  const schemaRows = await schema.json();
  console.log('market_resolutions_final schema:');
  console.log(schemaRows);

  // 2. Sample actual data to see formats
  console.log('\n2️⃣ SAMPLE DATA FORMATS');
  console.log('-'.repeat(80));

  const samples = await client.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as norm_length,
        hex(condition_id_norm) as norm_hex_encoded,
        toString(condition_id_norm) as norm_as_string,
        length(toString(condition_id_norm)) as string_length,
        winning_index
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const sampleRows = await samples.json<any>();
  console.log('\nSample resolutions (showing null-byte issues):');
  sampleRows.forEach((row: any, idx: number) => {
    console.log(`\nSample ${idx + 1}:`);
    console.log(`  Raw FixedString length: ${row.norm_length}`);
    console.log(`  Hex encoded: ${row.norm_hex_encoded}`);
    console.log(`  toString() length: ${row.string_length}`);
    console.log(`  Value: ${row.norm_as_string}`);
  });

  // 3. Check fact_trades_clean format
  console.log('\n3️⃣ FACT_TRADES_CLEAN FORMAT');
  console.log('-'.repeat(80));

  const tradeSamples = await client.query({
    query: `
      SELECT
        cid_hex,
        length(cid_hex) as cid_length,
        substring(cid_hex, 1, 10) as cid_prefix
      FROM cascadian_clean.fact_trades_clean
      WHERE cid_hex != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const tradeRows = await tradeSamples.json<any>();
  console.log('\nSample fact_trades_clean condition IDs:');
  tradeRows.forEach((row: any, idx: number) => {
    console.log(`  ${idx + 1}. Length: ${row.cid_length}, Prefix: ${row.cid_prefix}`);
  });

  // 4. Test different normalization approaches
  console.log('\n4️⃣ TESTING NORMALIZATION APPROACHES');
  console.log('-'.repeat(80));

  const approaches = [
    {
      name: 'Current approach (leftPad)',
      sql: `lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))`
    },
    {
      name: 'toString() first',
      sql: `lower('0x' || toString(condition_id_norm))`
    },
    {
      name: 'CAST to String',
      sql: `lower('0x' || CAST(condition_id_norm AS String))`
    },
    {
      name: 'trimRight null bytes',
      sql: `lower('0x' || trimRight(toString(condition_id_norm), '\\0'))`
    },
    {
      name: 'substring(64) to force length',
      sql: `lower('0x' || substring(toString(condition_id_norm), 1, 64))`
    }
  ];

  for (const approach of approaches) {
    console.log(`\n📊 Testing: ${approach.name}`);

    const testQuery = `
      WITH normalized_resolutions AS (
        SELECT
          ${approach.sql} AS cid_hex,
          winning_index,
          payout_numerators,
          payout_denominator
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL AND payout_denominator > 0
      )
      SELECT
        COUNT(DISTINCT nr.cid_hex) as unique_resolution_cids,
        COUNT(DISTINCT t.cid_hex) as unique_trade_cids,
        COUNT(DISTINCT t.tx_hash) as matched_trades
      FROM cascadian_clean.fact_trades_clean t
      INNER JOIN normalized_resolutions nr ON t.cid_hex = nr.cid_hex
    `;

    try {
      const result = await client.query({
        query: testQuery,
        format: 'JSONEachRow'
      });

      const rows = await result.json<any>();
      if (rows.length > 0) {
        const stats = rows[0];
        console.log(`  ✅ Unique resolution CIDs matched: ${stats.unique_resolution_cids.toLocaleString()}`);
        console.log(`  ✅ Unique trade CIDs matched: ${stats.unique_trade_cids.toLocaleString()}`);
        console.log(`  ✅ Total matched trades: ${stats.matched_trades.toLocaleString()}`);
      }
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  // 5. Detailed comparison - show before/after
  console.log('\n5️⃣ BEFORE/AFTER COMPARISON');
  console.log('-'.repeat(80));

  const beforeQuery = `
    WITH resolutions AS (
      SELECT
        lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid_hex,
        winning_index
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL AND payout_denominator > 0
    )
    SELECT COUNT(DISTINCT t.tx_hash) as matched_trades
    FROM cascadian_clean.fact_trades_clean t
    INNER JOIN resolutions r ON t.cid_hex = r.cid_hex
  `;

  const afterQuery = `
    WITH resolutions AS (
      SELECT
        lower('0x' || toString(condition_id_norm)) AS cid_hex,
        winning_index
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL AND payout_denominator > 0
    )
    SELECT COUNT(DISTINCT t.tx_hash) as matched_trades
    FROM cascadian_clean.fact_trades_clean t
    INNER JOIN resolutions r ON t.cid_hex = r.cid_hex
  `;

  const before = await client.query({ query: beforeQuery, format: 'JSONEachRow' });
  const beforeRows = await before.json<any>();
  const beforeCount = beforeRows[0]?.matched_trades || 0;

  const after = await client.query({ query: afterQuery, format: 'JSONEachRow' });
  const afterRows = await after.json<any>();
  const afterCount = afterRows[0]?.matched_trades || 0;

  console.log(`\n📈 BEFORE (leftPad): ${beforeCount.toLocaleString()} matched trades`);
  console.log(`📈 AFTER (toString): ${afterCount.toLocaleString()} matched trades`);
  console.log(`🚀 Improvement: ${(afterCount - beforeCount).toLocaleString()} additional trades (+${((afterCount/beforeCount - 1) * 100).toFixed(1)}%)`);

  // 6. Show some examples of CIDs that NOW match
  console.log('\n6️⃣ EXAMPLES OF NEWLY MATCHED CIDs');
  console.log('-'.repeat(80));

  const examplesQuery = `
    WITH old_norm AS (
      SELECT
        lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid_hex,
        condition_id_norm as original
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL
    ),
    new_norm AS (
      SELECT
        lower('0x' || toString(condition_id_norm)) AS cid_hex,
        condition_id_norm as original
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL
    )
    SELECT
      t.cid_hex as trade_cid,
      old.cid_hex as old_normalized,
      new.cid_hex as new_normalized,
      COUNT(*) as trade_count
    FROM cascadian_clean.fact_trades_clean t
    LEFT JOIN old_norm old ON t.cid_hex = old.cid_hex
    INNER JOIN new_norm new ON t.cid_hex = new.cid_hex
    WHERE old.cid_hex IS NULL
    GROUP BY t.cid_hex, old.cid_hex, new.cid_hex
    LIMIT 10
  `;

  const examples = await client.query({ query: examplesQuery, format: 'JSONEachRow' });
  const exampleRows = await examples.json<any>();

  console.log(`\nShowing ${exampleRows.length} examples of CIDs that NOW match:`);
  exampleRows.forEach((row: any, idx: number) => {
    console.log(`\n${idx + 1}. Trade CID: ${row.trade_cid}`);
    console.log(`   Old normalized: ${row.old_normalized || 'NULL (no match)'}`);
    console.log(`   New normalized: ${row.new_normalized}`);
    console.log(`   Trades using this CID: ${row.trade_count}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('✅ DIAGNOSIS COMPLETE\n');

  await client.close();
}

diagnoseJoinBug().catch(console.error);
