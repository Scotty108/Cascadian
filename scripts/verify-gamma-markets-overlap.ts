#!/usr/bin/env tsx
/**
 * Verify overlap between gamma_markets and our missing resolutions
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

async function verifyOverlap() {
  console.log('\n🔍 VERIFYING GAMMA_MARKETS OVERLAP WITH MISSING RESOLUTIONS\n');
  console.log('=' .repeat(80));

  // 1. Normalize gamma_markets condition_ids and check format
  console.log('\n1️⃣ GAMMA_MARKETS CONDITION_ID FORMATS');
  console.log('-'.repeat(80));

  const formats = await client.query({
    query: `
      SELECT
        length(condition_id) as cid_length,
        substring(condition_id, 1, 2) as prefix,
        COUNT(*) as count,
        any(condition_id) as example
      FROM default.gamma_markets
      GROUP BY cid_length, prefix
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });

  const formatRows = await formats.json<any>();
  console.log('\nGamma markets condition_id formats:');
  formatRows.forEach((row: any) => {
    console.log(`  Length ${row.cid_length}, Prefix '${row.prefix}': ${row.count.toLocaleString()} (e.g., ${row.example.substring(0, 20)}...)`);
  });

  // 2. Check fact_trades_clean format (reminder)
  console.log('\n2️⃣ FACT_TRADES_CLEAN CONDITION_ID FORMAT');
  console.log('-'.repeat(80));

  const tradeFormat = await client.query({
    query: `
      SELECT
        length(cid_hex) as cid_length,
        substring(cid_hex, 1, 2) as prefix,
        COUNT(*) as count,
        any(cid_hex) as example
      FROM cascadian_clean.fact_trades_clean
      WHERE cid_hex != ''
      GROUP BY cid_length, prefix
      ORDER BY count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const tradeFormatRows = await tradeFormat.json<any>();
  console.log('\nFact trades condition_id formats:');
  tradeFormatRows.forEach((row: any) => {
    console.log(`  Length ${row.cid_length}, Prefix '${row.prefix}': ${row.count.toLocaleString()} (e.g., ${row.example.substring(0, 20)}...)`);
  });

  // 3. Direct overlap check with proper normalization
  console.log('\n3️⃣ DIRECT OVERLAP (Normalized Join)');
  console.log('-'.repeat(80));

  const overlapQuery = `
    WITH gamma_normalized AS (
      SELECT DISTINCT
        lower(condition_id) as cid_hex,
        outcome,
        outcomes_json
      FROM default.gamma_markets
      WHERE condition_id != '' AND outcome != ''
    ),
    trade_cids AS (
      SELECT DISTINCT cid_hex
      FROM cascadian_clean.fact_trades_clean
      WHERE cid_hex != ''
    )
    SELECT
      (SELECT COUNT(*) FROM gamma_normalized) as gamma_count,
      (SELECT COUNT(*) FROM trade_cids) as trade_count,
      COUNT(*) as overlap
    FROM trade_cids t
    INNER JOIN gamma_normalized g ON t.cid_hex = g.cid_hex
  `;

  const overlap = await client.query({
    query: overlapQuery,
    format: 'JSONEachRow'
  });

  const overlapRows = await overlap.json<any>();
  if (overlapRows.length > 0) {
    const stats = overlapRows[0];
    console.log(`\nGamma markets (normalized): ${stats.gamma_count.toLocaleString()}`);
    console.log(`Trade CIDs (non-empty): ${stats.trade_count.toLocaleString()}`);
    console.log(`Overlap (matching): ${stats.overlap.toLocaleString()}`);
    console.log(`Match rate: ${((stats.overlap / stats.trade_count) * 100).toFixed(2)}%`);
  }

  // 4. Check overlap with MISSING resolutions specifically
  console.log('\n4️⃣ OVERLAP WITH MISSING RESOLUTIONS');
  console.log('-'.repeat(80));

  const missingOverlap = await client.query({
    query: `
      WITH existing_resolutions AS (
        SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL
      ),
      missing_cids AS (
        SELECT DISTINCT t.cid_hex
        FROM cascadian_clean.fact_trades_clean t
        LEFT JOIN existing_resolutions r ON t.cid_hex = r.cid_hex
        WHERE t.cid_hex != '' AND r.cid_hex IS NULL
      ),
      gamma_normalized AS (
        SELECT DISTINCT
          lower(condition_id) as cid_hex,
          outcome
        FROM default.gamma_markets
        WHERE condition_id != '' AND outcome != ''
      )
      SELECT
        (SELECT COUNT(*) FROM missing_cids) as total_missing,
        (SELECT COUNT(*) FROM gamma_normalized) as gamma_with_outcome,
        COUNT(*) as recoverable_from_gamma
      FROM missing_cids m
      INNER JOIN gamma_normalized g ON m.cid_hex = g.cid_hex
    `,
    format: 'JSONEachRow'
  });

  const missingRows = await missingOverlap.json<any>();
  if (missingRows.length > 0) {
    const stats = missingRows[0];
    console.log(`\nTotal missing resolutions: ${stats.total_missing.toLocaleString()}`);
    console.log(`Gamma markets with outcome: ${stats.gamma_with_outcome.toLocaleString()}`);
    console.log(`✅ Recoverable from gamma: ${stats.recoverable_from_gamma.toLocaleString()}`);
    console.log(`Recovery rate: ${((stats.recoverable_from_gamma / stats.total_missing) * 100).toFixed(2)}%`);

    const remaining = stats.total_missing - stats.recoverable_from_gamma;
    console.log(`\n❌ Still missing: ${remaining.toLocaleString()} markets`);
  }

  // 5. Sample some markets we can recover
  console.log('\n5️⃣ SAMPLE RECOVERABLE MARKETS');
  console.log('-'.repeat(80));

  const sampleRecoverable = await client.query({
    query: `
      WITH existing_resolutions AS (
        SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL
      ),
      missing_cids AS (
        SELECT
          t.cid_hex,
          COUNT(*) as trade_count,
          SUM(t.usdc_amount) as volume_usdc
        FROM cascadian_clean.fact_trades_clean t
        LEFT JOIN existing_resolutions r ON t.cid_hex = r.cid_hex
        WHERE t.cid_hex != '' AND r.cid_hex IS NULL
        GROUP BY t.cid_hex
      ),
      gamma_normalized AS (
        SELECT
          lower(condition_id) as cid_hex,
          outcome,
          outcomes_json,
          question
        FROM default.gamma_markets
        WHERE condition_id != '' AND outcome != ''
      )
      SELECT
        m.cid_hex,
        m.trade_count,
        m.volume_usdc,
        g.question,
        g.outcome,
        g.outcomes_json
      FROM missing_cids m
      INNER JOIN gamma_normalized g ON m.cid_hex = g.cid_hex
      ORDER BY m.volume_usdc DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleRecoverable.json<any>();
  console.log(`\nTop 10 recoverable markets by volume:`);
  samples.forEach((row: any, idx: number) => {
    console.log(`\n${idx + 1}. ${row.question}`);
    console.log(`   CID: ${row.cid_hex}`);
    console.log(`   Volume: $${(row.volume_usdc / 1_000_000).toFixed(2)}M | Trades: ${row.trade_count.toLocaleString()}`);
    console.log(`   Winner: ${row.outcome} | Outcomes: ${row.outcomes_json}`);
  });

  // 6. Calculate potential improvement in PnL coverage
  console.log('\n6️⃣ POTENTIAL PNL COVERAGE IMPROVEMENT');
  console.log('-'.repeat(80));

  const improvement = await client.query({
    query: `
      WITH existing_resolutions AS (
        SELECT DISTINCT lower('0x' || toString(condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE winning_index IS NOT NULL
      ),
      gamma_normalized AS (
        SELECT DISTINCT lower(condition_id) as cid_hex
        FROM default.gamma_markets
        WHERE condition_id != '' AND outcome != ''
      ),
      all_trades AS (
        SELECT
          cid_hex,
          SUM(usdc_amount) as volume
        FROM cascadian_clean.fact_trades_clean
        WHERE cid_hex != ''
        GROUP BY cid_hex
      )
      SELECT
        SUM(CASE WHEN e.cid_hex IS NOT NULL THEN t.volume ELSE 0 END) as current_coverage_volume,
        SUM(CASE WHEN e.cid_hex IS NOT NULL OR g.cid_hex IS NOT NULL THEN t.volume ELSE 0 END) as potential_coverage_volume,
        SUM(t.volume) as total_volume,
        COUNT(DISTINCT CASE WHEN e.cid_hex IS NOT NULL THEN t.cid_hex END) as current_market_count,
        COUNT(DISTINCT CASE WHEN e.cid_hex IS NOT NULL OR g.cid_hex IS NOT NULL THEN t.cid_hex END) as potential_market_count,
        COUNT(DISTINCT t.cid_hex) as total_markets
      FROM all_trades t
      LEFT JOIN existing_resolutions e ON t.cid_hex = e.cid_hex
      LEFT JOIN gamma_normalized g ON t.cid_hex = g.cid_hex
    `,
    format: 'JSONEachRow'
  });

  const improvementRows = await improvement.json<any>();
  if (improvementRows.length > 0) {
    const stats = improvementRows[0];
    const currentPct = (stats.current_coverage_volume / stats.total_volume) * 100;
    const potentialPct = (stats.potential_coverage_volume / stats.total_volume) * 100;
    const improvementPct = potentialPct - currentPct;

    console.log('\nCURRENT PnL Coverage:');
    console.log(`  Markets: ${stats.current_market_count.toLocaleString()} / ${stats.total_markets.toLocaleString()} (${((stats.current_market_count/stats.total_markets)*100).toFixed(2)}%)`);
    console.log(`  Volume: $${(stats.current_coverage_volume / 1_000_000).toFixed(2)}M / $${(stats.total_volume / 1_000_000).toFixed(2)}M (${currentPct.toFixed(2)}%)`);

    console.log('\n🚀 POTENTIAL Coverage (with gamma_markets):');
    console.log(`  Markets: ${stats.potential_market_count.toLocaleString()} / ${stats.total_markets.toLocaleString()} (${((stats.potential_market_count/stats.total_markets)*100).toFixed(2)}%)`);
    console.log(`  Volume: $${(stats.potential_coverage_volume / 1_000_000).toFixed(2)}M / $${(stats.total_volume / 1_000_000).toFixed(2)}M (${potentialPct.toFixed(2)}%)`);

    console.log(`\n📈 IMPROVEMENT:  +${improvementPct.toFixed(2)}% volume coverage`);
    console.log(`   Additional markets: ${(stats.potential_market_count - stats.current_market_count).toLocaleString()}`);
    console.log(`   Additional volume: $${((stats.potential_coverage_volume - stats.current_coverage_volume) / 1_000_000).toFixed(2)}M`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ VERIFICATION COMPLETE\n');

  await client.close();
}

verifyOverlap().catch(console.error);
