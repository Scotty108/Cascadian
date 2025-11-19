import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function executePhaseB() {
  console.log('='.repeat(80));
  console.log('PHASE B.1: TEST MONTH - trades_with_direction REPAIRS');
  console.log('='.repeat(80));

  // Step 1: Identify remaining orphans in Oct 2024
  console.log('\n[Step 1] Creating orphan list for Oct 2024...');
  await client.command({
    query: `
      DROP TABLE IF EXISTS tmp_v4_phase_b_test_month_orphans
    `
  });

  await client.command({
    query: `
      CREATE TABLE tmp_v4_phase_b_test_month_orphans
      ENGINE = MergeTree()
      ORDER BY trade_id
      AS
      SELECT
        trade_id,
        transaction_hash,
        wallet_address,
        outcome_index_v3,
        timestamp,
        shares,
        usd_value
      FROM pm_trades_canonical_v3
      WHERE toYYYYMM(timestamp) = 202410
        AND transaction_hash NOT IN (
          SELECT transaction_hash FROM pm_v4_repair_map WHERE repair_source = 'pm_trades'
        )
        AND (
          condition_id_norm_v3 IS NULL
          OR condition_id_norm_v3 = ''
          OR length(condition_id_norm_v3) != 64
        )
    `
  });

  const orphanCount = await client.query({
    query: 'SELECT count() AS cnt FROM tmp_v4_phase_b_test_month_orphans',
    format: 'JSONEachRow'
  });
  const orphans = await orphanCount.json();
  console.log(`✓ Oct 2024 orphans (after Phase A): ${orphans[0].cnt}`);

  // Step 2: Build Phase B repair map for test month
  console.log('\n[Step 2] Building Phase B repair map from trades_with_direction...');
  await client.command({
    query: `DROP TABLE IF EXISTS tmp_v4_phase_b_twd_repairs_202410`
  });

  await client.command({
    query: `
      CREATE TABLE tmp_v4_phase_b_twd_repairs_202410
      ENGINE = MergeTree()
      ORDER BY transaction_hash
      AS
      SELECT
        o.trade_id,
        o.transaction_hash,
        twd.condition_id_norm AS repair_condition_id,
        twd.outcome_index AS repair_outcome_index,
        'trades_with_direction' AS repair_source,
        'HIGH' AS repair_confidence
      FROM tmp_v4_phase_b_test_month_orphans o
      INNER JOIN trades_with_direction twd
        ON o.transaction_hash = twd.tx_hash
      WHERE length(twd.condition_id_norm) = 64
        AND twd.condition_id_norm IS NOT NULL
        AND twd.confidence = 'HIGH'
      GROUP BY o.transaction_hash, o.trade_id, twd.condition_id_norm, twd.outcome_index
      HAVING count(DISTINCT twd.condition_id_norm) = 1
    `
  });

  // Step 3: Measure test month coverage
  console.log('\n[Step 3] Measuring Phase B test month coverage...');
  const coverage = await client.query({
    query: `
      SELECT
        (SELECT count() FROM tmp_v4_phase_b_test_month_orphans) AS remaining_orphans_202410,
        count() AS phase_b_repairs,
        round(100.0 * phase_b_repairs / remaining_orphans_202410, 2) AS phase_b_coverage_pct
      FROM tmp_v4_phase_b_twd_repairs_202410
    `,
    format: 'JSONEachRow'
  });
  const coverageData = await coverage.json();
  console.log(`✓ Phase B repairs: ${coverageData[0].phase_b_repairs}`);
  console.log(`✓ Phase B coverage of remaining orphans: ${coverageData[0].phase_b_coverage_pct}%`);

  return coverageData[0];
}

