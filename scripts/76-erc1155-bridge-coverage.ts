#!/usr/bin/env tsx
/**
 * ERC-1155 Bridge Coverage Analysis
 *
 * Analyzes coverage of pm_erc1155_token_map against erc1155_transfers
 * to determine how well we can bridge on-chain token IDs to canonical condition_id + outcome
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

interface CoverageStats {
  total_erc1155_tokens: string;
  mapped_erc1155_tokens: string;
  token_coverage_pct: string;
  total_conditions: string;
  mapped_conditions: string;
  condition_coverage_pct: string;
}

interface ConditionOutcomeStats {
  condition_id: string;
  question: string;
  distinct_tokens: string;
  expected_outcomes: string;
  coverage_status: string;
}

async function main() {
  console.log('📊 ERC-1155 Bridge Coverage Analysis');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Overall Token Coverage
  console.log('Step 1: Analyzing token-level coverage...');
  console.log('');

  const tokenCoverageQuery = await clickhouse.query({
    query: `
      WITH
        all_tokens AS (
          SELECT DISTINCT lower(replaceAll(token_id, '0x', '')) as token_id_norm
          FROM erc1155_transfers
          WHERE token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
            AND token_id != ''
        ),
        mapped_tokens AS (
          SELECT DISTINCT erc1155_token_id_hex
          FROM pm_erc1155_token_map
        )
      SELECT
        (SELECT COUNT(*) FROM all_tokens) as total_erc1155_tokens,
        (SELECT COUNT(*) FROM mapped_tokens) as mapped_erc1155_tokens,
        ROUND((SELECT COUNT(*) FROM mapped_tokens) * 100.0 / (SELECT COUNT(*) FROM all_tokens), 2) as token_coverage_pct
    `,
    format: 'JSONEachRow'
  });

  const tokenStats = await tokenCoverageQuery.json<CoverageStats>();
  console.log('Token-Level Coverage:');
  console.table(tokenStats);
  console.log('');

  // Step 2: Condition Coverage
  console.log('Step 2: Analyzing condition-level coverage...');
  console.log('');

  const conditionCoverageQuery = await clickhouse.query({
    query: `
      WITH
        all_conditions AS (
          SELECT DISTINCT condition_id_norm as condition_id
          FROM ctf_token_map
          WHERE condition_id_norm != ''
        ),
        mapped_conditions AS (
          SELECT DISTINCT condition_id
          FROM pm_erc1155_token_map
        )
      SELECT
        (SELECT COUNT(*) FROM all_conditions) as total_conditions,
        (SELECT COUNT(*) FROM mapped_conditions) as mapped_conditions,
        ROUND((SELECT COUNT(*) FROM mapped_conditions) * 100.0 / (SELECT COUNT(*) FROM all_conditions), 2) as condition_coverage_pct
    `,
    format: 'JSONEachRow'
  });

  const conditionStats = await conditionCoverageQuery.json<CoverageStats>();
  console.log('Condition-Level Coverage:');
  console.table(conditionStats);
  console.log('');

  // Step 3: Unmapped Token Analysis
  console.log('Step 3: Analyzing unmapped tokens...');
  console.log('');

  const unmappedTokensQuery = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT et.token_id) as unmapped_count
      FROM erc1155_transfers et
      LEFT JOIN pm_erc1155_token_map map
        ON lower(replaceAll(et.token_id, '0x', '')) = map.erc1155_token_id_hex
      WHERE map.erc1155_token_id_hex IS NULL
        AND et.token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND et.token_id != ''
    `,
    format: 'JSONEachRow'
  });

  const unmappedStats = await unmappedTokensQuery.json<{unmapped_count: string}>();
  console.log(`Unmapped Tokens: ${unmappedStats[0].unmapped_count}`);
  console.log('');

  // Step 4: Sample Unmapped Tokens
  console.log('Step 4: Sample of unmapped tokens...');
  console.log('');

  const sampleUnmappedQuery = await clickhouse.query({
    query: `
      SELECT
        lower(replaceAll(et.token_id, '0x', '')) as token_id_norm,
        COUNT(*) as transfer_count,
        min(et.block_timestamp) as first_seen,
        max(et.block_timestamp) as last_seen
      FROM erc1155_transfers et
      LEFT JOIN pm_erc1155_token_map map
        ON lower(replaceAll(et.token_id, '0x', '')) = map.erc1155_token_id_hex
      WHERE map.erc1155_token_id_hex IS NULL
        AND et.token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND et.token_id != ''
      GROUP BY et.token_id
      ORDER BY transfer_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const sampleUnmapped = await sampleUnmappedQuery.json<{
    token_id_norm: string;
    transfer_count: string;
    first_seen: string;
    last_seen: string;
  }>();

  console.log('Top 10 Unmapped Tokens by Transfer Volume:');
  console.table(sampleUnmapped.map(t => ({
    token_id: t.token_id_norm.substring(0, 16) + '...',
    transfers: t.transfer_count,
    first_seen: t.first_seen,
    last_seen: t.last_seen
  })));
  console.log('');

  // Step 5: Outcome Token Analysis per Condition
  console.log('Step 5: Analyzing outcome tokens per condition...');
  console.log('');

  const outcomeAnalysisQuery = await clickhouse.query({
    query: `
      WITH condition_tokens AS (
        SELECT
          map.condition_id,
          COUNT(DISTINCT map.erc1155_token_id_hex) as distinct_tokens
        FROM pm_erc1155_token_map map
        GROUP BY map.condition_id
      ),
      condition_metadata AS (
        SELECT
          condition_id_norm as condition_id,
          question,
          length(JSONExtractArrayRaw(outcomes_json)) as expected_outcomes
        FROM ctf_token_map
        WHERE condition_id_norm != ''
        GROUP BY condition_id_norm, question, outcomes_json
      )
      SELECT
        ct.condition_id,
        coalesce(cm.question, '') as question,
        ct.distinct_tokens,
        coalesce(cm.expected_outcomes, 0) as expected_outcomes,
        CASE
          WHEN cm.expected_outcomes IS NULL THEN 'No metadata'
          WHEN ct.distinct_tokens = cm.expected_outcomes THEN 'Complete'
          WHEN ct.distinct_tokens < cm.expected_outcomes THEN 'Incomplete'
          ELSE 'Anomaly (more than expected)'
        END as coverage_status
      FROM condition_tokens ct
      LEFT JOIN condition_metadata cm
        ON ct.condition_id = cm.condition_id
      ORDER BY ct.distinct_tokens DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const outcomeStats = await outcomeAnalysisQuery.json<ConditionOutcomeStats>();
  console.log('Top 20 Conditions by Token Count:');
  console.table(outcomeStats.map(c => ({
    condition_id: c.condition_id.substring(0, 16) + '...',
    question: c.question.substring(0, 50) + (c.question.length > 50 ? '...' : ''),
    tokens_found: c.distinct_tokens,
    expected: c.expected_outcomes,
    status: c.coverage_status
  })));
  console.log('');

  // Step 6: Coverage Status Summary
  console.log('Step 6: Coverage status distribution...');
  console.log('');

  const statusDistQuery = await clickhouse.query({
    query: `
      WITH condition_tokens AS (
        SELECT
          map.condition_id,
          COUNT(DISTINCT map.erc1155_token_id_hex) as distinct_tokens
        FROM pm_erc1155_token_map map
        GROUP BY map.condition_id
      ),
      condition_metadata AS (
        SELECT
          condition_id_norm as condition_id,
          length(JSONExtractArrayRaw(outcomes_json)) as expected_outcomes
        FROM ctf_token_map
        WHERE condition_id_norm != ''
        GROUP BY condition_id_norm, outcomes_json
      )
      SELECT
        CASE
          WHEN cm.expected_outcomes IS NULL THEN 'No metadata'
          WHEN ct.distinct_tokens = cm.expected_outcomes THEN 'Complete'
          WHEN ct.distinct_tokens < cm.expected_outcomes THEN 'Incomplete'
          ELSE 'Anomaly'
        END as coverage_status,
        COUNT(*) as condition_count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(DISTINCT condition_id) FROM pm_erc1155_token_map), 2) as pct
      FROM condition_tokens ct
      LEFT JOIN condition_metadata cm
        ON ct.condition_id = cm.condition_id
      GROUP BY coverage_status
      ORDER BY condition_count DESC
    `,
    format: 'JSONEachRow'
  });

  const statusDist = await statusDistQuery.json<{
    coverage_status: string;
    condition_count: string;
    pct: string;
  }>();

  console.log('Coverage Status Distribution:');
  console.table(statusDist);
  console.log('');

  // Step 7: Bridge Source Analysis
  console.log('Step 7: Analyzing bridge sources...');
  console.log('');

  const bridgeSourceQuery = await clickhouse.query({
    query: `
      SELECT
        mapping_source,
        COUNT(*) as mapping_count,
        COUNT(DISTINCT erc1155_token_id_hex) as distinct_tokens,
        COUNT(DISTINCT condition_id) as distinct_conditions,
        AVG(mapping_confidence) as avg_confidence,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM pm_erc1155_token_map), 2) as pct_of_total
      FROM pm_erc1155_token_map
      GROUP BY mapping_source
      ORDER BY mapping_count DESC
    `,
    format: 'JSONEachRow'
  });

  const bridgeSources = await bridgeSourceQuery.json<{
    mapping_source: string;
    mapping_count: string;
    distinct_tokens: string;
    distinct_conditions: string;
    avg_confidence: string;
    pct_of_total: string;
  }>();

  console.log('Bridge Source Statistics:');
  console.table(bridgeSources);
  console.log('');

  // Final Summary
  console.log('='.repeat(60));
  console.log('📋 COVERAGE SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('Token Coverage:');
  console.log(`  Total ERC-1155 tokens:     ${tokenStats[0].total_erc1155_tokens}`);
  console.log(`  Mapped tokens:             ${tokenStats[0].mapped_erc1155_tokens}`);
  console.log(`  Coverage:                  ${tokenStats[0].token_coverage_pct}%`);
  console.log('');
  console.log('Condition Coverage:');
  console.log(`  Total conditions:          ${conditionStats[0].total_conditions}`);
  console.log(`  Mapped conditions:         ${conditionStats[0].mapped_conditions}`);
  console.log(`  Coverage:                  ${conditionStats[0].condition_coverage_pct}%`);
  console.log('');
  console.log('Bridge Sources:');
  bridgeSources.forEach(source => {
    console.log(`  ${source.mapping_source}:`);
    console.log(`    Mappings: ${source.mapping_count} (${source.pct_of_total}%)`);
    console.log(`    Avg confidence: ${parseFloat(source.avg_confidence).toFixed(1)}`);
  });
  console.log('');

  const coveragePct = parseFloat(tokenStats[0].token_coverage_pct);
  if (coveragePct >= 95) {
    console.log('✅ EXCELLENT: Coverage meets 95%+ target');
  } else if (coveragePct >= 80) {
    console.log('⚠️  GOOD: Coverage above 80%, but below 95% target');
  } else if (coveragePct >= 50) {
    console.log('⚠️  MODERATE: Coverage above 50%, significant gaps remain');
  } else {
    console.log('❌ LOW: Coverage below 50%, major gaps in mapping');
  }
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Investigate additional bridge tables to improve coverage');
  console.log('  2. Analyze unmapped tokens for patterns');
  console.log('  3. Consider additional bridge sources (ctf_to_market_bridge_mat, api_ctf_bridge)');
  console.log('  4. Update DATA_COVERAGE_REPORT.md with findings');
  console.log('');
  console.log('✅ Coverage analysis complete!');
}

main().catch((error) => {
  console.error('❌ Analysis failed:', error);
  process.exit(1);
});
