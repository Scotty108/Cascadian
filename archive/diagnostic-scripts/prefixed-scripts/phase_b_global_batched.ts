import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function getMonthsToProcess() {
  const result = await client.query({
    query: `
      SELECT DISTINCT toYYYYMM(timestamp) AS month
      FROM pm_trades_canonical_v3
      WHERE (
        condition_id_norm_v3 IS NULL
        OR condition_id_norm_v3 = ''
        OR length(condition_id_norm_v3) != 64
      )
      AND transaction_hash NOT IN (
        SELECT transaction_hash FROM pm_v4_repair_map WHERE repair_source = 'pm_trades'
      )
      ORDER BY month
    `,
    format: 'JSONEachRow'
  });
  const months = await result.json();
  return months.map(m => m.month);
}

async function processMonth(month: string) {
  console.log(`\n[Processing] Month ${month}...`);

  const startTime = Date.now();

  // Get month orphan count
  const orphanResult = await client.query({
    query: `
      SELECT count() AS cnt
      FROM pm_trades_canonical_v3
      WHERE toYYYYMM(timestamp) = ${month}
        AND transaction_hash NOT IN (
          SELECT transaction_hash FROM pm_v4_repair_map WHERE repair_source = 'pm_trades'
        )
        AND (
          condition_id_norm_v3 IS NULL
          OR condition_id_norm_v3 = ''
          OR length(condition_id_norm_v3) != 64
        )
    `,
    format: 'JSONEachRow'
  });
  const orphanData = await orphanResult.json();
  const orphanCount = Number(orphanData[0].cnt);

  if (orphanCount === 0) {
    console.log(`  ✓ No orphans for ${month}, skipping`);
    return { month, orphans: 0, repairs: 0, duration: 0 };
  }

  // Insert repairs for this month directly into global table
  await client.command({
    query: `
      INSERT INTO tmp_v4_phase_b_twd_repairs_global
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
      WHERE toYYYYMM(o.timestamp) = ${month}
        AND o.transaction_hash NOT IN (
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
    `,
    clickhouse_settings: {
      max_execution_time: 300 // 5 minutes per month
    }
  });

  // Get repair count for this month
  const repairResult = await client.query({
    query: `
      SELECT count() AS cnt
      FROM tmp_v4_phase_b_twd_repairs_global
      WHERE toYYYYMM(created_at) = toYYYYMM(now())
    `,
    format: 'JSONEachRow'
  });
  const repairData = await repairResult.json();
  const repairCount = Number(repairData[0].cnt);

  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log(`  ✓ ${month}: ${repairCount} repairs for ${orphanCount} orphans (${duration}s)`);

  return {
    month,
    orphans: orphanCount,
    repairs: repairCount,
    duration
  };
}

async function main() {
  try {
    console.log('='.repeat(80));
    console.log('PHASE B.3: BATCHED GLOBAL SCALE (Month-by-Month)');
    console.log('='.repeat(80));

    // Create empty global table
    console.log('\n[Setup] Creating global table...');
    await client.command({
      query: `DROP TABLE IF EXISTS tmp_v4_phase_b_twd_repairs_global`
    });

    await client.command({
      query: `
        CREATE TABLE tmp_v4_phase_b_twd_repairs_global (
          trade_id String,
          transaction_hash String,
          repair_condition_id String,
          repair_outcome_index UInt8,
          repair_source String,
          repair_confidence String,
          created_at DateTime
        )
        ENGINE = MergeTree()
        ORDER BY transaction_hash
      `
    });

    console.log('✓ Global table created');

    // Get months to process
    console.log('\n[Scanning] Identifying months with orphans...');
    const months = await getMonthsToProcess();
    console.log(`✓ Found ${months.length} months to process`);

    // Process each month
    const results = [];
    for (const month of months) {
      const result = await processMonth(month);
      results.push(result);

      // Small delay between months to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('BATCHED PROCESSING COMPLETE');
    console.log('='.repeat(80));

    const totalOrphans = results.reduce((sum, r) => sum + r.orphans, 0);
    const totalRepairs = results.reduce((sum, r) => sum + r.repairs, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    console.log(`\nTotal orphans across all months: ${totalOrphans.toLocaleString()}`);
    console.log(`Total repairs generated: ${totalRepairs.toLocaleString()}`);
    console.log(`Total processing time: ${totalDuration}s (${Math.round(totalDuration / 60)} minutes)`);
    console.log(`Coverage: ${((totalRepairs / totalOrphans) * 100).toFixed(2)}%`);

    // Verify final count
    const finalCount = await client.query({
      query: 'SELECT count() AS cnt FROM tmp_v4_phase_b_twd_repairs_global',
      format: 'JSONEachRow'
    });
    const finalData = await finalCount.json();
    console.log(`\nFinal table row count: ${Number(finalData[0].cnt).toLocaleString()}`);

    // Monthly breakdown
    console.log('\n' + '-'.repeat(60));
    console.log('MONTHLY BREAKDOWN');
    console.log('-'.repeat(60));
    console.log('Month     | Orphans    | Repairs    | Coverage | Time');
    console.log('-'.repeat(60));
    results.forEach(r => {
      const coverage = r.orphans > 0 ? ((r.repairs / r.orphans) * 100).toFixed(1) : '0.0';
      console.log(
        `${r.month.toString().padEnd(10)}| ${r.orphans.toString().padStart(10)} | ` +
        `${r.repairs.toString().padStart(10)} | ${coverage.padStart(7)}% | ${r.duration}s`
      );
    });
    console.log('-'.repeat(60));

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
