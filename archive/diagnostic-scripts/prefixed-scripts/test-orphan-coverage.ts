import { getClickHouseClient } from './lib/clickhouse/client';

interface CoverageResult {
  source: string;
  orphans_sampled: string;
  has_condition_id: string;
  safe_1to1_matches: string;
  ambiguous_matches: string;
  safe_coverage_pct: string;
  total_match_pct: string;
  avg_matches_per_orphan?: string;
}

// Top priority candidates based on known schema
const PRIORITY_CANDIDATES = [
  {
    name: 'external_trades_raw',
    database: 'default',
    cidColumn: 'condition_id',
    txColumn: 'tx_hash'
  },
  {
    name: 'clob_fills',
    database: 'default',
    cidColumn: 'condition_id',
    txColumn: 'tx_hash'
  },
  {
    name: 'fact_trades_clean',
    database: 'cascadian_clean',
    cidColumn: 'cid_hex',
    txColumn: 'tx_hash'
  },
  {
    name: 'trade_direction_assignments',
    database: 'default',
    cidColumn: 'condition_id_norm',
    txColumn: 'tx_hash'
  },
  {
    name: 'trades_cid_map_v2',
    database: 'default',
    cidColumn: 'condition_id_norm',
    txColumn: 'transaction_hash'
  },
  {
    name: 'trades_with_direction',
    database: 'default',
    cidColumn: 'condition_id_norm',
    txColumn: 'tx_hash'
  },
  {
    name: 'pm_trades',
    database: 'default',
    cidColumn: 'condition_id',
    txColumn: 'tx_hash'
  },
  {
    name: 'pm_trades_complete',
    database: 'default',
    cidColumn: 'condition_id',
    txColumn: 'tx_hash'
  },
  {
    name: 'vw_trades_canonical',
    database: 'default',
    cidColumn: 'condition_id_norm',
    txColumn: 'transaction_hash'
  },
  {
    name: 'trades_raw',
    database: 'default',
    cidColumn: 'condition_id',
    txColumn: 'tx_hash'
  }
];

