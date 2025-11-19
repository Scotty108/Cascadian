#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 60000,
});

const sql = `
DROP TABLE IF EXISTS default.resolutions_external_ingest;

CREATE TABLE default.resolutions_external_ingest (
    condition_id String COMMENT 'Normalized condition ID (lowercase, no 0x prefix)',
    payout_numerators Array(Float64) COMMENT 'Payout numerators for each outcome',
    payout_denominator Float64 COMMENT 'Payout denominator (sum of numerators or 1.0)',
    winning_index Int32 COMMENT 'Index of winning outcome (highest payout)',
    resolved_at DateTime COMMENT 'Resolution timestamp',
    source LowCardinality(String) COMMENT 'Data source (goldsky-api, blockchain, etc)',
    fetched_at DateTime DEFAULT now() COMMENT 'When this row was inserted'
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY condition_id
COMMENT 'External resolution data from Goldsky subgraph and other sources'
`;

async function main() {
  console.log('Creating table default.resolutions_external_ingest...');
  await ch.command({ query: sql });
  console.log('✅ Table created successfully');

  const verify = await ch.query({
    query: 'SELECT count() as cnt FROM default.resolutions_external_ingest',
    format: 'JSONEachRow'
  });
  const result = await verify.json<any>();
  console.log('Current rows:', result[0].cnt);

  await ch.close();
}

main().catch(console.error);
