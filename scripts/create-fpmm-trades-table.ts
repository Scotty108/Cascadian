/**
 * Create ClickHouse table for FPMM (Fixed Product Market Maker) trades
 *
 * This table receives data from the Goldsky direct indexing pipeline:
 * goldsky/fpmm-direct-indexing.yaml
 *
 * FPMM trades are AMM trades that are NOT captured in the CLOB data.
 * They represent ~21% of Polymarket market activity.
 *
 * Terminal: Claude 3
 * Date: 2025-11-25
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function createFPMMTable() {
  console.log('\n🔧 Creating FPMM Trades Table\n');
  console.log('='.repeat(80));

  // Step 1: Create the table
  console.log('\n📊 Step 1: Creating pm_fpmm_trades table\n');

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS pm_fpmm_trades (
      id String,
      block_number UInt64,
      block_timestamp DateTime,
      transaction_hash String,
      log_index UInt32,
      fpmm_pool_address String,
      event_type String,
      trader_wallet String,
      outcome_index UInt8,
      side String,
      usdc_amount Float64,
      fee_usdc Float64,
      token_amount Float64,
      price Nullable(Float64),
      insert_time DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(insert_time)
    ORDER BY (trader_wallet, fpmm_pool_address, id)
    SETTINGS index_granularity = 8192
  `;

  await clickhouse.command({ query: createTableSQL });
  console.log('   ✅ pm_fpmm_trades table created');

  // Step 2: Create mapping table to link FPMM pools to condition_ids
  console.log('\n📊 Step 2: Creating pm_fpmm_pool_map table\n');

  const createPoolMapSQL = `
    CREATE TABLE IF NOT EXISTS pm_fpmm_pool_map (
      fpmm_pool_address String,
      condition_id String,
      question String,
      created_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(created_at)
    ORDER BY (fpmm_pool_address)
  `;

  await clickhouse.command({ query: createPoolMapSQL });
  console.log('   ✅ pm_fpmm_pool_map table created');

  // Step 3: Show next steps
  console.log('\n' + '='.repeat(80));
  console.log('\n✅ FPMM TABLES CREATED\n');
  console.log('NEXT STEPS:');
  console.log('');
  console.log('1. Deploy the Goldsky pipeline:');
  console.log('   goldsky pipeline apply goldsky/fpmm-direct-indexing.yaml');
  console.log('');
  console.log('2. Monitor pipeline progress:');
  console.log('   goldsky pipeline status cascadian-fpmm-trades');
  console.log('');
  console.log('3. After backfill, populate the pool map from Gamma API:');
  console.log('   npx tsx scripts/populate-fpmm-pool-map.ts');
  console.log('');
  console.log('4. Create unified view combining CLOB + CTF + FPMM:');
  console.log('   npx tsx scripts/create-unified-ledger-v4.ts');
  console.log('');
  console.log('='.repeat(80));

  await clickhouse.close();
}

createFPMMTable()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
