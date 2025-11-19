#!/usr/bin/env tsx
/**
 * Diagnose Invalid Payout Vectors
 *
 * Discovered: 148,105 markets (52.7%) have entries in resolution tables
 * but payout_denominator is NULL, 0, or invalid.
 *
 * This script investigates WHY these payouts are invalid.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔍 DIAGNOSING INVALID PAYOUT VECTORS');
  console.log('   Why do 148K markets have entries but no valid payouts?');
  console.log('═'.repeat(80));

  // Step 1: Break down by payout_denominator value
  console.log('\n📊 Step 1: Payout denominator distribution...\n');

  const denominatorBreakdown = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      )
      SELECT
        CASE
          WHEN r.payout_denominator IS NULL THEN 'NULL'
          WHEN r.payout_denominator = 0 THEN 'ZERO'
          WHEN r.payout_denominator < 0 THEN 'NEGATIVE'
          WHEN r.payout_denominator > 0 THEN 'VALID'
          ELSE 'OTHER'
        END as status,
        COUNT(DISTINCT tm.condition_id) as market_count
      FROM traded_markets tm
      LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
      GROUP BY status
      ORDER BY market_count DESC
    `,
    format: 'JSONEachRow',
  });

  const denominators = await denominatorBreakdown.json();
  console.log(`  Distribution by payout_denominator:\n`);
  for (const d of denominators) {
    const status = d.status;
    const count = parseInt(d.market_count).toLocaleString();
    const pct = (parseInt(d.market_count) / 280862 * 100).toFixed(1);
    console.log(`    ${status}: ${count} markets (${pct}%)`);
  }

  // Step 2: Check if these markets have multiple resolution entries
  console.log('\n📊 Step 2: Checking for duplicate resolution entries...\n');

  const duplicateCheck = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      ),
      resolution_counts AS (
        SELECT
          tm.condition_id,
          COUNT(*) as entry_count,
          SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as valid_count,
          SUM(CASE WHEN r.payout_denominator IS NULL THEN 1 ELSE 0 END) as null_count,
          SUM(CASE WHEN r.payout_denominator = 0 THEN 1 ELSE 0 END) as zero_count
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        GROUP BY tm.condition_id
      )
      SELECT
        entry_count,
        COUNT(*) as market_count,
        AVG(valid_count) as avg_valid,
        AVG(null_count) as avg_null,
        AVG(zero_count) as avg_zero
      FROM resolution_counts
      GROUP BY entry_count
      ORDER BY entry_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const duplicates = await duplicateCheck.json();
  console.log(`  Markets by number of resolution entries:\n`);
  for (const d of duplicates) {
    const entries = d.entry_count;
    const count = parseInt(d.market_count).toLocaleString();
    const avgValid = parseFloat(d.avg_valid).toFixed(2);
    const avgNull = parseFloat(d.avg_null).toFixed(2);
    const avgZero = parseFloat(d.avg_zero).toFixed(2);
    console.log(`    ${entries} entries: ${count} markets (avg valid: ${avgValid}, null: ${avgNull}, zero: ${avgZero})`);
  }

  // Step 3: Sample markets with invalid payouts
  console.log('\n📊 Step 3: Sampling markets with invalid payouts...\n');

  const invalidSamples = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, payout_numerators, source, winning_index
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, payout_numerators, source, winning_index
        FROM default.resolutions_external_ingest
      )
      SELECT
        tm.condition_id,
        r.payout_denominator,
        r.payout_numerators,
        r.winning_index,
        r.source,
        ams.question,
        ams.outcomes
      FROM traded_markets tm
      LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
      LEFT JOIN default.api_markets_staging ams ON tm.condition_id = lower(replaceAll(ams.condition_id, '0x', ''))
      WHERE (r.payout_denominator IS NULL OR r.payout_denominator <= 0)
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const samples = await invalidSamples.json();
  console.log(`  Sample of ${samples.length} markets with invalid payouts:\n`);

  for (let i = 0; i < Math.min(10, samples.length); i++) {
    const s = samples[i];
    const cid = s.condition_id ? s.condition_id.substring(0, 16) + '...' : 'N/A';
    const question = s.question ? s.question.substring(0, 50) + '...' : 'NO METADATA';
    const denom = s.payout_denominator ?? 'NULL';
    const nums = s.payout_numerators ? `[${s.payout_numerators.join(',')}]` : 'NULL';
    const source = s.source || 'N/A';

    console.log(`  ${i+1}. ${cid}`);
    console.log(`     Q: ${question}`);
    console.log(`     Payout: ${nums} / ${denom}`);
    console.log(`     Source: ${source}`);
    console.log();
  }

  // Step 4: Check resolution_candidates for these invalid markets
  console.log('\n📊 Step 4: Checking resolution_candidates for invalid markets...\n');

  const candidateCheck = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator
        FROM default.resolutions_external_ingest
      ),
      invalid_payouts AS (
        SELECT tm.condition_id
        FROM traded_markets tm
        LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
        WHERE (r.payout_denominator IS NULL OR r.payout_denominator <= 0)
      )
      SELECT
        COUNT(DISTINCT ip.condition_id) as invalid_count,
        SUM(CASE WHEN rc.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as has_candidate,
        SUM(CASE WHEN rc.confidence >= 0.9 THEN 1 ELSE 0 END) as high_confidence,
        SUM(CASE WHEN rc.outcome = 'INVALID' THEN 1 ELSE 0 END) as marked_invalid
      FROM invalid_payouts ip
      LEFT JOIN default.resolution_candidates rc ON ip.condition_id = rc.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const candidates = await candidateCheck.json();
  const invalidCount = parseInt(candidates[0].invalid_count);
  const hasCandidate = parseInt(candidates[0].has_candidate);
  const highConf = parseInt(candidates[0].high_confidence);
  const markedInvalid = parseInt(candidates[0].marked_invalid);

  console.log(`  Invalid markets: ${invalidCount.toLocaleString()}`);
  console.log(`  Has resolution candidate: ${hasCandidate.toLocaleString()} (${(hasCandidate/invalidCount*100).toFixed(1)}%)`);
  console.log(`  High confidence (>=0.9): ${highConf.toLocaleString()} (${(highConf/invalidCount*100).toFixed(1)}%)`);
  console.log(`  Marked as INVALID: ${markedInvalid.toLocaleString()} (${(markedInvalid/invalidCount*100).toFixed(1)}%)`);

  // Step 5: Break down by source for invalid payouts
  console.log('\n📊 Step 5: Invalid payouts by data source...\n');

  const sourceBreakdown = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator, source
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator, source
        FROM default.resolutions_external_ingest
      )
      SELECT
        r.source,
        COUNT(DISTINCT tm.condition_id) as market_count,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as valid_count,
        SUM(CASE WHEN r.payout_denominator IS NULL OR r.payout_denominator <= 0 THEN 1 ELSE 0 END) as invalid_count
      FROM traded_markets tm
      LEFT JOIN all_resolutions r ON tm.condition_id = r.condition_id_norm
      WHERE r.source IS NOT NULL
      GROUP BY r.source
      ORDER BY invalid_count DESC
      LIMIT 15
    `,
    format: 'JSONEachRow',
  });

  const sources = await sourceBreakdown.json();
  console.log(`  Invalid payouts by source:\n`);
  for (const s of sources) {
    const source = s.source;
    const total = parseInt(s.market_count);
    const valid = parseInt(s.valid_count);
    const invalid = parseInt(s.invalid_count);
    const invalidPct = (invalid / total * 100).toFixed(1);
    console.log(`    ${source}: ${invalid.toLocaleString()} invalid / ${total.toLocaleString()} total (${invalidPct}%)`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('🔍 DIAGNOSIS COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
