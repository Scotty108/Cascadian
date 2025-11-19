#!/usr/bin/env npx tsx
/**
 * Overnight Preparation for AMM Coverage Implementation
 * 
 * Runs comprehensive analysis to prepare test data and benchmarks
 * for tomorrow's ERC1155 hybrid implementation.
 */

import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';

config({ path: path.resolve(process.cwd(), '.env.local') });

const OUTPUT_FILE = 'tmp/overnight-analysis.json';
const results: any = {
  timestamp: new Date().toISOString(),
  analyses: []
};

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function saveProgress() {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  log(`Progress saved to ${OUTPUT_FILE}`);
}

async function runAnalysis(name: string, query: string) {
  log(`Starting: ${name}`);
  const startTime = Date.now();
  
  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json();
    
    const analysis = {
      name,
      success: true,
      duration_ms: Date.now() - startTime,
      row_count: data.length,
      data
    };
    
    results.analyses.push(analysis);
    saveProgress();
    
    log(`✅ Completed: ${name} (${analysis.duration_ms}ms, ${analysis.row_count} rows)`);
    return data;
  } catch (err) {
    log(`❌ Failed: ${name} - ${(err as Error).message}`);
    results.analyses.push({
      name,
      success: false,
      error: (err as Error).message,
      duration_ms: Date.now() - startTime
    });
    saveProgress();
    return null;
  }
}

