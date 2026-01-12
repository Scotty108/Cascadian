import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function test() {
  const testRow = {
    tx_hash: 'test_' + Date.now(),
    log_index: 0,
    block_number: 1,
    block_timestamp: '2026-01-12 10:00:00',
    contract: '0xtest',
    token_id: '123',
    from_address: '0xfrom',
    to_address: '0xto',
    value: '1',
    operator: '0xop',
    is_deleted: 1  // Mark as deleted so it doesn't pollute data
  };
  
  console.log('Testing insert with row:', testRow);
  
  try {
    await clickhouse.insert({
      table: 'pm_erc1155_transfers',
      values: [testRow],
      format: 'JSONEachRow'
    });
    console.log('✅ Insert succeeded!');
  } catch (err: any) {
    console.log('❌ Insert failed:', err.message);
  }
}

test();
