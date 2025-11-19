/**
 * 26: CHECK MARKET_RESOLUTIONS_FINAL SCHEMA
 *
 * Verify what columns and data market_resolutions_final actually has
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('26: CHECK MARKET_RESOLUTIONS_FINAL SCHEMA');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Check schema...\n');

  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE market_resolutions_final`,
    format: 'JSONEachRow'
  });

  const schema: any[] = await schemaQuery.json();

  console.log('Schema:');
  console.table(schema.map(s => ({ name: s.name, type: s.type })));

  console.log('\n📊 Step 2: Sample rows...\n');

  const sampleQuery = await clickhouse.query({
    query: `SELECT * FROM market_resolutions_final LIMIT 5`,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  console.log('Sample rows:');
  console.log(JSON.stringify(samples, null, 2));

  console.log('\n📊 Step 3: Check if it has condition_id_norm column...\n');

  const hasConditionId = schema.some(s => s.name === 'condition_id_norm' || s.name === 'condition_id');

  if (hasConditionId) {
    console.log('✅ Has condition_id column\n');

    // Check if these condition_ids match traded assets
    const overlapQuery = await clickhouse.query({
      query: `
        WITH traded_sample AS (
          SELECT DISTINCT cm.condition_id_norm
          FROM clob_fills cf
          INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
          WHERE cf.timestamp >= '2025-01-01'
          LIMIT 100
        )
        SELECT
          count() AS traded_sample_size,
          countIf(mr.condition_id_norm IS NOT NULL OR mr.condition_id IS NOT NULL) AS has_match
        FROM traded_sample ts
        LEFT JOIN market_resolutions_final mr
          ON mr.condition_id_norm = ts.condition_id_norm
          OR mr.condition_id = ts.condition_id_norm
      `,
      format: 'JSONEachRow'
    });

    const overlap: any = (await overlapQuery.json())[0];

    console.log('Overlap with traded assets:');
    console.log(`  Traded sample: ${overlap.traded_sample_size}`);
    console.log(`  Has match: ${overlap.has_match}\n`);
  } else {
    console.log('❌ Does NOT have condition_id column\n');
    console.log('Available columns:', schema.map(s => s.name).join(', '));
  }

  console.log('\n✅ CHECK COMPLETE\n');
}

main().catch(console.error);