async function main() {
  log('═══════════════════════════════════════════════════════════');
  log('OVERNIGHT PREPARATION FOR AMM COVERAGE IMPLEMENTATION');
  log('═══════════════════════════════════════════════════════════\n');

  // Analysis 1: Full Coverage Check (ALL markets)
  await runAnalysis(
    'Full Coverage Analysis',
    `
    WITH coverage AS (
      SELECT
        g.condition_id,
        EXISTS(SELECT 1 FROM clob_fills c 
               WHERE lower(replaceAll(c.condition_id, '0x', '')) = 
                     lower(replaceAll(g.condition_id, '0x', ''))) as has_clob,
        EXISTS(SELECT 1 FROM ctf_token_map m
               WHERE m.condition_id_norm = lower(replaceAll(g.condition_id, '0x', ''))) as has_mapping,
        EXISTS(SELECT 1 FROM erc1155_transfers e
               WHERE e.token_id IN (
                 SELECT token_id FROM ctf_token_map 
                 WHERE condition_id_norm = lower(replaceAll(g.condition_id, '0x', ''))
               )) as has_erc1155
      FROM gamma_markets g
    )
    SELECT
      countIf(has_clob) as clob_markets,
      countIf(has_erc1155 AND NOT has_clob) as amm_only_markets,
      countIf(has_mapping AND NOT has_clob AND NOT has_erc1155) as zero_trade_markets,
      countIf(NOT has_mapping) as no_mapping_markets,
      countIf(has_clob OR has_erc1155) as total_coverage,
      count(*) as total_markets,
      round(100.0 * countIf(has_clob OR has_erc1155) / count(*), 2) as coverage_pct
    FROM coverage
    `
  );

  // Analysis 2: Find AMM-Only Markets (Test Cases)
  await runAnalysis(
    'AMM-Only Test Markets',
    `
    SELECT
      g.condition_id,
      g.question,
      g.closed,
      g.fetched_at,
      (SELECT count(*) FROM erc1155_transfers e
       WHERE e.token_id IN (
         SELECT token_id FROM ctf_token_map 
         WHERE condition_id_norm = lower(replaceAll(g.condition_id, '0x', ''))
       )) as transfer_count
    FROM gamma_markets g
    WHERE lower(replaceAll(g.condition_id, '0x', '')) NOT IN (
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
      FROM clob_fills
    )
    AND lower(replaceAll(g.condition_id, '0x', '')) IN (
      SELECT DISTINCT condition_id_norm
      FROM ctf_token_map
      WHERE token_id IN (
        SELECT DISTINCT token_id FROM erc1155_transfers
      )
    )
    ORDER BY transfer_count DESC
    LIMIT 20
    `
  );

  // Analysis 3: High-Volume CLOB Markets (Performance Baseline)
  await runAnalysis(
    'High-Volume CLOB Markets',
    `
    SELECT
      condition_id,
      count(*) as fill_count,
      count(DISTINCT maker) as unique_makers,
      count(DISTINCT taker) as unique_takers,
      min(timestamp) as first_trade,
      max(timestamp) as last_trade
    FROM clob_fills
    GROUP BY condition_id
    ORDER BY fill_count DESC
    LIMIT 10
    `
  );

  // Analysis 4: Token Mapping Coverage by Month
  await runAnalysis(
    'Token Mapping Coverage by Month',
    `
    SELECT
      toYYYYMM(fetched_at) as month,
      count(*) as total_markets,
      countIf(lower(replaceAll(condition_id, '0x', '')) IN (
        SELECT DISTINCT condition_id_norm FROM ctf_token_map
      )) as mapped_markets,
      round(100.0 * mapped_markets / total_markets, 2) as mapping_pct
    FROM gamma_markets
    WHERE fetched_at >= '2024-01-01'
    GROUP BY month
    ORDER BY month DESC
    `
  );

  // Analysis 5: ERC1155 Transfer Volume by Market
  await runAnalysis(
    'ERC1155 Volume Distribution',
    `
    SELECT
      countIf(transfer_count = 0) as zero_transfers,
      countIf(transfer_count BETWEEN 1 AND 10) as low_volume,
      countIf(transfer_count BETWEEN 11 AND 100) as medium_volume,
      countIf(transfer_count BETWEEN 101 AND 1000) as high_volume,
      countIf(transfer_count > 1000) as very_high_volume
    FROM (
      SELECT
        m.condition_id_norm,
        count(e.token_id) as transfer_count
      FROM ctf_token_map m
      LEFT JOIN erc1155_transfers e ON e.token_id = m.token_id
      WHERE e.from_address != '0x0000000000000000000000000000000000000000'
        AND e.to_address != '0x0000000000000000000000000000000000000000'
      GROUP BY m.condition_id_norm
    )
    `
  );

  // Analysis 6: Recent Markets Performance Test
  await runAnalysis(
    'Recent Markets Coverage',
    `
    SELECT
      toDate(fetched_at) as date,
      count(*) as markets_created,
      countIf(lower(replaceAll(condition_id, '0x', '')) IN (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
        FROM clob_fills
      )) as with_clob,
      countIf(lower(replaceAll(condition_id, '0x', '')) IN (
        SELECT DISTINCT condition_id_norm FROM ctf_token_map
      )) as with_mapping,
      round(100.0 * with_clob / markets_created, 2) as clob_pct,
      round(100.0 * with_mapping / markets_created, 2) as mapping_pct
    FROM gamma_markets
    WHERE fetched_at >= '2024-11-01'
    GROUP BY date
    ORDER BY date DESC
    LIMIT 30
    `
  );

  // Analysis 7: Sample ERC1155 Query Performance
  log('\nPerformance Test: Sample ERC1155 queries...');
  const testMarkets = await runAnalysis(
    'Sample Markets for Testing',
    `
    SELECT condition_id
    FROM gamma_markets
    WHERE lower(replaceAll(condition_id, '0x', '')) IN (
      SELECT DISTINCT condition_id_norm FROM ctf_token_map
    )
    ORDER BY rand()
    LIMIT 5
    `
  );

  if (testMarkets && testMarkets.length > 0) {
    for (const market of testMarkets) {
      const conditionId = market.condition_id.toLowerCase().replace('0x', '');
      await runAnalysis(
        `ERC1155 Query Performance: ${conditionId.substring(0, 8)}...`,
        `
        SELECT count(*) as transfer_count
        FROM erc1155_transfers
        WHERE token_id IN (
          SELECT token_id FROM ctf_token_map 
          WHERE condition_id_norm = '${conditionId}'
        )
        AND from_address != '0x0000000000000000000000000000000000000000'
        AND to_address != '0x0000000000000000000000000000000000000000'
        `
      );
    }
  }

  // Final Summary
  log('\n═══════════════════════════════════════════════════════════');
  log('OVERNIGHT ANALYSIS COMPLETE');
  log('═══════════════════════════════════════════════════════════\n');
  
  const successful = results.analyses.filter((a: any) => a.success).length;
  const failed = results.analyses.filter((a: any) => !a.success).length;
  
  log(`Total Analyses: ${results.analyses.length}`);
  log(`Successful: ${successful}`);
  log(`Failed: ${failed}`);
  log(`\nResults saved to: ${OUTPUT_FILE}`);
  log('\n✅ Ready for tomorrow\'s implementation!\n');
}

main().catch(err => {
  log(`❌ Fatal error: ${err.message}`);
  saveProgress();
  process.exit(1);
});
