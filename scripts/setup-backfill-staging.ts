#!/usr/bin/env npx tsx

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('PHASE 0: STAGING SETUP & WORKLOAD SPLIT');
  console.log('═'.repeat(80));
  console.log();

  // 1. Baseline metrics
  console.log('[1] Baseline Metrics');
  console.log('─'.repeat(80));

  const totalTokens = await clickhouse.query({
    query: 'SELECT uniq(asset_id) AS total FROM default.clob_fills',
    format: 'JSONEachRow'
  });
  const total = (await totalTokens.json())[0].total;

  const mappedTokens = await clickhouse.query({
    query: `SELECT uniq(token_id) AS mapped FROM default.ctf_token_map WHERE condition_id_norm != ''`,
    format: 'JSONEachRow'
  });
  const mapped = (await mappedTokens.json())[0].mapped;

  const unmapped = total - mapped;
  const currentCoverage = (mapped / total * 100).toFixed(1);

  console.log(`Total unique asset_ids:  ${parseInt(total).toLocaleString()}`);
  console.log(`Currently mapped:        ${parseInt(mapped).toLocaleString()} (${currentCoverage}%)`);
  console.log(`Unmapped (target):       ${parseInt(unmapped).toLocaleString()}`);
  console.log();

  // 2. Create staging database
  console.log('[2] Creating Staging Infrastructure');
  console.log('─'.repeat(80));

  await clickhouse.query({ query: 'CREATE DATABASE IF NOT EXISTS staging' });
  console.log('✓ Staging database ready');

  // 3. Create staging tables
  await clickhouse.query({
    query: `
      CREATE TABLE IF NOT EXISTS staging.clob_asset_map_dome (
        token_id String,
        condition_id_norm String,
        outcome_index UInt8,
        outcome_label String,
        source String DEFAULT 'dome_api',
        fetched_at DateTime DEFAULT now()
      ) ENGINE = MergeTree() ORDER BY token_id
    `
  });
  console.log('✓ staging.clob_asset_map_dome created');

  await clickhouse.query({
    query: `
      CREATE TABLE IF NOT EXISTS staging.clob_asset_map_goldsky (
        token_id String,
        condition_id_norm String,
        outcome_index UInt8,
        outcome_label String,
        source String DEFAULT 'goldsky_subgraph',
        fetched_at DateTime DEFAULT now()
      ) ENGINE = MergeTree() ORDER BY token_id
    `
  });
  console.log('✓ staging.clob_asset_map_goldsky created');
  console.log();

  // 4. Create unmapped tokens list
  console.log('[3] Identifying Unmapped Tokens');
  console.log('─'.repeat(80));

  await clickhouse.query({
    query: `
      CREATE OR REPLACE TABLE staging.unmapped_tokens
      ENGINE = MergeTree()
      ORDER BY asset_id
      AS
      SELECT DISTINCT cf.asset_id
      FROM default.clob_fills cf
      LEFT JOIN default.ctf_token_map c ON cf.asset_id = c.token_id
      WHERE c.condition_id_norm IS NULL OR c.condition_id_norm = ''
    `
  });

  const unmappedCount = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM staging.unmapped_tokens',
    format: 'JSONEachRow'
  });
  const unmappedTotal = (await unmappedCount.json())[0].cnt;
  console.log(`Unmapped tokens identified: ${parseInt(unmappedTotal).toLocaleString()}`);
  console.log();

  // 5. Split 50/50
  console.log('[4] Splitting Workload (50/50)');
  console.log('─'.repeat(80));

  const splitPoint = Math.floor(parseInt(unmappedTotal) / 2);

  await clickhouse.query({
    query: `
      CREATE OR REPLACE TABLE staging.unmapped_tokens_dome
      ENGINE = MergeTree()
      ORDER BY asset_id
      AS
      SELECT asset_id FROM staging.unmapped_tokens
      ORDER BY asset_id
      LIMIT ${splitPoint}
    `
  });

  await clickhouse.query({
    query: `
      CREATE OR REPLACE TABLE staging.unmapped_tokens_goldsky
      ENGINE = MergeTree()
      ORDER BY asset_id
      AS
      SELECT asset_id FROM staging.unmapped_tokens
      WHERE asset_id NOT IN (SELECT asset_id FROM staging.unmapped_tokens_dome)
    `
  });

  const domeCount = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM staging.unmapped_tokens_dome',
    format: 'JSONEachRow'
  });
  const goldskyCount = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM staging.unmapped_tokens_goldsky',
    format: 'JSONEachRow'
  });

  const domeTotal = (await domeCount.json())[0].cnt;
  const goldskyTotal = (await goldskyCount.json())[0].cnt;

  console.log(`Dome API track:      ${parseInt(domeTotal).toLocaleString()} tokens`);
  console.log(`Goldsky track:       ${parseInt(goldskyTotal).toLocaleString()} tokens`);
  console.log();

  console.log('═'.repeat(80));
  console.log('✅ PHASE 0 COMPLETE - Ready to launch parallel backfill');
  console.log('═'.repeat(80));
}

main().catch(console.error);
