#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';
import { writeFileSync } from 'fs';

const PHASE1_TESTED_PARTITIONS = [202301, 202309, 202312, 202401, 202405, 202407, 202409, 202411, 202412, 202501, 202502];

async function main() {
  console.log('🔍 Discovering all partitions in pm_trades_canonical_v2...\n');

  const query = `
    SELECT
      toYYYYMM(timestamp) AS partition,
      COUNT(*) AS row_count,
      uniqExact(trade_id) AS unique_trade_ids,

      -- V2 coverage metrics
      countIf(
        condition_id_norm_v2 IS NOT NULL
        AND condition_id_norm_v2 != ''
        AND condition_id_norm_v2 != '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v2_valid,
      countIf(
        condition_id_norm_v2 IS NULL
        OR condition_id_norm_v2 = ''
        OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000'
      ) AS v2_orphans,
      ROUND(100.0 * v2_valid / row_count, 2) AS v2_coverage_pct

    FROM pm_trades_canonical_v2
    GROUP BY partition
    ORDER BY partition
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  console.log(`Found ${data.length} partitions in pm_trades_canonical_v2\n`);

  // Build markdown report
  let report = `# PM Trades Canonical V2 - Partition Discovery\n\n`;
  report += `**Date:** ${new Date().toISOString()}\n`;
  report += `**Total Partitions:** ${data.length}\n\n`;
  report += `---\n\n`;

  // Summary table
  report += `## Partition Summary\n\n`;
  report += `| Partition | Rows | Unique trade_ids | v2 Valid | v2 Orphans | v2 Coverage | Phase 1 Tested |\n`;
  report += `|-----------|------|-----------------|----------|------------|-------------|----------------|\n`;

  let totalRows = 0;
  let totalValid = 0;
  let totalOrphans = 0;
  let testedCount = 0;
  let untestedCount = 0;

  for (const row of data) {
    const partition = parseInt(row.partition);
    const rowCount = parseInt(row.row_count);
    const uniqueIds = parseInt(row.unique_trade_ids);
    const valid = parseInt(row.v2_valid);
    const orphans = parseInt(row.v2_orphans);
    const coverage = parseFloat(row.v2_coverage_pct);
    const tested = PHASE1_TESTED_PARTITIONS.includes(partition);

    totalRows += rowCount;
    totalValid += valid;
    totalOrphans += orphans;

    if (tested) {
      testedCount++;
    } else {
      untestedCount++;
    }

    report += `| ${partition} | ${rowCount.toLocaleString()} | ${uniqueIds.toLocaleString()} | ${valid.toLocaleString()} | ${orphans.toLocaleString()} | ${coverage.toFixed(2)}% | ${tested ? '✅ Yes' : '⬜ No'} |\n`;
  }

  report += `\n**Global Totals:**\n`;
  report += `- Total rows: ${totalRows.toLocaleString()}\n`;
  report += `- Total v2 valid: ${totalValid.toLocaleString()}\n`;
  report += `- Total v2 orphans: ${totalOrphans.toLocaleString()}\n`;
  report += `- Global v2 coverage: ${((totalValid / totalRows) * 100).toFixed(2)}%\n\n`;

  report += `**Phase 1 Testing Status:**\n`;
  report += `- Tested partitions: ${testedCount}\n`;
  report += `- Untested partitions: ${untestedCount}\n\n`;

  report += `---\n\n`;

  // Tested vs Untested breakdown
  report += `## Phase 1 Tested Partitions\n\n`;
  report += `These partitions were validated in Phase 1 (v2 vs v3 comparison):\n\n`;
  const testedPartitions = data.filter(row => PHASE1_TESTED_PARTITIONS.includes(parseInt(row.partition)));
  for (const row of testedPartitions) {
    report += `- **${row.partition}**: ${parseInt(row.row_count).toLocaleString()} rows (${parseFloat(row.v2_coverage_pct).toFixed(2)}% v2 coverage)\n`;
  }

  report += `\n## Untested Partitions\n\n`;
  report += `These partitions will be processed for the first time in Phase 2 (global build):\n\n`;
  const untestedPartitions = data.filter(row => !PHASE1_TESTED_PARTITIONS.includes(parseInt(row.partition)));
  if (untestedPartitions.length > 0) {
    for (const row of untestedPartitions) {
      report += `- **${row.partition}**: ${parseInt(row.row_count).toLocaleString()} rows (${parseFloat(row.v2_coverage_pct).toFixed(2)}% v2 coverage)\n`;
    }
  } else {
    report += `*All partitions were tested in Phase 1.*\n`;
  }

  report += `\n---\n\n`;

  report += `## Next Steps\n\n`;
  report += `1. Run global v3 build: \`npx tsx scripts/execute-pm_trades_canonical_v3-build.ts\`\n`;
  report += `2. Build will process all ${data.length} partitions using existing checkpoint mechanism\n`;
  report += `3. Estimated runtime: ~2-3 hours for full backfill\n`;
  report += `4. Generate global coverage report after build completes\n`;

  // Write report
  const reportPath = '/tmp/PM_TRADES_V3_PARTITION_LIST.md';
  writeFileSync(reportPath, report);

  console.log('✅ Partition discovery complete\n');
  console.log(`Total partitions: ${data.length}`);
  console.log(`Total rows: ${totalRows.toLocaleString()}`);
  console.log(`Global v2 coverage: ${((totalValid / totalRows) * 100).toFixed(2)}%`);
  console.log(`\nPhase 1 tested: ${testedCount} partitions`);
  console.log(`Untested: ${untestedCount} partitions`);
  console.log(`\nReport written to: ${reportPath}`);
}

main().catch(console.error);
