/**
 * DIAGNOSE RESOLUTION MISMATCH
 *
 * Why aren't condition_ids matching market_resolutions_final?
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSE RESOLUTION MISMATCH');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Sample condition_ids from checkpoint A
  const testConditions = [
    '00d03f68a6adf946',
    '00dff5797f369025',
    '0053bff3cc2b20d2',
    '004faf3ffdc606ab',
    '0004eb7841564beb'
  ];

  console.log('📊 Checking if condition_ids exist in market_resolutions_final...\n');

  for (const cid of testConditions) {
    const query = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          outcome_count,
          resolved_at
        FROM market_resolutions_final
        WHERE condition_id_norm LIKE '${cid}%'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const res: any[] = await query.json();

    if (res.length > 0) {
      console.log(`✅ ${cid}... FOUND`);
      console.log(`   Full: ${res[0].condition_id_norm}`);
      console.log(`   Winner: ${res[0].winning_index}`);
      console.log(`   Outcomes: ${res[0].outcome_count}`);
      console.log(`   Resolved: ${res[0].resolved_at}\n`);
    } else {
      console.log(`❌ ${cid}... NOT FOUND\n`);
    }
  }

  // Check format of condition_id_norm in market_resolutions_final
  console.log('📊 Sample condition_id_norm from market_resolutions_final:\n');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        outcome_count,
        length(condition_id_norm) as id_length
      FROM market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();
  for (const s of samples) {
    console.log(`  ${s.condition_id_norm.substring(0, 30)}... (${s.id_length} chars)`);
  }

  // Check format in ctf_token_map
  console.log('\n📊 Sample condition_id_norm from ctf_token_map:\n');

  const ctfSampleQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        length(condition_id_norm) as id_length
      FROM ctf_token_map
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const ctfSamples: any[] = await ctfSampleQuery.json();
  for (const s of ctfSamples) {
    console.log(`  ${s.condition_id_norm.substring(0, 30)}... (${s.id_length} chars)`);
  }

  // Check if our wallet has ANY resolved positions
  console.log('\n📊 Checking if wallet has ANY resolved positions...\n');

  const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const walletResolvedQuery = await clickhouse.query({
    query: `
      SELECT COUNT(*) as resolved_count
      FROM clob_fills f
      INNER JOIN ctf_token_map t
        ON f.asset_id = t.token_id
      INNER JOIN market_resolutions_final r
        ON t.condition_id_norm = r.condition_id_norm
      WHERE f.proxy_wallet = '${TARGET_WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const walletResolved: any = (await walletResolvedQuery.json())[0];
  console.log(`Fills with resolved markets: ${walletResolved.resolved_count} / 194\n`);

  if (walletResolved.resolved_count === 0) {
    console.log('❌ ZERO resolved positions found!\n');
    console.log('Possible causes:');
    console.log('  1. condition_id_norm format mismatch between tables');
    console.log('  2. ctf_token_map has wrong condition_ids');
    console.log('  3. This wallet truly has no resolved positions\n');
  } else {
    console.log(`✅ Found ${walletResolved.resolved_count} resolved positions\n`);

    // Sample some resolved positions
    const sampleResolvedQuery = await clickhouse.query({
      query: `
        SELECT
          f.asset_id,
          t.token_id,
          t.condition_id_norm,
          t.outcome_index,
          r.winning_index,
          r.outcome_count
        FROM clob_fills f
        INNER JOIN ctf_token_map t
          ON f.asset_id = t.token_id
        INNER JOIN market_resolutions_final r
          ON t.condition_id_norm = r.condition_id_norm
        WHERE f.proxy_wallet = '${TARGET_WALLET}'
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const resolvedSamples: any[] = await sampleResolvedQuery.json();

    console.log('Sample resolved positions:');
    for (const s of resolvedSamples) {
      console.log(`  Token: ${s.token_id.substring(0, 30)}...`);
      console.log(`    Condition: ${s.condition_id_norm.substring(0, 30)}...`);
      console.log(`    Outcome Index: ${s.outcome_index}`);
      console.log(`    Winning Index: ${s.winning_index}`);
      console.log(`    Outcome Count: ${s.outcome_count}\n`);
    }
  }

  console.log('✅ DIAGNOSIS COMPLETE\n');
}

main().catch(console.error);
