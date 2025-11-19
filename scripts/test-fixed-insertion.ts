#!/usr/bin/env tsx
/**
 * Test the fixed insertion method with decimal payouts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 120000,
});

async function testFixedInsert() {
  console.log('🧪 Testing FIXED insertion method...\n');

  const testRows = [
    {
      condition_id: 'test_integer',
      payout_numerators: [1, 0],
      payout_denominator: 1,
      winning_index: 0,
      resolved_at: new Date().toISOString(),
      source: 'test',
    },
    {
      condition_id: 'test_decimal',
      payout_numerators: [0.54, 0.46],
      payout_denominator: 1,
      winning_index: 0,
      resolved_at: new Date().toISOString(),
      source: 'test',
    },
    {
      condition_id: 'test_three_outcomes',
      payout_numerators: [0.33, 0.33, 0.34],
      payout_denominator: 1,
      winning_index: 2,
      resolved_at: new Date().toISOString(),
      source: 'test',
    },
  ];

  console.log('Test data:');
  testRows.forEach((row) => {
    console.log(`  - ${row.condition_id}: [${row.payout_numerators.join(', ')}]`);
  });
  console.log('');

  try {
    const values = testRows
      .map((row) => {
        const arrayStr = `[${row.payout_numerators.join(',')}]`;
        return `('${row.condition_id}', ${arrayStr}, ${row.payout_denominator}, ${row.winning_index}, '${row.resolved_at}', '${row.source}')`;
      })
      .join(',\n    ');

    const query = `
      INSERT INTO default.resolutions_external_ingest
      (condition_id, payout_numerators, payout_denominator, winning_index, resolved_at, source)
      VALUES
      ${values}
    `;

    console.log('Executing INSERT...');
    await ch.command({ query });
    console.log('✅ All test rows inserted successfully!\n');

    // Verify
    const result = await ch.query({
      query: `
        SELECT condition_id, payout_numerators, payout_denominator, winning_index, source
        FROM default.resolutions_external_ingest
        WHERE source = 'test'
        ORDER BY condition_id
      `,
      format: 'JSONEachRow',
    });

    const data = await result.json<any>();
    console.log('📊 Verification:');
    data.forEach((row: any) => {
      console.log(`  - ${row.condition_id}: [${row.payout_numerators.join(', ')}]`);
    });

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await ch.command({
      query: "DELETE FROM default.resolutions_external_ingest WHERE source = 'test'",
    });
    console.log('✅ Test cleanup complete');
  } catch (e: any) {
    console.log('❌ Test failed:', e.message);
  }

  await ch.close();
}

testFixedInsert().catch(console.error);
