import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function main() {
  console.log('='.repeat(80));
  console.log('RESOLUTION COVERAGE DEFINITIVE TRUTH');
  console.log('='.repeat(80));
  console.log();

  // Step 1: Count distinct traded markets
  console.log('STEP 1: TRADED MARKETS BASELINE');
  console.log('-'.repeat(80));
  
  const tradedMarketsQuery = `
    SELECT 
      count(DISTINCT condition_id_norm) as total_condition_ids,
      count(DISTINCT concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00')) as total_markets,
      countIf(condition_id_norm = '' OR condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000') as zero_ids,
      count(*) as total_trades
    FROM default.vw_trades_canonical
  `;
  
  const tradedResult = await client.query({ query: tradedMarketsQuery, format: 'JSONEachRow' });
  const tradedData = await tradedResult.json();
  console.log('Traded Markets:', JSON.stringify(tradedData[0], null, 2));
  console.log();

  // Step 2: Check each resolution source
  const sources = [
    { name: 'market_resolutions_final (all)', table: 'cascadian_clean.market_resolutions_final', filter: '' },
    { name: 'market_resolutions_final (no warehouse)', table: 'cascadian_clean.market_resolutions_final', filter: "WHERE source != 'warehouse'" },
    { name: 'resolutions_src_api', table: 'cascadian_clean.resolutions_src_api', filter: '' },
    { name: 'resolutions_by_cid', table: 'cascadian_clean.resolutions_by_cid', filter: '' },
    { name: 'vw_resolutions_unified', table: 'cascadian_clean.vw_resolutions_unified', filter: '' }
  ];

  console.log('STEP 2: RESOLUTION SOURCE ANALYSIS');
  console.log('-'.repeat(80));

  for (const source of sources) {
    try {
      console.log(`\n>>> ${source.name}`);
      
      const statsQuery = `
        SELECT 
          count(*) as total_rows,
          count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as distinct_condition_ids,
          countIf(payout_denominator > 0) as with_valid_payouts,
          countIf(source != 'warehouse') as non_warehouse_rows
        FROM ${source.table}
        ${source.filter}
      `;
      
      const statsResult = await client.query({ query: statsQuery, format: 'JSONEachRow' });
      const stats = await statsResult.json();
      console.log('Statistics:', JSON.stringify(stats[0], null, 2));

      // Sample rows
      const sampleQuery = `
        SELECT 
          condition_id,
          payout_denominator,
          payout_numerators,
          source,
          winning_index
        FROM ${source.table}
        ${source.filter}
        LIMIT 5
      `;
      
      const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' });
      const samples = await sampleResult.json();
      console.log('Sample rows (showing 3):', JSON.stringify(samples.slice(0, 3), null, 2));
      
    } catch (error: any) {
      console.log(`ERROR querying ${source.name}: ${error.message}`);
    }
  }

  // Step 3: Cross-reference - match traded markets against each source
  console.log('\n');
  console.log('STEP 3: CROSS-REFERENCE COVERAGE');
  console.log('-'.repeat(80));

  const crossRefSources = [
    { name: 'market_resolutions_final (all)', table: 'cascadian_clean.market_resolutions_final', filter: '' },
    { name: 'market_resolutions_final (no warehouse)', table: 'cascadian_clean.market_resolutions_final', filter: "AND r.source != 'warehouse'" },
    { name: 'resolutions_src_api', table: 'cascadian_clean.resolutions_src_api', filter: '' },
    { name: 'resolutions_by_cid', table: 'cascadian_clean.resolutions_by_cid', filter: '' },
    { name: 'vw_resolutions_unified', table: 'cascadian_clean.vw_resolutions_unified', filter: '' }
  ];

  for (const source of crossRefSources) {
    try {
      const coverageQuery = `
        WITH traded_markets AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != '' 
            AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
        SELECT 
          (SELECT count(*) FROM traded_markets) as total_traded_markets,
          count(DISTINCT t.cid_norm) as markets_with_resolution,
          round(count(DISTINCT t.cid_norm) * 100.0 / (SELECT count(*) FROM traded_markets), 2) as coverage_pct
        FROM traded_markets t
        INNER JOIN ${source.table} r 
          ON lower(replaceAll(r.condition_id, '0x', '')) = t.cid_norm
        WHERE r.payout_denominator > 0
          ${source.filter}
      `;
      
      const coverageResult = await client.query({ query: coverageQuery, format: 'JSONEachRow' });
      const coverage = await coverageResult.json();
      console.log(`\n>>> ${source.name}`);
      console.log(JSON.stringify(coverage[0], null, 2));
      
    } catch (error: any) {
      console.log(`\n>>> ${source.name}`);
      console.log(`ERROR: ${error.message}`);
    }
  }

  // Step 4: Final verdict - which source is authoritative?
  console.log('\n');
  console.log('STEP 4: DEFINITIVE VERDICT');
  console.log('='.repeat(80));

  // Check if vw_resolutions_unified is actually a union of all sources
  try {
    const unifiedBreakdownQuery = `
      SELECT 
        source,
        count(*) as row_count,
        count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as distinct_cids
      FROM cascadian_clean.vw_resolutions_unified
      GROUP BY source
      ORDER BY row_count DESC
    `;
    
    const breakdownResult = await client.query({ query: unifiedBreakdownQuery, format: 'JSONEachRow' });
    const breakdown = await breakdownResult.json();
    console.log('\nvw_resolutions_unified breakdown by source:');
    console.log(JSON.stringify(breakdown, null, 2));
    
  } catch (error: any) {
    console.log(`ERROR analyzing unified view: ${error.message}`);
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('END OF ANALYSIS');
  console.log('='.repeat(80));

  await client.close();
}

main().catch(console.error);
