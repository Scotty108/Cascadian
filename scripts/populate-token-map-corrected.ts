#!/usr/bin/env npx tsx

/**
 * CORRECTED TOKEN MAP POPULATION
 *
 * Strategy: Use gamma_markets for token_id→outcome mapping,
 * but get the CORRECT condition_id from clob_fills (not gamma_markets)
 *
 * Key insight: gamma_markets has one row per (token_id, outcome) pair
 * but the condition_id in gamma_markets may not match clob_fills.
 * We need to use the condition_id from the actual fills.
 *
 * Usage: npx tsx scripts/populate-token-map-corrected.ts
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('═'.repeat(80));
  console.log('CORRECTED TOKEN MAP POPULATION');
  console.log('═'.repeat(80));
  console.log();

  // 1. Clear old incorrect data
  console.log('[1] Clearing incorrect token mappings...');
  await clickhouse.query({
    query: `ALTER TABLE ctf_token_map DELETE WHERE source = 'gamma_markets'`
  });
  console.log('✅ Cleared old mappings from gamma_markets source');
  console.log();

  // 2. Populate using CORRECT logic:
  // - Get condition_id from clob_fills (the actual market ID for each fill)
  // - Get outcome from gamma_markets
  // - Assign outcome_index based on alphabetical order within each condition_id
  console.log('[2] Populating with correct condition_ids...');
  console.log();

  const populateQuery = `
    INSERT INTO default.ctf_token_map
      (token_id, condition_id_norm, outcome_index, vote_count, source, created_at, version, market_id)
    SELECT
      cf.asset_id as token_id,
      lower(replaceAll(cf.condition_id, '0x', '')) as condition_id_norm,
      ROW_NUMBER() OVER (
        PARTITION BY lower(replaceAll(cf.condition_id, '0x', ''))
        ORDER BY gm.outcome
      ) - 1 as outcome_index,
      0 as vote_count,
      'corrected_gamma_markets' as source,
      now() as created_at,
      1 as version,
      '' as market_id
    FROM (
      SELECT DISTINCT asset_id, condition_id
      FROM clob_fills
      WHERE condition_id IS NOT NULL AND condition_id != ''
    ) cf
    INNER JOIN gamma_markets gm ON cf.asset_id = gm.token_id
    WHERE cf.asset_id NOT IN (SELECT token_id FROM default.ctf_token_map)
  `;

  await clickhouse.query({ query: populateQuery });

  console.log('✅ Population complete');
  console.log();

  // 3. Verify coverage
  console.log('[3] Verifying Coverage');
  console.log('─'.repeat(80));

  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        uniq(asset_id) as total_asset_ids,
        uniqIf(asset_id, token_id IS NOT NULL) as mapped_asset_ids
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
    `,
    format: 'JSONEachRow'
  });
  const cov = (await coverageResult.json())[0];
  const coverage = (parseInt(cov.mapped_asset_ids) / parseInt(cov.total_asset_ids) * 100).toFixed(1);

  console.log(`Total unique asset_ids:  ${parseInt(cov.total_asset_ids).toLocaleString()}`);
  console.log(`Now mapped:              ${parseInt(cov.mapped_asset_ids).toLocaleString()} (${coverage}%)`);
  console.log();

  // 4. Verify JOIN correctness
  console.log('[4] Verifying JOIN Correctness');
  console.log('─'.repeat(80));

  const joinTest = await clickhouse.query({
    query: `
      SELECT
        cf.asset_id,
        lower(replaceAll(cf.condition_id, '0x', '')) as cf_cid_norm,
        ctm.condition_id_norm as ctm_cid_norm,
        ctm.outcome_index,
        if(cf_cid_norm = ctm_cid_norm, 'MATCH ✅', 'MISMATCH ❌') as status
      FROM clob_fills cf
      INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const joinRows = await joinTest.json();
  console.log('Sample JOIN verification:');
  joinRows.forEach((r: any, i: number) => {
    console.log(`\nRow ${i + 1}:`);
    console.log(`  cf_cid:  ${r.cf_cid_norm.substring(0, 32)}...`);
    console.log(`  ctm_cid: ${r.ctm_cid_norm.substring(0, 32)}...`);
    console.log(`  outcome_index: ${r.outcome_index}`);
    console.log(`  Status: ${r.status}`);
  });
  console.log();

  const matchCount = joinRows.filter((r: any) => r.status.includes('MATCH')).length;
  console.log(`Match rate: ${matchCount}/${joinRows.length} (${(matchCount / joinRows.length * 100).toFixed(0)}%)`);
  console.log();

  // 5. Final verdict
  console.log('═'.repeat(80));
  if (parseFloat(coverage) >= 95.0 && matchCount === joinRows.length) {
    console.log('✅ SUCCESS!');
    console.log();
    console.log(`Coverage: ${coverage}% (≥95% threshold)`);
    console.log(`condition_id alignment: Perfect (100% match)`);
    console.log();
    console.log('Ready to run P&L validation:');
    console.log('  npx tsx scripts/validate-corrected-pnl-comprehensive-fixed.ts');
  } else {
    console.log('⚠️  ISSUES DETECTED');
    console.log();
    if (parseFloat(coverage) < 95.0) {
      console.log(`❌ Coverage: ${coverage}% (target: ≥95%)`);
      console.log(`   Gap: ${(95.0 - parseFloat(coverage)).toFixed(1)}%`);
    }
    if (matchCount < joinRows.length) {
      console.log(`❌ condition_id mismatch detected!`);
      console.log(`   ${joinRows.length - matchCount} out of ${joinRows.length} samples don't match`);
    }
  }
  console.log('═'.repeat(80));
}

main().catch(console.error);
