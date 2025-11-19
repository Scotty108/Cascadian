import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Populating ctf_token_map from view...');
  console.log('This may take 2-3 minutes...\n');

  try {
    // Simple INSERT SELECT from the existing view
    await clickhouse.command({
      query: `
        INSERT INTO ctf_token_map (token_id, condition_id_norm, outcome_index, source)
        SELECT token_id, condition_id_norm, outcome_index, source
        FROM ctf_token_decoded
      `,
      clickhouse_settings: {
        max_execution_time: 300,
        send_timeout: 300,
        receive_timeout: 300
      }
    });

    console.log('✅ INSERT completed\n');

    // Verify count
    const countResult = await clickhouse.query({
      query: 'SELECT count(*) as count FROM ctf_token_map',
      format: 'JSONEachRow'
    });
    const count = await countResult.json();
    console.log(`Row count: ${count[0].count}\n`);

    // Validate correctness
    console.log('Validating ERC-1155 decoding...');
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
      console.log('\n✅ SUCCESS - All tokens correctly decoded!');
    } else {
      console.log('\n❌ VALIDATION FAILED - Not 100% correct');
    }

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