async function validatePhaseB() {
  console.log('\n' + '='.repeat(80));
  console.log('PHASE B.2: VALIDATE PHASE B TEST MONTH');
  console.log('='.repeat(80));

  // Validation 1: Format validation
  console.log('\n[Validation 1] Format validation...');
  const formatCheck = await client.query({
    query: `
      SELECT
        countIf(length(repair_condition_id) != 64) AS wrong_length,
        countIf(repair_condition_id LIKE '%0x%') AS has_prefix,
        countIf(repair_condition_id != lower(repair_condition_id)) AS not_lowercase,
        countIf(repair_condition_id = '0000000000000000000000000000000000000000000000000000000000000000') AS zero_id
      FROM tmp_v4_phase_b_twd_repairs_202410
    `,
    format: 'JSONEachRow'
  });
  const formatData = await formatCheck.json();
  console.log('Format issues:', formatData[0]);

  const formatValid = Object.values(formatData[0]).every(v => v === 0 || v === '0');
  if (!formatValid) {
    throw new Error('❌ Format validation FAILED - see issues above');
  }
  console.log('✓ Format validation PASSED');

  // Validation 2: Market existence
  console.log('\n[Validation 2] Market existence check...');
  const marketCheck = await client.query({
    query: `
      SELECT
        count() AS total_repairs,
        countIf(repair_condition_id IN (SELECT DISTINCT condition_id_norm FROM dim_markets)) AS has_market,
        round(100.0 * has_market / total_repairs, 2) AS market_match_pct
      FROM tmp_v4_phase_b_twd_repairs_202410
    `,
    format: 'JSONEachRow'
  });
  const marketData = await marketCheck.json();
  console.log(`Market matches: ${marketData[0].has_market} / ${marketData[0].total_repairs} (${marketData[0].market_match_pct}%)`);

  if (parseFloat(marketData[0].market_match_pct) < 95.0) {
    console.warn(`⚠️  Market match rate below 95%: ${marketData[0].market_match_pct}%`);
  } else {
    console.log('✓ Market existence validation PASSED');
  }

  // Validation 3: No overlap with Phase A
  console.log('\n[Validation 3] Checking overlap with Phase A...');
  const overlapCheck = await client.query({
    query: `
      SELECT count() AS overlap_count
      FROM tmp_v4_phase_b_twd_repairs_202410
      WHERE transaction_hash IN (SELECT transaction_hash FROM pm_v4_repair_map)
    `,
    format: 'JSONEachRow'
  });
  const overlapData = await overlapCheck.json();

  if (Number(overlapData[0].overlap_count) > 0) {
    throw new Error(`❌ Found ${overlapData[0].overlap_count} overlaps with Phase A - should be 0`);
  }
  console.log('✓ No overlap with Phase A - PASSED');

  return {
    formatValid,
    marketMatchPct: parseFloat(marketData[0].market_match_pct),
    noOverlap: true
  };
}

async function scaleToGlobal() {
  console.log('\n' + '='.repeat(80));
  console.log('PHASE B.3: SCALE TO GLOBAL');
  console.log('='.repeat(80));

  console.log('\n[Building] Global Phase B repair map...');
  await client.command({
    query: `DROP TABLE IF EXISTS tmp_v4_phase_b_twd_repairs_global`
  });

  await client.command({
    query: `
      CREATE TABLE tmp_v4_phase_b_twd_repairs_global
      ENGINE = MergeTree()
      ORDER BY transaction_hash
      AS
      SELECT
        o.trade_id,
        o.transaction_hash,
        twd.condition_id_norm AS repair_condition_id,
        twd.outcome_index AS repair_outcome_index,
        'trades_with_direction' AS repair_source,
        'HIGH' AS repair_confidence,
        now() AS created_at
      FROM pm_trades_canonical_v3 o
      INNER JOIN trades_with_direction twd
        ON o.transaction_hash = twd.tx_hash
      WHERE o.transaction_hash NOT IN (
          SELECT transaction_hash FROM pm_v4_repair_map WHERE repair_source = 'pm_trades'
        )
        AND (
          o.condition_id_norm_v3 IS NULL
          OR o.condition_id_norm_v3 = ''
          OR length(o.condition_id_norm_v3) != 64
        )
        AND length(twd.condition_id_norm) = 64
        AND twd.condition_id_norm IS NOT NULL
        AND twd.confidence = 'HIGH'
      GROUP BY o.transaction_hash, o.trade_id, twd.condition_id_norm, twd.outcome_index
      HAVING count(DISTINCT twd.condition_id_norm) = 1
    `
  });

  const globalCount = await client.query({
    query: 'SELECT count() AS cnt FROM tmp_v4_phase_b_twd_repairs_global',
    format: 'JSONEachRow'
  });
  const globalData = await globalCount.json();
  console.log(`✓ Global Phase B repairs created: ${globalData[0].cnt}`);

  return Number(globalData[0].cnt);
}

