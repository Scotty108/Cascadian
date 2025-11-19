import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  try {
    // Simple coverage check
    console.log('V4 preview coverage check...\n');
    const simpleCheck = await clickhouse.query({
      query: `
        SELECT
          count() AS total_trades,
          countIf(length(canonical_condition_id) = 64) AS v4_coverage,
          round(100.0 * v4_coverage / total_trades, 2) AS v4_pct
        FROM vw_trades_canonical_v4_preview
      `,
      format: 'JSONEachRow'
    });

    const simpleData = await simpleCheck.json();
    console.log('Coverage:', JSON.stringify(simpleData, null, 2));

    // Source breakdown
    console.log('\n\nSource breakdown...\n');
    const sourceCheck = await clickhouse.query({
      query: `
        SELECT
          condition_source_v4,
          count() AS trade_count,
          round(100.0 * trade_count / (SELECT count() FROM vw_trades_canonical_v4_preview), 2) AS pct
        FROM vw_trades_canonical_v4_preview
        GROUP BY condition_source_v4
        ORDER BY trade_count DESC
      `,
      format: 'JSONEachRow'
    });

    const sourceData = await sourceCheck.json();
    console.log(JSON.stringify(sourceData, null, 2));

    // Orphan check
    console.log('\n\nOrphan rate...\n');
    const orphanCheck = await clickhouse.query({
      query: `
        SELECT
          countIf(is_orphan = 1) AS orphan_count,
          count() AS total_count,
          round(100.0 * orphan_count / total_count, 2) AS orphan_pct
        FROM vw_trades_canonical_v4_preview
      `,
      format: 'JSONEachRow'
    });

    const orphanData = await orphanCheck.json();
    console.log(JSON.stringify(orphanData, null, 2));

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
