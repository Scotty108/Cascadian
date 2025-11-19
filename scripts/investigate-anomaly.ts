#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from './lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  console.log('INVESTIGATING THE ANOMALY\n');
  console.log('='.repeat(80));

  // The volume query showed 100% matched - this seems wrong given 24.7% match rate
  console.log('1. Re-run volume analysis with better query:\n');

  const volumeCheck = await client.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(m.condition_id_norm IS NOT NULL) as matched_trades,
        countIf(m.condition_id_norm IS NULL) as unmatched_trades,
        sum(t.usd_value) as total_usd,
        sumIf(t.usd_value, m.condition_id_norm IS NOT NULL) as matched_usd,
        sumIf(t.usd_value, m.condition_id_norm IS NULL) as unmatched_usd
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });

  const vol = await volumeCheck.json<any>();
  if (vol.length > 0) {
    const v = vol[0];
    console.log('Total trades (non-empty condition_id):');
    console.log(`  Total          : ${parseInt(v.total_trades).toLocaleString()}`);
    console.log(`  Matched        : ${parseInt(v.matched_trades).toLocaleString()} (${(parseInt(v.matched_trades) / parseInt(v.total_trades) * 100).toFixed(1)}%)`);
    console.log(`  Unmatched      : ${parseInt(v.unmatched_trades).toLocaleString()} (${(parseInt(v.unmatched_trades) / parseInt(v.total_trades) * 100).toFixed(1)}%)`);
    console.log('\nVolume:');
    console.log(`  Total USD      : $${parseFloat(v.total_usd).toLocaleString()}`);
    console.log(`  Matched USD    : $${parseFloat(v.matched_usd).toLocaleString()}`);
    console.log(`  Unmatched USD  : $${parseFloat(v.unmatched_usd).toLocaleString()}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('2. Check if empty condition_ids are the issue:\n');

  const emptyCheck = await client.query({
    query: `
      SELECT
        CASE
          WHEN condition_id = '' THEN 'Empty'
          WHEN condition_id LIKE 'token_%' THEN 'Token format'
          ELSE 'Valid hex'
        END as id_type,
        count() as trade_count,
        sum(usd_value) as total_usd
      FROM trades_raw
      GROUP BY id_type
      ORDER BY trade_count DESC
    `,
    format: 'JSONEachRow'
  });

  const empty = await emptyCheck.json<any>();
  console.log('Condition ID breakdown:');
  empty.forEach((e: any) => {
    console.log(`  ${e.id_type.padEnd(20)}: ${parseInt(e.trade_count).toLocaleString().padStart(15)} trades | $${parseFloat(e.total_usd).toLocaleString()}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('3. Sample some UNMATCHED condition_ids to verify they are real:\n');

  const unmatchedSample = await client.query({
    query: `
      SELECT
        t.condition_id,
        count() as trade_count,
        sum(t.usd_value) as total_usd,
        max(t.timestamp) as last_trade
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
        AND t.condition_id != ''
        AND t.condition_id NOT LIKE 'token_%'
      GROUP BY t.condition_id
      ORDER BY trade_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const unmatched = await unmatchedSample.json<any>();
  console.log('Top 5 unmatched condition_ids (by trade count):');
  unmatched.forEach((u: any, i: number) => {
    console.log(`\n  ${i + 1}. ${u.condition_id}`);
    console.log(`     Trades: ${parseInt(u.trade_count).toLocaleString()} | USD: $${parseFloat(u.total_usd).toLocaleString()}`);
    console.log(`     Last: ${u.last_trade}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('4. Check if DUPLICATE condition_ids exist in market_resolutions_final:\n');

  const dupCheck = await client.query({
    query: `
      SELECT
        condition_id_norm,
        count() as dup_count
      FROM market_resolutions_final
      GROUP BY condition_id_norm
      HAVING count() > 1
      ORDER BY dup_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const dups = await dupCheck.json<any>();
  if (dups.length > 0) {
    console.log(`Found ${dups.length} duplicate condition_ids in market_resolutions_final!`);
    console.log('Top 5:');
    dups.forEach((d: any, i: number) => {
      console.log(`  ${i + 1}. ${d.condition_id_norm} - ${d.dup_count} copies`);
    });
  } else {
    console.log('No duplicates found (all condition_id_norm are unique)');
  }

  console.log('\n' + '='.repeat(80));
  console.log('5. Verify the 57,655 matched count is correct:\n');

  const matchVerify = await client.query({
    query: `
      SELECT
        uniqExact(t.condition_id) as unique_matched_conditions,
        count() as total_matched_trades
      FROM trades_raw t
      INNER JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });

  const match = await matchVerify.json<any>();
  console.log('Matched statistics:');
  console.log(`  Unique matched condition_ids: ${parseInt(match[0].unique_matched_conditions).toLocaleString()}`);
  console.log(`  Total matched trades: ${parseInt(match[0].total_matched_trades).toLocaleString()}`);

  console.log('\n' + '='.repeat(80));
  console.log('6. Check one specific unmatched condition_id in detail:\n');

  if (unmatched.length > 0) {
    const testId = unmatched[0].condition_id;
    const normalized = testId.toLowerCase().replace('0x', '');

    console.log(`Testing: ${testId}`);
    console.log(`Normalized: ${normalized}`);

    // Check if it exists in market_resolutions_final with ANY format
    const existCheck = await client.query({
      query: `
        SELECT condition_id_norm, winning_outcome, source
        FROM market_resolutions_final
        WHERE condition_id_norm = '${normalized}'
           OR condition_id_norm = '${testId}'
           OR condition_id_norm = '${testId.toUpperCase()}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const exists = await existCheck.json();
    if (exists.length > 0) {
      console.log(`Found in market_resolutions_final!`);
      console.log(exists[0]);
    } else {
      console.log(`NOT found in market_resolutions_final (confirmed missing)`);
    }
  }

  console.log('\n');
}

main().catch(console.error);
