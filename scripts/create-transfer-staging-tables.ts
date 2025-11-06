#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'default';

const client = createClient({
  host: CLICKHOUSE_HOST,
  username: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DATABASE,
  compression: { response: true },
});

async function createStagingTables() {
  try {
    console.log('Creating staging tables...\n');

    // ERC20 Transfers Staging Table (ReplacingMergeTree for deduplication)
    console.log('Creating erc20_transfers_staging...');
    await client.query({
      query: `
        CREATE TABLE IF NOT EXISTS erc20_transfers_staging (
          tx_hash String,
          log_index Int32,
          block_number UInt32,
          block_hash String,
          address String,
          topics Array(String),
          data String,
          removed Boolean,
          token_type String,
          created_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(created_at)
        PRIMARY KEY (tx_hash, log_index)
        ORDER BY (tx_hash, log_index)
      `,
    });
    console.log('✅ erc20_transfers_staging created');

    // ERC1155 Transfers Staging Table (ReplacingMergeTree for deduplication)
    console.log('Creating erc1155_transfers_staging...');
    await client.query({
      query: `
        CREATE TABLE IF NOT EXISTS erc1155_transfers_staging (
          tx_hash String,
          log_index Int32,
          block_number UInt32,
          block_hash String,
          address String,
          topics Array(String),
          data String,
          removed Boolean,
          token_type String,
          created_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(created_at)
        PRIMARY KEY (tx_hash, log_index)
        ORDER BY (tx_hash, log_index)
      `,
    });
    console.log('✅ erc1155_transfers_staging created');

    // Backfill Checkpoint Table
    console.log('Creating backfill_checkpoint...');
    await client.query({
      query: `
        CREATE TABLE IF NOT EXISTS backfill_checkpoint (
          day_idx UInt32,
          status String,
          shard_id Int32,
          erc20_count UInt32 DEFAULT 0,
          erc1155_count UInt32 DEFAULT 0,
          created_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(created_at)
        PRIMARY KEY (day_idx)
        ORDER BY (day_idx)
      `,
    });
    console.log('✅ backfill_checkpoint created');

    // Worker Heartbeats Table
    console.log('Creating worker_heartbeats...');
    await client.query({
      query: `
        CREATE TABLE IF NOT EXISTS worker_heartbeats (
          worker_id String,
          last_batch DateTime,
          updated_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(updated_at)
        PRIMARY KEY (worker_id)
        ORDER BY (worker_id)
      `,
    });
    console.log('✅ worker_heartbeats created');

    console.log('\n✅ All staging tables created successfully');
    await client.close();
  } catch (error) {
    console.error('❌ Error creating staging tables:', error);
    process.exit(1);
  }
}

createStagingTables();
