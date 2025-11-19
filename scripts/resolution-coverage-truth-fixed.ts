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
      countIf(condition_id_norm = '' OR condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000') as zero_or_empty_ids,
      countIf(condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as valid_condition_ids,
      count(DISTINCT if(
        condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000',
        condition_id_norm,
        NULL
      )) as distinct_valid_cids,
      count(*) as total_trades,
      sum(usd_value) as total_volume
    FROM default.vw_trades_canonical
  `;
  
  const tradedResult = await client.query({ query: tradedMarketsQuery, format: 'JSONEachRow' });
  const tradedData = await tradedResult.json();
  console.log('Traded Markets:', JSON.stringify(tradedData[0], null, 2));
  console.log();

  // Step 2: Check each resolution source
  const sources = [
    { name: 'resolutions_src_api (all)', table: 'cascadian_clean.resolutions_src_api', filter: '' },
    { name: 'resolutions_src_api (resolved only)', table: 'cascadian_clean.resolutions_src_api', filter: "WHERE resolved = 1" },
    { name: 'resolutions_src_api (valid payout)', table: 'cascadian_clean.resolutions_src_api', filter: "WHERE payout_denominator > 0" },
    { name: 'resolutions_by_cid', table: 'cascadian_clean.resolutions_by_cid', filter: '' },
    { name: 'vw_resolutions_unified (all)', table: 'cascadian_clean.vw_resolutions_unified', filter: '' },
    { name: 'vw_resolutions_unified (no warehouse)', table: 'cascadian_clean.vw_resolutions_unified', filter: "WHERE source != 'warehouse'" }
  ];

  console.log('STEP 2: RESOLUTION SOURCE ANALYSIS');
  console.log('-'.repeat(80));

  for (const source of sources) {
    try {
      console.log(`\n>>> ${source.name}`);
      
      const statsQuery = `
        SELECT 
          count(*) as total_rows,
          count(DISTINCT lower(replaceAll(cid_hex, '0x', ''))) as distinct_condition_ids
        FROM ${source.table}
        ${source.filter}
      `;
      
      const statsResult = await client.query({ query: statsQuery, format: 'JSONEachRow' });
      const stats = await statsResult.json();
      console.log(JSON.stringify(stats[0], null, 2));
      
    } catch (error: any) {
      console.log(`ERROR: ${error.message}`);
    }
  }

  // Step 3: Cross-reference - match traded markets against each source
  console.log('\n');
  console.log('STEP 3: CROSS-REFERENCE COVERAGE');
  console.log('-'.repeat(80));

  const crossRefSources = [
    { name: 'resolutions_src_api (all)', table: 'cascadian_clean.resolutions_src_api', filter: '' },
    { name: 'resolutions_src_api (resolved=1)', table: 'cascadian_clean.resolutions_src_api', filter: "AND r.resolved = 1" },
    { name: 'resolutions_src_api (valid payout)', table: 'cascadian_clean.resolutions_src_api', filter: "AND r.payout_denominator > 0" },
    { name: 'resolutions_by_cid', table: 'cascadian_clean.resolutions_by_cid', filter: '' },
    { name: 'vw_resolutions_unified (all)', table: 'cascadian_clean.vw_resolutions_unified', filter: '' },
    { name: 'vw_resolutions_unified (no warehouse)', table: 'cascadian_clean.vw_resolutions_unified', filter: "AND r.source != 'warehouse'" }
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
          ON lower(replaceAll(r.cid_hex, '0x', '')) = t.cid_norm
        WHERE 1=1
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

  // Step 4: Check source breakdown in unified view
  console.log('\n');
  console.log('STEP 4: UNIFIED VIEW SOURCE BREAKDOWN');
  console.log('='.repeat(80));

  try {
    const breakdownQuery = `
      SELECT 
        source,
        count(*) as row_count,
        count(DISTINCT lower(replaceAll(cid_hex, '0x', ''))) as distinct_cids
      FROM cascadian_clean.vw_resolutions_unified
      GROUP BY source
      ORDER BY distinct_cids DESC
    `;
    
    const breakdownResult = await client.query({ query: breakdownQuery, format: 'JSONEachRow' });
    const breakdown = await breakdownResult.json();
    console.log('\nvw_resolutions_unified breakdown by source:');
    console.log(JSON.stringify(breakdown, null, 2));
    
  } catch (error: any) {
    console.log(`ERROR: ${error.message}`);
  }

  // Step 5: Volume-weighted coverage
  console.log('\n');
  console.log('STEP 5: VOLUME-WEIGHTED COVERAGE');
  console.log('='.repeat(80));

  try {
    const volumeQuery = `
      WITH traded_markets AS (
        SELECT 
          lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
          sum(usd_value) as total_volume
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '' 
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY cid_norm
      ),
      with_resolution AS (
        SELECT 
          t.cid_norm,
          t.total_volume
        FROM traded_markets t
        INNER JOIN cascadian_clean.vw_resolutions_unified r
          ON lower(replaceAll(r.cid_hex, '0x', '')) = t.cid_norm
      )
      SELECT 
        (SELECT count(*) FROM traded_markets) as total_markets,
        (SELECT count(*) FROM with_resolution) as markets_with_resolution,
        (SELECT sum(total_volume) FROM traded_markets) as total_volume,
        (SELECT sum(total_volume) FROM with_resolution) as volume_with_resolution,
        round((SELECT sum(total_volume) FROM with_resolution) * 100.0 / (SELECT sum(total_volume) FROM traded_markets), 2) as volume_coverage_pct
    `;
    
    const volumeResult = await client.query({ query: volumeQuery, format: 'JSONEachRow' });
    const volumeData = await volumeResult.json();
    console.log('\nVolume-weighted coverage:');
    console.log(JSON.stringify(volumeData[0], null, 2));
    
  } catch (error: any) {
    console.log(`ERROR: ${error.message}`);
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('FINAL VERDICT');
  console.log('='.repeat(80));
  console.log('See analysis above for definitive coverage numbers.');
  console.log('Key metrics:');
  console.log('- Total traded markets (distinct non-zero condition IDs)');
  console.log('- Markets with resolutions in each source');
  console.log('- Coverage percentage by count and by volume');
  console.log('='.repeat(80));

  await client.close();
}

main().catch(console.error);
