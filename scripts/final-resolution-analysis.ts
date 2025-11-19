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

async function finalResolutionAnalysis() {
  try {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  MARKET RESOLUTION DATA DISCOVERY - FINAL REPORT');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Baseline: total traded conditions
    const tradedResult = await client.query({
      query: `
        SELECT
          COUNT(DISTINCT condition_id) as total_conditions,
          COUNT(*) as total_trades
        FROM trades_raw
        WHERE condition_id != ''
      `,
      format: 'JSONEachRow'
    });
    const baseline = await tradedResult.json();
    console.log('BASELINE (trades_raw):');
    console.log(`  Unique conditions traded: ${baseline[0].total_conditions.toLocaleString()}`);
    console.log(`  Total trades: ${baseline[0].total_trades.toLocaleString()}\n`);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  PRIMARY RESOLUTION TABLES DISCOVERED');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Table 1: market_resolutions_final
    console.log('1. market_resolutions_final');
    console.log('   Description: Main resolution table with payout vectors\n');

    const mrf_schema = await client.query({
      query: `DESCRIBE market_resolutions_final`,
      format: 'JSONEachRow'
    });
    const mrf_cols = await mrf_schema.json();
    console.log('   Columns:');
    mrf_cols.forEach((c: any) => console.log(`     - ${c.name}: ${c.type}`));

    const mrf_count = await client.query({
      query: `SELECT COUNT(*) as cnt FROM market_resolutions_final`,
      format: 'JSONEachRow'
    });
    const mrf_row_count = await mrf_count.json();
    console.log(`\n   Total rows: ${mrf_row_count[0].cnt.toLocaleString()}`);

    // Sample payout data
    const mrf_sample = await client.query({
      query: `
        SELECT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          winning_index,
          winning_outcome,
          source
        FROM market_resolutions_final
        LIMIT 3
      `,
      format: 'JSONEachRow'
    });
    const mrf_samples = await mrf_sample.json();
    console.log('\n   Sample payout vectors:');
    mrf_samples.forEach((s: any, i: number) => {
      console.log(`     ${i+1}. condition_id: ${s.condition_id_norm}`);
      console.log(`        payout_numerators: [${s.payout_numerators.join(', ')}]`);
      console.log(`        payout_denominator: ${s.payout_denominator}`);
      console.log(`        winning_index: ${s.winning_index}`);
      console.log(`        winning_outcome: ${s.winning_outcome}`);
      console.log(`        source: ${s.source}`);
    });

    // Coverage test for market_resolutions_final
    const mrf_coverage = await client.query({
      query: `
        SELECT
          COUNT(DISTINCT t.condition_id) as total_traded,
          COUNT(DISTINCT CASE
            WHEN r.condition_id_norm IS NOT NULL
            THEN t.condition_id
          END) as resolved,
          COUNT(*) as total_trades,
          SUM(CASE
            WHEN r.condition_id_norm IS NOT NULL
            THEN 1
            ELSE 0
          END) as resolved_trades
        FROM trades_raw t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
        WHERE t.condition_id != ''
      `,
      format: 'JSONEachRow'
    });
    const mrf_cov = await mrf_coverage.json();
    const mrf_cond_pct = ((mrf_cov[0].resolved / mrf_cov[0].total_traded) * 100).toFixed(2);
    const mrf_trade_pct = ((mrf_cov[0].resolved_trades / mrf_cov[0].total_trades) * 100).toFixed(2);

    console.log(`\n   ✓ COVERAGE:`);
    console.log(`     Conditions: ${mrf_cov[0].resolved.toLocaleString()}/${mrf_cov[0].total_traded.toLocaleString()} (${mrf_cond_pct}%)`);
    console.log(`     Trades: ${mrf_cov[0].resolved_trades.toLocaleString()}/${mrf_cov[0].total_trades.toLocaleString()} (${mrf_trade_pct}%)`);

    console.log('\n───────────────────────────────────────────────────────────────\n');

    // Table 2: gamma_resolved
    console.log('2. gamma_resolved');
    console.log('   Description: Gamma API resolved markets (winning outcome only)\n');

    const gr_schema = await client.query({
      query: `DESCRIBE gamma_resolved`,
      format: 'JSONEachRow'
    });
    const gr_cols = await gr_schema.json();
    console.log('   Columns:');
    gr_cols.forEach((c: any) => console.log(`     - ${c.name}: ${c.type}`));

    const gr_count = await client.query({
      query: `SELECT COUNT(*) as cnt FROM gamma_resolved`,
      format: 'JSONEachRow'
    });
    const gr_row_count = await gr_count.json();
    console.log(`\n   Total rows: ${gr_row_count[0].cnt.toLocaleString()}`);

    const gr_sample = await client.query({
      query: `SELECT cid, winning_outcome, closed FROM gamma_resolved LIMIT 3`,
      format: 'JSONEachRow'
    });
    const gr_samples = await gr_sample.json();
    console.log('\n   Sample data:');
    gr_samples.forEach((s: any, i: number) => {
      console.log(`     ${i+1}. cid: ${s.cid}, winning_outcome: ${s.winning_outcome}, closed: ${s.closed}`);
    });

    // Coverage test for gamma_resolved
    const gr_coverage = await client.query({
      query: `
        SELECT
          COUNT(DISTINCT t.condition_id) as total_traded,
          COUNT(DISTINCT CASE
            WHEN r.cid IS NOT NULL
            THEN t.condition_id
          END) as resolved,
          COUNT(*) as total_trades,
          SUM(CASE
            WHEN r.cid IS NOT NULL
            THEN 1
            ELSE 0
          END) as resolved_trades
        FROM trades_raw t
        LEFT JOIN gamma_resolved r
          ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.cid)
        WHERE t.condition_id != ''
      `,
      format: 'JSONEachRow'
    });
    const gr_cov = await gr_coverage.json();
    const gr_cond_pct = ((gr_cov[0].resolved / gr_cov[0].total_traded) * 100).toFixed(2);
    const gr_trade_pct = ((gr_cov[0].resolved_trades / gr_cov[0].total_trades) * 100).toFixed(2);

    console.log(`\n   ✓ COVERAGE:`);
    console.log(`     Conditions: ${gr_cov[0].resolved.toLocaleString()}/${gr_cov[0].total_traded.toLocaleString()} (${gr_cond_pct}%)`);
    console.log(`     Trades: ${gr_cov[0].resolved_trades.toLocaleString()}/${gr_cov[0].total_trades.toLocaleString()} (${gr_trade_pct}%)`);

    console.log('\n───────────────────────────────────────────────────────────────\n');

    // Table 3: ctf_payout_data
    console.log('3. ctf_payout_data');
    console.log('   Description: CTF canonical payout data (blockchain source)\n');

    const ctf_schema = await client.query({
      query: `DESCRIBE ctf_payout_data`,
      format: 'JSONEachRow'
    });
    const ctf_cols = await ctf_schema.json();
    console.log('   Columns:');
    ctf_cols.forEach((c: any) => console.log(`     - ${c.name}: ${c.type}`));

    const ctf_count = await client.query({
      query: `SELECT COUNT(*) as cnt FROM ctf_payout_data`,
      format: 'JSONEachRow'
    });
    const ctf_row_count = await ctf_count.json();
    console.log(`\n   Total rows: ${ctf_row_count[0].cnt.toLocaleString()}`);

    if (ctf_row_count[0].cnt > 0) {
      const ctf_sample = await client.query({
        query: `
          SELECT
            condition_id_norm,
            payout_numerators,
            payout_denominator,
            winning_outcome
          FROM ctf_payout_data
          LIMIT 3
        `,
        format: 'JSONEachRow'
      });
      const ctf_samples = await ctf_sample.json();
      console.log('\n   Sample payout vectors:');
      ctf_samples.forEach((s: any, i: number) => {
        console.log(`     ${i+1}. condition_id: ${s.condition_id_norm}`);
        console.log(`        payout_numerators: [${s.payout_numerators.join(', ')}]`);
        console.log(`        payout_denominator: ${s.payout_denominator}`);
        console.log(`        winning_outcome: ${s.winning_outcome}`);
      });
    }

    console.log('\n───────────────────────────────────────────────────────────────\n');

    // Gap analysis
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  GAP ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const gap_query = await client.query({
      query: `
        SELECT
          COUNT(DISTINCT t.condition_id) as total_conditions,
          COUNT(DISTINCT CASE
            WHEN r.condition_id_norm IS NULL
            THEN t.condition_id
          END) as missing_conditions,
          SUM(CASE WHEN r.condition_id_norm IS NULL THEN 1 ELSE 0 END) as missing_trades,
          COUNT(*) as total_trades
        FROM trades_raw t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
        WHERE t.condition_id != ''
      `,
      format: 'JSONEachRow'
    });
    const gap = await gap_query.json();
    const gap_cond_pct = ((gap[0].missing_conditions / gap[0].total_conditions) * 100).toFixed(2);
    const gap_trade_pct = ((gap[0].missing_trades / gap[0].total_trades) * 100).toFixed(2);

    console.log(`Missing resolution data (using market_resolutions_final):`);
    console.log(`  Conditions without resolution: ${gap[0].missing_conditions.toLocaleString()}/${gap[0].total_conditions.toLocaleString()} (${gap_cond_pct}%)`);
    console.log(`  Trades without resolution: ${gap[0].missing_trades.toLocaleString()}/${gap[0].total_trades.toLocaleString()} (${gap_trade_pct}%)`);

    // Show some missing conditions
    const missing_sample = await client.query({
      query: `
        SELECT DISTINCT
          t.condition_id,
          COUNT(*) as trade_count,
          MIN(t.timestamp) as first_trade,
          MAX(t.timestamp) as last_trade
        FROM trades_raw t
        LEFT JOIN market_resolutions_final r
          ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
        WHERE t.condition_id != ''
          AND r.condition_id_norm IS NULL
        GROUP BY t.condition_id
        ORDER BY trade_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const missing = await missing_sample.json();

    console.log(`\nTop 10 missing conditions by trade volume:`);
    missing.forEach((m: any, i: number) => {
      console.log(`  ${i+1}. ${m.condition_id}`);
      console.log(`     Trades: ${m.trade_count.toLocaleString()}, First: ${m.first_trade}, Last: ${m.last_trade}`);
    });

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  RECOMMENDATIONS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('1. PRIMARY DATA SOURCE:');
    console.log('   ✓ Use: market_resolutions_final');
    console.log(`   ✓ Coverage: ${mrf_cond_pct}% of conditions, ${mrf_trade_pct}% of trades`);
    console.log('   ✓ Has payout vectors: YES (payout_numerators, payout_denominator, winning_index)');
    console.log('   ✓ Join key: condition_id_norm (normalized, no 0x prefix)\n');

    console.log('2. FALLBACK SOURCE:');
    console.log('   ✓ Use: gamma_resolved');
    console.log(`   ✓ Coverage: ${gr_cond_pct}% of conditions, ${gr_trade_pct}% of trades`);
    console.log('   ✗ Has payout vectors: NO (winning_outcome only)');
    console.log('   ℹ Only use when market_resolutions_final lacks data\n');

    console.log('3. DATA GAPS:');
    console.log(`   - ${gap_cond_pct}% of conditions missing resolution`);
    console.log(`   - ${gap_trade_pct}% of trades cannot calculate P&L`);
    console.log('   - Next step: Backfill missing resolutions via Polymarket API or blockchain\n');

    console.log('4. P&L CALCULATION FORMULA:');
    console.log('   pnl_usd = shares * (payout_numerators[winning_index + 1] / payout_denominator) - cost_basis\n');
    console.log('   Note: ClickHouse arrays are 1-indexed, so use arrayElement(payout_numerators, winning_index + 1)\n');

    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

finalResolutionAnalysis();
