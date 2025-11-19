import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function main() {
  try {
    console.log('Checking V4 table status...\n');

    // Check if table exists
    const tableCheck = await client.query({
      query: `
        SELECT count() AS cnt
        FROM system.tables
        WHERE database = 'default'
          AND name = 'pm_trades_canonical_v4'
      `,
      format: 'JSONEachRow'
    });
    const tableData = await tableCheck.json();

    if (Number(tableData[0].cnt) === 0) {
      console.log('❌ pm_trades_canonical_v4 does NOT exist yet');
      console.log('   Query may still be running on server');
      await client.close();
      return;
    }

    console.log('✓ pm_trades_canonical_v4 EXISTS\n');

    // Get row count
    const count = await client.query({
      query: 'SELECT count() AS cnt FROM pm_trades_canonical_v4',
      format: 'JSONEachRow'
    });
    const countData = await count.json();
    console.log(`Total rows: ${Number(countData[0].cnt).toLocaleString()}\n`);

    // Coverage stats
    const coverage = await client.query({
      query: `
        SELECT
          count() AS total_trades,
          countIf(length(condition_id_norm_v4) = 64) AS v4_covered,
          round(100.0 * v4_covered / total_trades, 2) AS v4_coverage_pct,
          countIf(length(condition_id_norm_v3) = 64) AS v3_covered,
          round(100.0 * v3_covered / total_trades, 2) AS v3_coverage_pct,
          round(v4_coverage_pct - v3_coverage_pct, 2) AS coverage_gain
        FROM pm_trades_canonical_v4
      `,
      format: 'JSONEachRow'
    });
    const coverageData = await coverage.json();

    console.log('COVERAGE COMPARISON:');
    console.log(`  V3 coverage: ${coverageData[0].v3_coverage_pct}% (${Number(coverageData[0].v3_covered).toLocaleString()} trades)`);
    console.log(`  V4 coverage: ${coverageData[0].v4_coverage_pct}% (${Number(coverageData[0].v4_covered).toLocaleString()} trades)`);
    console.log(`  Gain: +${coverageData[0].coverage_gain}%\n`);

    // Repair source breakdown
    const breakdown = await client.query({
      query: `
        SELECT
          condition_source_v4,
          count() AS cnt,
          round(count() * 100.0 / (SELECT count() FROM pm_trades_canonical_v4 WHERE length(condition_id_norm_v4) = 64), 2) AS pct
        FROM pm_trades_canonical_v4
        WHERE length(condition_id_norm_v4) = 64
        GROUP BY condition_source_v4
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow'
    });
    const breakdownData = await breakdown.json();

    console.log('COVERAGE BY SOURCE:');
    breakdownData.forEach(row => {
      console.log(`  ${row.condition_source_v4}: ${Number(row.cnt).toLocaleString()} (${row.pct}%)`);
    });

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