async function updateRepairMap() {
  console.log('\n' + '='.repeat(80));
  console.log('PHASE B.4: UPDATE pm_v4_repair_map');
  console.log('='.repeat(80));

  console.log('\n[Inserting] Phase B repairs into pm_v4_repair_map...');

  // Get count before
  const beforeCount = await client.query({
    query: 'SELECT count() AS cnt FROM pm_v4_repair_map',
    format: 'JSONEachRow'
  });
  const before = await beforeCount.json();
  console.log(`Before: ${before[0].cnt} repairs`);

  await client.command({
    query: `
      INSERT INTO pm_v4_repair_map
      SELECT * FROM tmp_v4_phase_b_twd_repairs_global
    `
  });

  // Get count after
  const afterCount = await client.query({
    query: 'SELECT count() AS cnt FROM pm_v4_repair_map',
    format: 'JSONEachRow'
  });
  const after = await afterCount.json();
  console.log(`After: ${after[0].cnt} repairs`);
  console.log(`✓ Added: ${Number(after[0].cnt) - Number(before[0].cnt)} repairs`);

  // Show breakdown by source
  console.log('\n[Breakdown] Repair sources:');
  const breakdown = await client.query({
    query: `
      SELECT
        repair_source,
        count() AS repair_count,
        round(count() * 100.0 / (SELECT count() FROM pm_v4_repair_map), 2) AS pct_of_total
      FROM pm_v4_repair_map
      GROUP BY repair_source
      ORDER BY repair_count DESC
    `,
    format: 'JSONEachRow'
  });
  const breakdownData = await breakdown.json();
  breakdownData.forEach(row => {
    console.log(`  ${row.repair_source}: ${row.repair_count} (${row.pct_of_total}%)`);
  });

  return breakdownData;
}

async function main() {
  try {
    console.log('Starting Phase B Execution...\n');

    const testResults = await executePhaseB();
    const validationResults = await validatePhaseB();

    console.log('\n' + '='.repeat(80));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Format validation: ${validationResults.formatValid ? '✓ PASS' : '❌ FAIL'}`);
    console.log(`Market match rate: ${validationResults.marketMatchPct}% ${validationResults.marketMatchPct >= 95 ? '✓ PASS' : '⚠️  WARN'}`);
    console.log(`No Phase A overlap: ${validationResults.noOverlap ? '✓ PASS' : '❌ FAIL'}`);

    if (!validationResults.formatValid || !validationResults.noOverlap) {
      throw new Error('Validation failed - stopping before global scale');
    }

    console.log('\n✓ All validations passed - proceeding to global scale');

    const globalRepairCount = await scaleToGlobal();
    const repairBreakdown = await updateRepairMap();

    console.log('\n' + '='.repeat(80));
    console.log('PHASE B COMPLETE');
    console.log('='.repeat(80));
    console.log(`Test month coverage improvement: ${testResults.phase_b_coverage_pct}%`);
    console.log(`Global Phase B repairs: ${globalRepairCount}`);
    console.log(`Total repairs in map: ${repairBreakdown.reduce((sum, r) => sum + Number(r.repair_count), 0)}`);

    await client.close();
  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
