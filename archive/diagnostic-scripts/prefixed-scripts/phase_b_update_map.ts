import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function main() {
  try {
    console.log('='.repeat(80));
    console.log('PHASE B.4: UPDATE pm_v4_repair_map');
    console.log('='.repeat(80));

    // Get count before
    console.log('\n[Before] Current pm_v4_repair_map state...');
    const beforeCount = await client.query({
      query: 'SELECT count() AS cnt FROM pm_v4_repair_map',
      format: 'JSONEachRow'
    });
    const before = await beforeCount.json();
    console.log(`  Total repairs: ${Number(before[0].cnt).toLocaleString()}`);

    const beforeBreakdown = await client.query({
      query: `
        SELECT
          repair_source,
          count() AS cnt
        FROM pm_v4_repair_map
        GROUP BY repair_source
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow'
    });
    const beforeData = await beforeBreakdown.json();
    console.log('\n  By source:');
    beforeData.forEach(row => {
      console.log(`    ${row.repair_source}: ${Number(row.cnt).toLocaleString()}`);
    });

    // Check global table
    console.log('\n[Check] tmp_v4_phase_b_twd_repairs_global...');
    const globalCount = await client.query({
      query: 'SELECT count() AS cnt FROM tmp_v4_phase_b_twd_repairs_global',
      format: 'JSONEachRow'
    });
    const globalData = await globalCount.json();
    console.log(`  Repairs to add: ${Number(globalData[0].cnt).toLocaleString()}`);

    // Check for duplicates
    console.log('\n[Validation] Checking for duplicates with Phase A...');
    const dupCheck = await client.query({
      query: `
        SELECT count() AS cnt
        FROM tmp_v4_phase_b_twd_repairs_global
        WHERE transaction_hash IN (SELECT transaction_hash FROM pm_v4_repair_map)
      `,
      format: 'JSONEachRow'
    });
    const dupData = await dupCheck.json();
    const dupCount = Number(dupData[0].cnt);
    console.log(`  Duplicates found: ${dupCount.toLocaleString()}`);

    if (dupCount > 0) {
      console.log('  ⚠️  WARNING: Duplicates detected - will be handled by ReplacingMergeTree');
    }

    // Insert Phase B repairs
    console.log('\n[Inserting] Adding Phase B repairs to pm_v4_repair_map...');
    await client.command({
      query: `
        INSERT INTO pm_v4_repair_map
        SELECT * FROM tmp_v4_phase_b_twd_repairs_global
      `
    });
    console.log('  ✓ Insert complete');

    // Get count after
    console.log('\n[After] Updated pm_v4_repair_map state...');
    const afterCount = await client.query({
      query: 'SELECT count() AS cnt FROM pm_v4_repair_map',
      format: 'JSONEachRow'
    });
    const after = await afterCount.json();
    console.log(`  Total repairs: ${Number(after[0].cnt).toLocaleString()}`);

    const afterBreakdown = await client.query({
      query: `
        SELECT
          repair_source,
          count() AS cnt,
          round(count() * 100.0 / (SELECT count() FROM pm_v4_repair_map), 2) AS pct
        FROM pm_v4_repair_map
        GROUP BY repair_source
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow'
    });
    const afterData = await afterBreakdown.json();
    console.log('\n  By source:');
    afterData.forEach(row => {
      console.log(`    ${row.repair_source}: ${Number(row.cnt).toLocaleString()} (${row.pct}%)`);
    });

    const added = Number(after[0].cnt) - Number(before[0].cnt);
    console.log(`\n  ✓ Added: ${added.toLocaleString()} repairs`);

    console.log('\n' + '='.repeat(80));
    console.log('pm_v4_repair_map UPDATE COMPLETE');
    console.log('='.repeat(80));

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
