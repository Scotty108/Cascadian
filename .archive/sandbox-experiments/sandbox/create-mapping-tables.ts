import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

export async function createMappingTables(): Promise<void> {
  console.log('🗺️ Creating canonical mapping tables...');

  try {
    // Create sandbox database if not exists
    await clickhouse.query({
      query: 'CREATE DATABASE IF NOT EXISTS sandbox',
      format: 'JSONEachRow'
    });
    console.log('✅ Sandbox database verified');

    // Create token_cid_map table
    console.log('\n📊 Creating token_cid_map...');
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS sandbox.token_cid_map (
          token_hex LowCardinality(String),
          condition_id_64 LowCardinality(String),
          outcome_idx Int32
        )
        ENGINE = ReplacingMergeTree()
        ORDER BY token_hex
        SETTINGS index_granularity = 8192
      `,
      format: 'JSONEachRow'
    });

    // Populate token_cid_map from cascadian_clean.token_to_cid_bridge
    await clickhouse.query({
      query: `
        INSERT INTO sandbox.token_cid_map
        SELECT DISTINCT
          CAST(replaceAll(token_hex,'0x',''), 'String') AS token_hex,
          CAST(replaceAll(cid_hex,'0x',''), 'String') AS condition_id_64,
          CAST(outcome_index, 'Int32') AS outcome_idx
        FROM cascadian_clean.token_to_cid_bridge
        WHERE token_hex IS NOT NULL AND cid_hex IS NOT NULL
      `,
      format: 'JSONEachRow'
    });

    // Get stats on token_cid_map
    const tokenStats = await clickhouse.query({
      query: 'SELECT count() as total FROM sandbox.token_cid_map',
      format: 'JSONEachRow'
    });
    const tokenData = await tokenStats.json();
    console.log(`✅ token_cid_map created with ${tokenData[0].total} mappings`);

    // Create ctf_market_identity table
    console.log('\n📊 Creating ctf_market_identity...');
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS sandbox.ctf_market_identity (
          ctf_hex64 LowCardinality(String),
          market_hex64 LowCardinality(String)
        )
        ENGINE = ReplacingMergeTree()
        ORDER BY ctf_hex64
        SETTINGS index_granularity = 8192
      `,
      format: 'JSONEachRow'
    });

    // Populate ctf_market_identity from default.ctf_to_market_bridge_mat
    await clickhouse.query({
      query: `
        INSERT INTO sandbox.ctf_market_identity
        SELECT DISTINCT
          CAST(ctf_hex64, 'String') as ctf_hex64,
          CAST(market_hex64, 'String') as market_hex64
        FROM default.ctf_to_market_bridge_mat
        WHERE ctf_hex64 IS NOT NULL AND market_hex64 IS NOT NULL
      `,
      format: 'JSONEachRow'
    });

    // Get stats on ctf_market_identity
    const ctfStats = await clickhouse.query({
      query: 'SELECT count() as total FROM sandbox.ctf_market_identity',
      format: 'JSONEachRow'
    });
    const ctfData = await ctfStats.json();
    console.log(`✅ ctf_market_identity created with ${ctfData[0].total} mappings`);

    // Show a sample of the mappings
    console.log('\n🔍 Sample token mappings:');
    const sample = await clickhouse.query({
      query: `
        SELECT token_hex, condition_id_64, outcome_idx
        FROM sandbox.token_cid_map
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const sampleData = await sample.json();
    sampleData.forEach((row: any) => {
      console.log(`  ${row.token_hex.slice(0, 10)}... → ${row.condition_id_64.slice(0, 10)}...:${row.outcome_idx}`);
    });

    console.log('\n✅ Canonical mapping tables created successfully!');

  } catch (error) {
    console.error('❌ Mapping table creation failed:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createMappingTables()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}