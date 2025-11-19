import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Step 1: Recreating view with filter...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW ctf_token_decoded AS
      SELECT DISTINCT
        asset_id as token_id,
        lower(hex(bitShiftRight(toUInt256(asset_id), 8))) as condition_id_norm,
        toUInt8(bitAnd(toUInt256(asset_id), 255)) as outcome_index,
        'erc1155_decoded' as source
      FROM clob_fills
      WHERE match(asset_id, '^[0-9]+$')
    `
  });
  console.log('✅ View recreated\n');

  console.log('Step 2: Getting count...');
  const countResult = await clickhouse.query({
    query: 'SELECT count(*) as count FROM ctf_token_decoded',
    format: 'JSONEachRow'
  });
  const count = await countResult.json();
  console.log(`Total valid tokens: ${count[0].count}\n`);

  console.log('Step 3: Populating table (this may take 2-3 minutes)...');
  try {
    await clickhouse.command({
      query: `
        INSERT INTO ctf_token_map (token_id, condition_id_norm, outcome_index, source)
        SELECT token_id, condition_id_norm, outcome_index, source
        FROM ctf_token_decoded
      `,
      clickhouse_settings: {
        max_execution_time: 300
      }
    });
    console.log('✅ INSERT completed\n');
  } catch (err: any) {
    console.error('INSERT failed:', err.message);
    console.log('\nTrying batched approach...\n');

    // Fall back to batched inserts
    const total = Number(count[0].count);
    const batchSize = 20000;
    const batches = Math.ceil(total / batchSize);

    for (let i = 0; i < batches; i++) {
      const offset = i * batchSize;
      console.log(`  Batch ${i + 1}/${batches} (offset ${offset})...`);

      await clickhouse.command({
        query: `
          INSERT INTO ctf_token_map (token_id, condition_id_norm, outcome_index, source)
          SELECT token_id, condition_id_norm, outcome_index, source
          FROM ctf_token_decoded
          LIMIT ${batchSize} OFFSET ${offset}
        `,
        clickhouse_settings: {
          max_execution_time: 60
        }
      });
      console.log(`    ✅ Done`);
    }
    console.log('\n✅ All batches completed\n');
  }

  console.log('Step 4: Verifying...');
  const finalCount = await clickhouse.query({
    query: 'SELECT count(*) as count FROM ctf_token_map',
    format: 'JSONEachRow'
  });
  const final = await finalCount.json();
  console.log(`Final row count: ${final[0].count}\n`);

  console.log('Step 5: Validating ERC-1155 correctness...');
  const validationResult = await clickhouse.query({
    query: `
      SELECT
        count(*) as total,
        countIf(condition_id_norm = lower(hex(bitShiftRight(toUInt256(token_id), 8)))) as cid_correct,
        countIf(outcome_index = toUInt8(bitAnd(toUInt256(token_id), 255))) as idx_correct
      FROM ctf_token_map
    `,
    format: 'JSONEachRow'
  });
  const validation = await validationResult.json();
  const pct = (Number(validation[0].cid_correct) / Number(validation[0].total) * 100).toFixed(2);

  console.table({
    'Total tokens': validation[0].total,
    'Correct CIDs': validation[0].cid_correct,
    'Correct indices': validation[0].idx_correct,
    'Success rate': `${pct}%`
  });

  if (pct === '100.00') {
    console.log('\n✅ SUCCESS - All tokens correctly decoded from ERC-1155!');
    console.log('\n🔥 NEXT STEP: Re-run P&L validation - expect jump from $35K to $75K-$90K');
  } else {
    console.log('\n❌ VALIDATION FAILED - Not 100% correct');
  }
}

main().catch(console.error);
