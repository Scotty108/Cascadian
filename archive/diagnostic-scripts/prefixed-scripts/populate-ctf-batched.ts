import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Getting total count from view...');

  const countResult = await clickhouse.query({
    query: 'SELECT count(*) as count FROM ctf_token_decoded',
    format: 'JSONEachRow'
  });
  const totalCount = Number((await countResult.json())[0].count);
  console.log(`Total tokens to process: ${totalCount}\n`);

  const batchSize = 10000;
  const batches = Math.ceil(totalCount / batchSize);

  console.log(`Processing in ${batches} batches of ${batchSize}...\n`);

  for (let i = 0; i < batches; i++) {
    const offset = i * batchSize;
    console.log(`Batch ${i + 1}/${batches} (offset ${offset})...`);

    try {
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
      console.log(`  ✅ Inserted batch ${i + 1}`);
    } catch (err: any) {
      console.error(`  ❌ Failed batch ${i + 1}:`, err.message);
      throw err;
    }
  }

  console.log('\n✅ All batches completed\n');

  // Verify
  const finalCount = await clickhouse.query({
    query: 'SELECT count(*) as count FROM ctf_token_map',
    format: 'JSONEachRow'
  });
  const final = await finalCount.json();
  console.log(`Final row count: ${final[0].count}`);

  // Validate
  console.log('\nValidating...');
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
    'Total': validation[0].total,
    'Correct CIDs': validation[0].cid_correct,
    'Correct indices': validation[0].idx_correct,
    'Success %': pct
  });
}

main().catch(console.error);
