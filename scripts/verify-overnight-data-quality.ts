#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('OVERNIGHT DATA QUALITY VERIFICATION');
  console.log('═'.repeat(80));
  console.log();

  // 1. Check blockchain backfill progress
  console.log('1. BLOCKCHAIN BACKFILL DATA QUALITY');
  console.log('─'.repeat(80));
  
  const blockchainData = await client.query({
    query: `
      SELECT
        count(*) as total_rows,
        count(DISTINCT condition_id_norm) as unique_conditions,
        countIf(condition_id_norm = '') as blank_condition_ids,
        countIf(payout_denominator = 0) as zero_denominators,
        countIf(length(payout_numerators) = 0) as empty_numerators,
        countIf(oracle_address = '') as blank_oracles,
        countIf(question_id = '') as blank_questions,
        min(block_number) as min_block,
        max(block_number) as max_block,
        argMax(source, updated_at) as latest_source
      FROM default.market_resolutions_final
      WHERE source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });

  const bcData = (await blockchainData.json<any[]>())[0];
  
  console.log(`Total blockchain resolutions:  ${bcData.total_rows.toLocaleString()}`);
  console.log(`Unique condition IDs:          ${bcData.unique_conditions.toLocaleString()}`);
  console.log(`Block range:                   ${bcData.min_block.toLocaleString()} → ${bcData.max_block.toLocaleString()}`);
  console.log();
  console.log('Data Quality Checks:');
  console.log(`  ✓ Blank condition_ids:       ${bcData.blank_condition_ids} (${bcData.blank_condition_ids === 0 ? 'PASS' : 'FAIL'})`);
  console.log(`  ✓ Zero denominators:         ${bcData.zero_denominators} (${bcData.zero_denominators === 0 ? 'PASS' : 'FAIL'})`);
  console.log(`  ✓ Empty payout arrays:       ${bcData.empty_numerators} (${bcData.empty_numerators === 0 ? 'PASS' : 'FAIL'})`);
  console.log(`  ✓ Blank oracle addresses:    ${bcData.blank_oracles} (${bcData.blank_oracles === 0 ? 'PASS' : 'FAIL'})`);
  console.log(`  ✓ Blank question IDs:        ${bcData.blank_questions} (${bcData.blank_questions === 0 ? 'PASS' : 'FAIL'})`);
  console.log();

  // 2. Sample some actual resolutions to verify structure
  console.log('2. SAMPLE RESOLUTION DATA (First 3 records)');
  console.log('─'.repeat(80));
  
  const samples = await client.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index,
        oracle_address,
        question_id,
        outcome_slot_count,
        block_number,
        tx_hash
      FROM default.market_resolutions_final
      WHERE source = 'blockchain'
      ORDER BY block_number DESC
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await samples.json<any[]>();
  sampleData.forEach((s, idx) => {
    console.log(`Sample ${idx + 1}:`);
    console.log(`  condition_id:      ${s.condition_id_norm.substring(0, 16)}...`);
    console.log(`  payout_numerators: [${s.payout_numerators.join(', ')}]`);
    console.log(`  payout_denominator: ${s.payout_denominator}`);
    console.log(`  winning_index:     ${s.winning_index}`);
    console.log(`  oracle_address:    ${s.oracle_address.substring(0, 16)}...`);
    console.log(`  question_id:       ${s.question_id.substring(0, 16)}...`);
    console.log(`  outcome_slots:     ${s.outcome_slot_count}`);
    console.log(`  block_number:      ${s.block_number.toLocaleString()}`);
    console.log(`  tx_hash:           ${s.tx_hash.substring(0, 16)}...`);
    console.log();
  });

  // 3. Check if we can join to trades
  console.log('3. RESOLUTION-TO-TRADE MAPPING VERIFICATION');
  console.log('─'.repeat(80));
  
  const joinTest = await client.query({
    query: `
      SELECT
        count(DISTINCT t.condition_id_norm) as total_traded_markets,
        count(DISTINCT r.condition_id_norm) as markets_with_resolutions,
        (100.0 * count(DISTINCT r.condition_id_norm) / count(DISTINCT t.condition_id_norm)) as coverage_pct
      FROM default.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r
        ON lower(t.condition_id_norm) = lower(concat('0x', r.condition_id_norm))
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND r.source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });

  const joinData = (await joinTest.json<any[]>())[0];
  console.log(`Total markets traded:          ${joinData.total_traded_markets.toLocaleString()}`);
  console.log(`Markets with blockchain res:   ${joinData.markets_with_resolutions.toLocaleString()}`);
  console.log(`Current coverage:              ${joinData.coverage_pct.toFixed(2)}%`);
  console.log();

  // 4. Check API backfill if it exists
  console.log('4. API BACKFILL DATA QUALITY (if available)');
  console.log('─'.repeat(80));
  
  try {
    const apiData = await client.query({
      query: `
        SELECT
          count(*) as total_rows,
          count(DISTINCT condition_id) as unique_conditions,
          countIf(condition_id = '') as blank_condition_ids,
          countIf(winning_outcome = '') as blank_winners,
          countIf(outcomes_json = '[]' OR outcomes_json = '') as empty_outcomes,
          countIf(resolved = 1) as resolved_count,
          countIf(resolved = 0) as unresolved_count
        FROM default.api_market_backfill
      `,
      format: 'JSONEachRow',
    });

    const apiInfo = (await apiData.json<any[]>())[0];
    console.log(`Total API records:             ${apiInfo.total_rows.toLocaleString()}`);
    console.log(`Unique condition IDs:          ${apiInfo.unique_conditions.toLocaleString()}`);
    console.log(`Resolved markets:              ${apiInfo.resolved_count.toLocaleString()}`);
    console.log(`Unresolved markets:            ${apiInfo.unresolved_count.toLocaleString()}`);
    console.log();
    console.log('Data Quality Checks:');
    console.log(`  ✓ Blank condition_ids:       ${apiInfo.blank_condition_ids} (${apiInfo.blank_condition_ids === 0 ? 'PASS' : 'FAIL'})`);
    console.log(`  ✓ Blank winning_outcome:     ${apiInfo.blank_winners}`);
    console.log(`  ✓ Empty outcomes arrays:     ${apiInfo.empty_outcomes} (${apiInfo.empty_outcomes === 0 ? 'PASS' : 'FAIL'})`);
    console.log();
  } catch (error) {
    console.log('API backfill table not yet created or populated');
    console.log();
  }

  // 5. Overall system status
  console.log('5. OVERALL SYSTEM STATUS');
  console.log('─'.repeat(80));
  
  const systemStatus = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT condition_id_norm) 
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') as total_markets_traded,
        
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.market_resolutions_final) as total_resolutions_available,
        
        (SELECT count(*)
         FROM default.market_resolutions_final
         WHERE source = 'blockchain') as blockchain_resolutions,
        
        (SELECT count(*)
         FROM default.market_resolutions_final
         WHERE source = 'api') as api_resolutions
    `,
    format: 'JSONEachRow',
  });

  const status = (await systemStatus.json<any[]>())[0];
  
  const currentCoverage = (100 * status.total_resolutions_available / status.total_markets_traded);
  
  console.log(`Markets traded (total):        ${status.total_markets_traded.toLocaleString()}`);
  console.log(`Resolutions available:         ${status.total_resolutions_available.toLocaleString()}`);
  console.log(`  - From blockchain:           ${status.blockchain_resolutions.toLocaleString()}`);
  console.log(`  - From API:                  ${status.api_resolutions.toLocaleString()}`);
  console.log();
  console.log(`CURRENT COVERAGE:              ${currentCoverage.toFixed(2)}%`);
  console.log();

  if (currentCoverage >= 90) {
    console.log('🎉🎉🎉 EXCELLENT! Coverage ≥ 90% - PRODUCTION READY!');
  } else if (currentCoverage >= 80) {
    console.log('✅ GOOD! Coverage ≥ 80% - Ready for testing');
  } else if (currentCoverage >= 60) {
    console.log('⏳ IN PROGRESS: Coverage ≥ 60% - Continue backfill');
  } else {
    console.log('⚠️  LOW COVERAGE: Still collecting data');
  }
  console.log();

  console.log('═'.repeat(80));
  console.log('VERIFICATION COMPLETE');
  console.log('═'.repeat(80));

  await client.close();
}

main().catch(console.error);