async function main() {
  try {
    const client = getClickHouseClient();

    console.log('=== PHASE 3: ORPHAN COVERAGE TESTING ===\n');

    // First, check if orphan sample exists
    console.log('📊 Checking orphan sample table...\n');

    try {
      const sampleCheck = await client.query({
        query: `
          SELECT count() as count
          FROM tmp_c2_orphan_sample_100k
        `,
        format: 'JSONEachRow'
      });
      const sampleResult = await sampleCheck.json() as { count: string }[];
      console.log(`✅ Orphan sample table exists with ${sampleResult[0].count} rows\n`);
    } catch (error: any) {
      console.error('❌ Orphan sample table does not exist!');
      console.error('   Creating it now...\n');

      // Create orphan sample
      await client.query({
        query: `
          CREATE TABLE IF NOT EXISTS tmp_c2_orphan_sample_100k
          ENGINE = MergeTree()
          ORDER BY transaction_hash
          AS
          SELECT
            transaction_hash,
            wallet_address,
            timestamp
          FROM pm_trades_canonical_v3
          WHERE length(coalesce(condition_id_norm_v3, '')) != 64
          LIMIT 100000
        `
      });

      console.log('✅ Created orphan sample table\n');
    }

    console.log('🔍 Testing candidate tables for orphan coverage...\n');

    const results: CoverageResult[] = [];

    for (const candidate of PRIORITY_CANDIDATES) {
      const fullTableName = `${candidate.database}.${candidate.name}`;
      console.log(`\nTesting: ${fullTableName}`);
      console.log(`  CID column: ${candidate.cidColumn}, TX column: ${candidate.txColumn}`);

      try {
        const coverageQuery = `
          SELECT
            '${fullTableName}' AS source,
            count(DISTINCT o.transaction_hash) AS orphans_sampled,
            countIf(t.${candidate.cidColumn} IS NOT NULL AND length(t.${candidate.cidColumn}) = 64) AS has_condition_id,
            countIf(match_count = 1 AND length(t.${candidate.cidColumn}) = 64) AS safe_1to1_matches,
            countIf(match_count > 1) AS ambiguous_matches,
            round(100.0 * safe_1to1_matches / orphans_sampled, 2) AS safe_coverage_pct,
            round(100.0 * has_condition_id / orphans_sampled, 2) AS total_match_pct,
            round(avgIf(match_count, match_count > 0), 2) AS avg_matches_per_orphan
          FROM tmp_c2_orphan_sample_100k o
          LEFT JOIN ${fullTableName} t ON o.transaction_hash = t.${candidate.txColumn}
          LEFT JOIN (
            SELECT ${candidate.txColumn}, count() as match_count
            FROM ${fullTableName}
            GROUP BY ${candidate.txColumn}
          ) counts ON o.transaction_hash = counts.${candidate.txColumn}
        `;

        const result = await client.query({
          query: coverageQuery,
          format: 'JSONEachRow'
        });

        const coverageData = await result.json() as CoverageResult[];
        if (coverageData.length > 0) {
          results.push(coverageData[0]);

          const data = coverageData[0];
          console.log(`  ✅ Safe 1:1 coverage: ${data.safe_coverage_pct}%`);
          console.log(`  📊 Total matches: ${data.total_match_pct}%`);
          console.log(`  ⚠️  Ambiguous: ${data.ambiguous_matches}`);
          console.log(`  📈 Avg matches/orphan: ${data.avg_matches_per_orphan || 'N/A'}`);
        }

      } catch (error: any) {
        console.error(`  ❌ Error: ${error.message}`);
      }
    }

    // Sort by safe coverage percentage
    results.sort((a, b) => parseFloat(b.safe_coverage_pct) - parseFloat(a.safe_coverage_pct));

    console.log(`\n\n=== COVERAGE RESULTS SUMMARY (sorted by safe 1:1 coverage) ===\n`);

    console.log('Top 5 Candidates:\n');
    results.slice(0, 5).forEach((r, i) => {
      console.log(`${i + 1}. ${r.source}`);
      console.log(`   Safe 1:1 Coverage: ${r.safe_coverage_pct}%`);
      console.log(`   Total Matches: ${r.total_match_pct}%`);
      console.log(`   Ambiguous Matches: ${r.ambiguous_matches}`);
      console.log('');
    });

    // Write detailed report
    const report = generateCoverageReport(results);
    const fs = require('fs');
    fs.writeFileSync('/tmp/ORPHAN_COVERAGE_TEST_RESULTS.md', report);
    console.log('✅ Written to /tmp/ORPHAN_COVERAGE_TEST_RESULTS.md\n');

    // Generate recommendations
    const recommendations = generateRecommendations(results);
    fs.writeFileSync('/tmp/NEW_SOURCES_RECOMMENDATION.md', recommendations);
    console.log('✅ Written to /tmp/NEW_SOURCES_RECOMMENDATION.md\n');

    return results;

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function generateCoverageReport(results: CoverageResult[]): string {
  let report = `# Orphan Coverage Test Results\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Orphan Sample Size:** 100,000 trades\n`;
  report += `**Tables Tested:** ${results.length}\n\n`;

  report += `---\n\n`;

  report += `## Results by Safe 1:1 Coverage\n\n`;
  report += `| Rank | Table | Safe 1:1 % | Total Match % | Ambiguous | Avg Matches |\n`;
  report += `|------|-------|------------|---------------|-----------|-------------|\n`;

  results.forEach((r, i) => {
    report += `| ${i + 1} | ${r.source} | **${r.safe_coverage_pct}%** | ${r.total_match_pct}% | ${r.ambiguous_matches} | ${r.avg_matches_per_orphan || 'N/A'} |\n`;
  });

  report += `\n---\n\n`;

  report += `## Detailed Results\n\n`;

  results.forEach((r, i) => {
    report += `### ${i + 1}. \`${r.source}\`\n\n`;
    report += `- **Safe 1:1 Coverage:** ${r.safe_coverage_pct}%\n`;
    report += `- **Total Matches:** ${r.total_match_pct}%\n`;
    report += `- **Orphans Sampled:** ${r.orphans_sampled}\n`;
    report += `- **Has Condition ID:** ${r.has_condition_id}\n`;
    report += `- **Safe 1:1 Matches:** ${r.safe_1to1_matches}\n`;
    report += `- **Ambiguous Matches:** ${r.ambiguous_matches}\n`;
    report += `- **Avg Matches per Orphan:** ${r.avg_matches_per_orphan || 'N/A'}\n\n`;

    const coverage = parseFloat(r.safe_coverage_pct);
    if (coverage > 10) {
      report += `🟢 **HIGH VALUE** - Excellent coverage, recommend immediate integration\n\n`;
    } else if (coverage > 5) {
      report += `🟡 **MEDIUM VALUE** - Good coverage, consider for integration\n\n`;
    } else if (coverage > 1) {
      report += `🟠 **LOW VALUE** - Minor coverage, evaluate cost/benefit\n\n`;
    } else {
      report += `🔴 **MINIMAL VALUE** - Very low coverage, likely not worth integrating\n\n`;
    }

    report += `---\n\n`;
  });

  return report;
}

function generateRecommendations(results: CoverageResult[]): string {
  let report = `# New Source Recommendations for Orphan Repair\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Goal:** Close the 30% condition_id orphan gap in pm_trades_canonical_v3\n\n`;

  const highValue = results.filter(r => parseFloat(r.safe_coverage_pct) > 10);
  const mediumValue = results.filter(r => parseFloat(r.safe_coverage_pct) > 5 && parseFloat(r.safe_coverage_pct) <= 10);
  const lowValue = results.filter(r => parseFloat(r.safe_coverage_pct) > 1 && parseFloat(r.safe_coverage_pct) <= 5);

  report += `## Executive Summary\n\n`;
  report += `- **High Value Sources (>10% coverage):** ${highValue.length}\n`;
  report += `- **Medium Value Sources (5-10% coverage):** ${mediumValue.length}\n`;
  report += `- **Low Value Sources (1-5% coverage):** ${lowValue.length}\n`;
  report += `- **Minimal Value (<1% coverage):** ${results.length - highValue.length - mediumValue.length - lowValue.length}\n\n`;

  report += `---\n\n`;

  if (highValue.length > 0) {
    report += `## 🟢 Top Recommendations (High Value)\n\n`;

    highValue.forEach((r, i) => {
      report += `### ${i + 1}. ${r.source}\n\n`;
      report += `**Safe 1:1 Coverage:** ${r.safe_coverage_pct}%\n\n`;
      report += `**Projected Coverage Gain:**\n`;
      const projectedGain = (parseFloat(r.safe_coverage_pct) / 100) * 43000000;
      report += `- If 100k sample represents full dataset: ~${(projectedGain / 1000000).toFixed(1)}M trades\n`;
      report += `- Of 43M orphans: ~${((projectedGain / 43000000) * 100).toFixed(1)}% of orphan gap\n\n`;

      report += `**Integration Difficulty:** `;
      if (r.source.includes('external_trades_raw')) {
        report += `LOW - Already tested by C2\n\n`;
      } else if (r.source.includes('clob_fills')) {
        report += `LOW - Clean CLOB data\n\n`;
      } else if (r.source.includes('fact_trades_clean')) {
        report += `MEDIUM - Different database\n\n`;
      } else {
        report += `MEDIUM - Needs schema review\n\n`;
      }

      report += `**Ambiguity Risk:** `;
      const ambiguousRate = (parseInt(r.ambiguous_matches) / parseInt(r.orphans_sampled)) * 100;
      if (ambiguousRate < 1) {
        report += `LOW (${ambiguousRate.toFixed(2)}%)\n\n`;
      } else if (ambiguousRate < 5) {
        report += `MEDIUM (${ambiguousRate.toFixed(2)}%)\n\n`;
      } else {
        report += `HIGH (${ambiguousRate.toFixed(2)}%) - Fanout issue\n\n`;
      }

      report += `**Recommendation:** IMMEDIATE INTEGRATION\n\n`;
      report += `---\n\n`;
    });
  }

  if (mediumValue.length > 0) {
    report += `## 🟡 Medium Priority Recommendations\n\n`;

    mediumValue.slice(0, 3).forEach((r, i) => {
      report += `### ${i + 1}. ${r.source}\n\n`;
      report += `- Safe Coverage: ${r.safe_coverage_pct}%\n`;
      report += `- Projected Gain: ~${((parseFloat(r.safe_coverage_pct) / 100) * 43000000 / 1000000).toFixed(1)}M trades\n`;
      report += `- Recommendation: Consider after high-value sources\n\n`;
    });
  }

  report += `## Next Steps\n\n`;
  report += `1. **Immediate:** Integrate top ${Math.min(3, highValue.length)} high-value sources\n`;
  report += `2. **Schema Review:** Examine integration requirements for top candidates\n`;
  report += `3. **Test Integration:** Run pilot repair on 10k sample before full deployment\n`;
  report += `4. **Measure Impact:** Track coverage improvement after each source\n`;
  report += `5. **Iterate:** Continue adding sources until <5% orphan rate\n\n`;

  return report;
}

main().catch(console.error);
