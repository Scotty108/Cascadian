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
    console.log('V3 VS V4 COVERAGE ANALYSIS (using repair map)');
    console.log('='.repeat(80));

    // Global coverage comparison
    console.log('\n[1] GLOBAL COVERAGE COMPARISON\n');

    const globalV3 = await client.query({
      query: `
        SELECT
          count() AS total_trades,
          countIf(length(condition_id_norm_v3) = 64) AS has_cid,
          round(100.0 * has_cid / total_trades, 2) AS coverage_pct
        FROM pm_trades_canonical_v3
      `,
      format: 'JSONEachRow'
    });
    const v3Data = await globalV3.json();

    const v4Estimate = await client.query({
      query: `
        SELECT
          (SELECT count() FROM pm_trades_canonical_v3) AS total_trades,
          (SELECT countIf(length(condition_id_norm_v3) = 64) FROM pm_trades_canonical_v3) +
          (SELECT count() FROM pm_v4_repair_map) AS has_cid_v4_estimate
      `,
      format: 'JSONEachRow'
    });
    const v4Data = await v4Estimate.json();
    const v4Coverage = (Number(v4Data[0].has_cid_v4_estimate) / Number(v4Data[0].total_trades) * 100).toFixed(2);

    console.log('Version | Total Trades | Covered Trades | Coverage % | Orphans');
    console.log('-'.repeat(75));
    console.log(`V3      | ${Number(v3Data[0].total_trades).toLocaleString().padStart(12)} | ${Number(v3Data[0].has_cid).toLocaleString().padStart(14)} | ${v3Data[0].coverage_pct.toString().padStart(10)} | ${(Number(v3Data[0].total_trades) - Number(v3Data[0].has_cid)).toLocaleString()}`);
    console.log(`V4 (est)| ${Number(v4Data[0].total_trades).toLocaleString().padStart(12)} | ${Number(v4Data[0].has_cid_v4_estimate).toLocaleString().padStart(14)} | ${v4Coverage.padStart(10)} | ${(Number(v4Data[0].total_trades) - Number(v4Data[0].has_cid_v4_estimate)).toLocaleString()}`);
    console.log('-'.repeat(75));
    console.log(`\nV4 Improvement: +${(Number(v4Coverage) - Number(v3Data[0].coverage_pct)).toFixed(2)}%`);
    console.log(`Orphans Repaired: ${Number(v4Data[0].has_cid_v4_estimate) - Number(v3Data[0].has_cid).toLocaleString()}`);

    // Repair map breakdown
    console.log('\n[2] REPAIR MAP BREAKDOWN\n');

    const repairBreakdown = await client.query({
      query: `
        SELECT
          repair_source,
          count() AS cnt,
          round(count() * 100.0 / (SELECT count() FROM pm_v4_repair_map), 2) AS pct_of_repairs
        FROM pm_v4_repair_map
        GROUP BY repair_source
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow'
    });
    const repairData = await repairBreakdown.json();

    console.log('Source                  | Repairs      | % of Total Repairs');
    console.log('-'.repeat(65));
    repairData.forEach(row => {
      console.log(`${row.repair_source.padEnd(24)}| ${Number(row.cnt).toLocaleString().padStart(12)} | ${row.pct_of_repairs.toString().padStart(18)}`);
    });
    console.log('-'.repeat(65));
    const totalRepairs = repairData.reduce((sum, r) => sum + Number(r.cnt), 0);
    console.log(`${'TOTAL'.padEnd(24)}| ${totalRepairs.toLocaleString().padStart(12)} | ${' 100.00'.padStart(18)}`);

    // Monthly breakdown
    console.log('\n[3] MONTHLY COVERAGE BREAKDOWN\n');

    const monthly = await client.query({
      query: `
        SELECT
          toYYYYMM(t.timestamp) AS month,
          count() AS total_trades,
          countIf(length(t.condition_id_norm_v3) = 64) AS v3_covered,
          round(100.0 * v3_covered / total_trades, 2) AS v3_coverage_pct,
          countIf(t.transaction_hash IN (SELECT transaction_hash FROM pm_v4_repair_map)) AS v4_repairs_applied,
          countIf(
            length(t.condition_id_norm_v3) = 64
            OR t.transaction_hash IN (SELECT transaction_hash FROM pm_v4_repair_map)
          ) AS v4_covered_estimate,
          round(100.0 * v4_covered_estimate / total_trades, 2) AS v4_coverage_pct,
          round(v4_coverage_pct - v3_coverage_pct, 2) AS gain_pct
        FROM pm_trades_canonical_v3 t
        GROUP BY month
        ORDER BY month
      `,
      format: 'JSONEachRow'
    });
    const monthlyData = await monthly.json();

    console.log('Month   | Total Trades | V3 Cov % | V4 Cov % | Gain %   | Repairs');
    console.log('-'.repeat(75));
    monthlyData.forEach(row => {
      console.log(
        `${row.month.toString().padEnd(8)}| ${Number(row.total_trades).toLocaleString().padStart(12)} | ` +
        `${row.v3_coverage_pct.toString().padStart(8)} | ${row.v4_coverage_pct.toString().padStart(8)} | ` +
        `${row.gain_pct.toString().padStart(8)} | ${Number(row.v4_repairs_applied).toLocaleString()}`
      );
    });
    console.log('-'.repeat(75));

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
