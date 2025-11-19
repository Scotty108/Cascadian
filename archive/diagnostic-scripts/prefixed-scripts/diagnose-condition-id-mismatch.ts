/**
 * DIAGNOSE CONDITION ID MISMATCH
 *
 * Why do counting queries show resolved assets but joins find none?
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSE CONDITION ID MISMATCH');
  console.log('═══════════════════════════════════════════════════════════\n');

  const CONTROL_WALLET = fs.readFileSync('CONTROL_WALLET.txt', 'utf-8').trim();

  // Step 1: Count resolved assets (the query that shows 100)
  console.log('📊 Step 1: Counting resolved assets (CTE approach)...\n');

  const countQuery = await clickhouse.query({
    query: `
      WITH wallet_assets AS (
        SELECT DISTINCT
          asset_id,
          lpad(lower(hex(bitShiftRight(CAST(asset_id AS UInt256), 8))), 64, '0') as condition_id_norm,
          toUInt8(bitAnd(CAST(asset_id AS UInt256), 255)) as outcome_index
        FROM clob_fills
        WHERE proxy_wallet = '${CONTROL_WALLET}'
      )
      SELECT
        count() as total_assets,
        countIf(r.winning_index IS NOT NULL) as resolved_count
      FROM wallet_assets wa
      LEFT JOIN market_resolutions_final r
        ON wa.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const count: any = (await countQuery.json())[0];
  console.log(`Total assets: ${count.total_assets}`);
  console.log(`Resolved (via COUNT): ${count.resolved_count}\n`);

  // Step 2: Sample some condition_ids that should match
  console.log('📊 Step 2: Sampling condition_ids that match resolutions...\n');

  const sampleQuery = await clickhouse.query({
    query: `
      WITH wallet_assets AS (
        SELECT DISTINCT
          asset_id,
          lpad(lower(hex(bitShiftRight(CAST(asset_id AS UInt256), 8))), 64, '0') as condition_id_norm,
          toUInt8(bitAnd(CAST(asset_id AS UInt256), 255)) as outcome_index
        FROM clob_fills
        WHERE proxy_wallet = '${CONTROL_WALLET}'
      )
      SELECT
        wa.asset_id,
        wa.condition_id_norm,
        wa.outcome_index,
        r.winning_index,
        r.outcome_count
      FROM wallet_assets wa
      INNER JOIN market_resolutions_final r
        ON wa.condition_id_norm = r.condition_id_norm
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  if (samples.length > 0) {
    console.log('✅ Found resolved assets via INNER JOIN:\n');
    for (const s of samples) {
      console.log(`  Asset: ${s.asset_id}`);
      console.log(`  Condition: ${s.condition_id_norm.substring(0, 30)}...`);
      console.log(`  Outcome Index: ${s.outcome_index}`);
      console.log(`  Winning Index: ${s.winning_index}`);
      console.log(`  Outcome Count: ${s.outcome_count}\n`);
    }
  } else {
    console.log('❌ NO resolved assets found via INNER JOIN\n');
  }

  // Step 3: Try loading fills individually and checking
  console.log('📊 Step 3: Loading fills and checking resolutions individually...\n');

  const fillsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        asset_id,
        lpad(lower(hex(bitShiftRight(CAST(asset_id AS UInt256), 8))), 64, '0') as condition_id_norm,
        toUInt8(bitAnd(CAST(asset_id AS UInt256), 255)) as outcome_index
      FROM clob_fills
      WHERE proxy_wallet = '${CONTROL_WALLET}'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const fills: any[] = await fillsQuery.json();

  let foundResolved = 0;
  for (const fill of fills) {
    const resQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          outcome_count
        FROM market_resolutions_final
        WHERE condition_id_norm = '${fill.condition_id_norm}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const res: any[] = await resQuery.json();

    if (res.length > 0) {
      console.log(`  ✅ Asset ${fill.asset_id.substring(0, 20)}... IS resolved`);
      console.log(`     Condition: ${fill.condition_id_norm.substring(0, 30)}...`);
      console.log(`     Winner: ${res[0].winning_index}\n`);
      foundResolved++;
    }
  }

  console.log(`Found ${foundResolved}/10 resolved via individual queries\n`);

  // Step 4: Check if the issue is with how we load in TypeScript
  console.log('📊 Step 4: Testing TypeScript condition_id generation...\n');

  const testAssetId = fills[0].asset_id;
  console.log(`Test asset_id: ${testAssetId}`);

  // Decode in TypeScript
  const tokenBigInt = BigInt(testAssetId);
  const condition_id_bigint = tokenBigInt >> 8n;
  const outcome_index = Number(tokenBigInt & 255n);
  const condition_id_norm = condition_id_bigint.toString(16).toLowerCase().padStart(64, '0');

  console.log(`TypeScript decoded:`);
  console.log(`  Condition ID: ${condition_id_norm}`);
  console.log(`  Outcome Index: ${outcome_index}\n`);

  // Compare with SQL decode
  console.log(`SQL decoded:`);
  console.log(`  Condition ID: ${fills[0].condition_id_norm}`);
  console.log(`  Outcome Index: ${fills[0].outcome_index}\n`);

  if (condition_id_norm === fills[0].condition_id_norm && outcome_index === fills[0].outcome_index) {
    console.log('✅ TypeScript and SQL decodes MATCH\n');
  } else {
    console.log('❌ TypeScript and SQL decodes DIFFER\n');
  }

  console.log('✅ DIAGNOSIS COMPLETE\n');
}

main().catch(console.error);
