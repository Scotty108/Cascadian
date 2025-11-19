import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function createOrphanSamples() {
  console.log('Phase 3A: Creating orphan sample tables...\n');

  try {
    // Drop existing temp tables if they exist
    console.log('Cleaning up existing temp tables...');
    await clickhouse.command({
      query: 'DROP TABLE IF EXISTS tmp_v3_orphans_oct2024'
    });
    await clickhouse.command({
      query: 'DROP TABLE IF EXISTS tmp_v3_orphans_aug2024'
    });
    await clickhouse.command({
      query: 'DROP TABLE IF EXISTS tmp_v3_orphans_recent'
    });

    // Create October 2024 orphan sample
    console.log('\n1. Creating tmp_v3_orphans_oct2024...');
    await clickhouse.command({
      query: `
        CREATE TABLE tmp_v3_orphans_oct2024 ENGINE = Memory AS
        SELECT
          transaction_hash,
          wallet_address,
          outcome_index_v2,
          timestamp,
          id_repair_source,
          market_id_norm_v2,
          trade_direction,
          shares,
          price
        FROM pm_trades_canonical_v3_sandbox
        WHERE toYYYYMM(timestamp) = 202410
          AND (condition_id_norm_v2 IS NULL
               OR condition_id_norm_v2 = ''
               OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000')
        LIMIT 10000
      `
    });

    const oct2024Count = await clickhouse.query({
      query: 'SELECT count() as cnt FROM tmp_v3_orphans_oct2024',
      format: 'JSONEachRow'
    });
    const octRows = await oct2024Count.json();
    console.log('   ✓ Created with ' + octRows[0].cnt + ' orphans');

    // Create August 2024 orphan sample
    console.log('\n2. Creating tmp_v3_orphans_aug2024...');
    await clickhouse.command({
      query: `
        CREATE TABLE tmp_v3_orphans_aug2024 ENGINE = Memory AS
        SELECT
          transaction_hash,
          wallet_address,
          outcome_index_v2,
          timestamp,
          id_repair_source,
          market_id_norm_v2,
          trade_direction,
          shares,
          price
        FROM pm_trades_canonical_v3_sandbox
        WHERE toYYYYMM(timestamp) = 202408
          AND (condition_id_norm_v2 IS NULL
               OR condition_id_norm_v2 = ''
               OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000')
        LIMIT 10000
      `
    });

    const aug2024Count = await clickhouse.query({
      query: 'SELECT count() as cnt FROM tmp_v3_orphans_aug2024',
      format: 'JSONEachRow'
    });
    const augRows = await aug2024Count.json();
    console.log('   ✓ Created with ' + augRows[0].cnt + ' orphans');

    // Create recent months orphan sample (Sep-Nov 2024)
    console.log('\n3. Creating tmp_v3_orphans_recent...');
    await clickhouse.command({
      query: `
        CREATE TABLE tmp_v3_orphans_recent ENGINE = Memory AS
        SELECT
          transaction_hash,
          wallet_address,
          outcome_index_v2,
          timestamp,
          id_repair_source,
          market_id_norm_v2,
          trade_direction,
          shares,
          price
        FROM pm_trades_canonical_v3_sandbox
        WHERE toYYYYMM(timestamp) IN (202409, 202410, 202411)
          AND (condition_id_norm_v2 IS NULL
               OR condition_id_norm_v2 = ''
               OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000')
        LIMIT 10000
      `
    });

    const recentCount = await clickhouse.query({
      query: 'SELECT count() as cnt FROM tmp_v3_orphans_recent',
      format: 'JSONEachRow'
    });
    const recentRows = await recentCount.json();
    console.log('   ✓ Created with ' + recentRows[0].cnt + ' orphans');

    // Summary statistics
    console.log('\n' + '='.repeat(60));
    console.log('ORPHAN SAMPLE SUMMARY');
    console.log('='.repeat(60));
    console.log('October 2024:     ' + octRows[0].cnt + ' orphans');
    console.log('August 2024:      ' + augRows[0].cnt + ' orphans');
    console.log('Recent (Sep-Nov): ' + recentRows[0].cnt + ' orphans');
    console.log('='.repeat(60));

    // Show sample of each
    console.log('\nSample from tmp_v3_orphans_oct2024:');
    const octSample = await clickhouse.query({
      query: 'SELECT * FROM tmp_v3_orphans_oct2024 LIMIT 3',
      format: 'JSONEachRow'
    });
    const octSampleRows = await octSample.json();
    console.log(JSON.stringify(octSampleRows, null, 2));

  } catch (error) {
    console.error('Error creating orphan samples:', error);
    throw error;
  }
}

createOrphanSamples()
  .then(() => {
    console.log('\n✓ Phase 3A complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
