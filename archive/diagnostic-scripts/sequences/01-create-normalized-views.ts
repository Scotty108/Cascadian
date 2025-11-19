/**
 * 01: CREATE NORMALIZED VIEWS
 *
 * Fix the condition_id mismatch by normalizing to 64-char lowercase hex
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('01: CREATE NORMALIZED VIEWS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1A) Normalize the token map
  console.log('📊 Creating ctf_token_map_norm...\n');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW ctf_token_map_norm AS
      SELECT
        token_id AS asset_id,
        token_id AS token_id_dec,
        lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS condition_id_norm,
        outcome_index,
        market_id
      FROM ctf_token_map
    `
  });

  console.log('✅ Created ctf_token_map_norm\n');

  // 1B) Normalize resolutions
  console.log('📊 Creating market_resolutions_norm...\n');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW market_resolutions_norm AS
      SELECT
        condition_id_norm,
        winning_index,
        payout_numerators,
        ifNull(payout_denominator, 1) AS payout_denominator,
        resolved_at
      FROM market_resolutions_final
    `
  });

  console.log('✅ Created market_resolutions_norm\n');

  // Verify views exist
  console.log('📊 Verifying views...\n');

  const verifyTokenMap = await clickhouse.query({
    query: 'SELECT count() as count FROM ctf_token_map_norm LIMIT 1',
    format: 'JSONEachRow'
  });

  const tokenMapCount: any = (await verifyTokenMap.json())[0];
  console.log(`  ctf_token_map_norm: ${tokenMapCount.count.toLocaleString()} rows\n`);

  const verifyResolutions = await clickhouse.query({
    query: 'SELECT count() as count FROM market_resolutions_norm LIMIT 1',
    format: 'JSONEachRow'
  });

  const resolutionsCount: any = (await verifyResolutions.json())[0];
  console.log(`  market_resolutions_norm: ${resolutionsCount.count.toLocaleString()} rows\n`);

  console.log('✅ NORMALIZED VIEWS CREATED\n');
  console.log('Next: Run 02-check-resolution-coverage.ts\n');
}

main().catch(console.error);
