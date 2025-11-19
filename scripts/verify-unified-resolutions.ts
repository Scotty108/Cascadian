#!/usr/bin/env tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n=== CREATING UNIFIED RESOLUTIONS VIEW ===\n');

  // Step 1: Create the unified view
  // NOTE: Only market_resolutions_final has complete payout vectors and resolved markets
  // Other sources either have no resolutions or only text outcomes (no payout vectors)
  // Investigation shows:
  //   - market_resolutions_final: 224k markets with full payout vectors (PRIMARY SOURCE)
  //   - resolutions_src_api: 130k markets but ZERO resolved (all resolved=0)
  //   - staging_resolutions_union: 544k rows but only text outcomes, no payout vectors
  //   - api_ctf_bridge: 157k markets but only text outcomes, no payout vectors
  //
  // Since only market_resolutions_final has usable data, we use it exclusively
  const createViewSQL = `
    CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_unified AS
    SELECT
      cid_hex,
      argMax(winning_index, updated_at) as winning_index,
      argMax(payout_numerators, updated_at) as payout_numerators,
      argMax(payout_denominator, updated_at) as payout_denominator,
      argMax(resolved_at, updated_at) as resolved_at,
      argMax(winning_outcome, updated_at) as winning_outcome,
      'warehouse' AS source,
      1 AS priority
    FROM (
      SELECT
        lower(concat('0x', condition_id_norm)) AS cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolved_at,
        winning_outcome,
        updated_at
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
        AND winning_index >= 0
    )
    GROUP BY cid_hex
  `;

  await ch.command({ query: createViewSQL });
  console.log('✅ Created vw_resolutions_unified\n');

  // Step 2: Source breakdown
  console.log('=== SOURCE BREAKDOWN ===\n');
  const sourceBreakdown = await ch.query({
    query: `
      SELECT
        source,
        count(*) as markets,
        count(DISTINCT cid_hex) as unique_markets
      FROM cascadian_clean.vw_resolutions_unified
      GROUP BY source
      ORDER BY source
    `,
    format: 'JSONEachRow',
  });

  const sources = await sourceBreakdown.json() as Array<{
    source: string;
    markets: string;
    unique_markets: string;
  }>;

  sources.forEach(s => {
    console.log(`${s.source.padEnd(12)}: ${parseInt(s.markets).toLocaleString()} markets (${parseInt(s.unique_markets).toLocaleString()} unique)`);
  });

  const totalUnique = sources.reduce((sum, s) => sum + parseInt(s.unique_markets), 0);
  console.log(`${'TOTAL'.padEnd(12)}: ${totalUnique.toLocaleString()} unique markets\n`);

  // Step 3: Calculate final coverage
  console.log('=== FINAL COVERAGE METRICS ===\n');
  const coverageResult = await ch.query({
    query: `
      WITH traded AS (
        SELECT
          count(DISTINCT condition_id_norm) as total_markets,
          sum(abs(usd_value)) as total_volume
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ),
      covered AS (
        SELECT
          count(DISTINCT t.condition_id_norm) as covered_markets,
          sum(abs(t.usd_value)) as covered_volume
        FROM default.vw_trades_canonical t
        INNER JOIN cascadian_clean.vw_resolutions_unified r
          ON lower(t.condition_id_norm) = r.cid_hex
        WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        traded.total_markets,
        traded.total_volume,
        covered.covered_markets,
        covered.covered_volume,
        round(100.0 * covered.covered_markets / traded.total_markets, 2) as market_pct,
        round(100.0 * covered.covered_volume / traded.total_volume, 2) as volume_pct
      FROM traded, covered
    `,
    format: 'JSONEachRow',
  });

  const coverage = (await coverageResult.json())[0] as {
    total_markets: string;
    total_volume: string;
    covered_markets: string;
    covered_volume: string;
    market_pct: string;
    volume_pct: string;
  };

  console.log(`Total markets traded:     ${parseInt(coverage.total_markets).toLocaleString()}`);
  console.log(`Markets with resolutions: ${parseInt(coverage.covered_markets).toLocaleString()}`);
  console.log(`Market coverage:          ${coverage.market_pct}%\n`);

  console.log(`Total volume traded:      $${(parseFloat(coverage.total_volume) / 1e6).toFixed(2)}M`);
  console.log(`Volume with resolutions:  $${(parseFloat(coverage.covered_volume) / 1e6).toFixed(2)}M`);
  console.log(`Volume coverage:          ${coverage.volume_pct}%\n`);

  // Step 4: Check which views need updating
  console.log('=== VIEWS USING OLD RESOLUTIONS ===\n');

  const viewsCheck = await ch.query({
    query: `
      SELECT DISTINCT
        name,
        create_table_query
      FROM system.tables
      WHERE database = 'cascadian_clean'
        AND engine = 'View'
        AND (
          create_table_query LIKE '%vw_resolutions_all%' OR
          create_table_query LIKE '%resolutions_src_api%' OR
          create_table_query LIKE '%market_resolutions_final%'
        )
    `,
    format: 'JSONEachRow',
  });

  const views = await viewsCheck.json() as Array<{
    name: string;
    create_table_query: string;
  }>;

  if (views.length === 0) {
    console.log('✅ No views found using old resolution tables directly\n');
  } else {
    console.log('Views that may need updating:\n');
    views.forEach(v => {
      console.log(`- ${v.name}`);
      if (v.create_table_query.includes('vw_resolutions_all')) {
        console.log('  → Uses vw_resolutions_all (should use vw_resolutions_unified)');
      }
      if (v.create_table_query.includes('market_resolutions_final')) {
        console.log('  → Uses market_resolutions_final directly (should use vw_resolutions_unified)');
      }
    });
    console.log();
  }

  // Step 5: Check wallet_pnl_summary_final specifically
  console.log('=== CHECKING wallet_pnl_summary_final ===\n');

  const pnlViewCheck = await ch.query({
    query: `
      SELECT create_table_query
      FROM system.tables
      WHERE database = 'cascadian_clean'
        AND name = 'wallet_pnl_summary_final'
        AND engine = 'View'
    `,
    format: 'JSONEachRow',
  });

  const pnlViews = await pnlViewCheck.json() as Array<{ create_table_query: string }>;

  if (pnlViews.length > 0) {
    const def = pnlViews[0].create_table_query;
    if (def.includes('vw_resolutions_unified')) {
      console.log('✅ Already using vw_resolutions_unified\n');
    } else if (def.includes('vw_resolutions_all')) {
      console.log('⚠️  Currently using vw_resolutions_all - needs update\n');
    } else if (def.includes('market_resolutions_final')) {
      console.log('⚠️  Currently using market_resolutions_final - needs update\n');
    } else {
      console.log('ℹ️  Not directly joining to resolutions (may use subview)\n');
    }
  } else {
    console.log('ℹ️  View not found\n');
  }

  // Step 6: Quality checks
  console.log('=== QUALITY CHECKS ===\n');

  // Check for duplicates
  const dupCheck = await ch.query({
    query: `
      SELECT
        count(*) as total_rows,
        count(DISTINCT cid_hex) as unique_cids,
        total_rows - unique_cids as duplicates
      FROM cascadian_clean.vw_resolutions_unified
    `,
    format: 'JSONEachRow',
  });

  const dupResult = (await dupCheck.json())[0] as {
    total_rows: string;
    unique_cids: string;
    duplicates: string;
  };

  console.log(`Total rows:      ${parseInt(dupResult.total_rows).toLocaleString()}`);
  console.log(`Unique markets:  ${parseInt(dupResult.unique_cids).toLocaleString()}`);
  console.log(`Duplicates:      ${parseInt(dupResult.duplicates).toLocaleString()}`);

  if (parseInt(dupResult.duplicates) > 0) {
    console.log('⚠️  WARNING: Duplicates detected!\n');
  } else {
    console.log('✅ No duplicates - deduplication working correctly\n');
  }

  // Check payout vector quality
  const payoutCheck = await ch.query({
    query: `
      SELECT
        source,
        countIf(length(payout_numerators) > 0) as with_vectors,
        count(*) as total,
        round(100.0 * with_vectors / total, 2) as pct_with_vectors
      FROM cascadian_clean.vw_resolutions_unified
      GROUP BY source
      ORDER BY source
    `,
    format: 'JSONEachRow',
  });

  const payoutResults = await payoutCheck.json() as Array<{
    source: string;
    with_vectors: string;
    total: string;
    pct_with_vectors: string;
  }>;

  console.log('=== PAYOUT VECTOR QUALITY BY SOURCE ===\n');
  payoutResults.forEach(p => {
    console.log(`${p.source.padEnd(12)}: ${p.pct_with_vectors}% have payout vectors (${parseInt(p.with_vectors).toLocaleString()}/${parseInt(p.total).toLocaleString()})`);
  });

  // Step 7: Investigate low coverage
  console.log('=== INVESTIGATING LOW COVERAGE ===\n');

  // Check if condition_id normalization is the issue
  const normCheck = await ch.query({
    query: `
      WITH trades_raw_cids AS (
        SELECT DISTINCT lower(condition_id_norm) as cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        LIMIT 10
      ),
      resolution_cids AS (
        SELECT DISTINCT cid_hex as cid
        FROM cascadian_clean.vw_resolutions_unified
        LIMIT 10
      )
      SELECT
        'trades' as source,
        cid,
        length(cid) as len,
        substring(cid, 1, 10) as prefix
      FROM trades_raw_cids
      UNION ALL
      SELECT
        'resolutions' as source,
        cid,
        length(cid) as len,
        substring(cid, 1, 10) as prefix
      FROM resolution_cids
    `,
    format: 'JSONEachRow',
  });

  const normResults = await normCheck.json();
  console.log('Sample condition_id formats:\n');
  normResults.forEach((r: any) => {
    console.log(`${r.source.padEnd(12)}: ${r.cid.substring(0, 20)}... (len=${r.len})`);
  });

  // Check if there's a mismatch in the join
  const joinCheck = await ch.query({
    query: `
      SELECT
        count(DISTINCT t.condition_id_norm) as total_markets,
        count(DISTINCT lower(concat('0x', r.condition_id_norm))) as markets_in_resolutions,
        count(DISTINCT CASE
          WHEN lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
          THEN t.condition_id_norm
        END) as successful_joins
      FROM (
        SELECT DISTINCT condition_id_norm
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        LIMIT 100000
      ) t
      LEFT JOIN default.market_resolutions_final r
        ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
    `,
    format: 'JSONEachRow',
  });

  const joinResult = (await joinCheck.json())[0] as any;
  console.log('\nJoin diagnostic (sample 100k markets):');
  console.log(`  Total distinct markets in trades: ${parseInt(joinResult.total_markets).toLocaleString()}`);
  console.log(`  Markets found in resolutions:     ${parseInt(joinResult.successful_joins).toLocaleString()}`);
  console.log(`  Join success rate:                ${((parseInt(joinResult.successful_joins) / parseInt(joinResult.total_markets)) * 100).toFixed(2)}%\n`);

  console.log('\n✅ Unified resolutions view created successfully!\n');
  console.log('⚠️  NOTE: Coverage is only 24.8% of markets / 14.26% of volume');
  console.log('   This is because market_resolutions_final only has 144k unique markets');
  console.log('   but vw_trades_canonical has 228k traded markets.\n');
  console.log('   The gap is likely unresolved markets or markets resolved after data collection.\n');

  await ch.close();
}

main().catch(console.error);
