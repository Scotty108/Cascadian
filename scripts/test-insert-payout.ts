#!/usr/bin/env tsx
/**
 * Test minimal insertion to reproduce the array parsing error
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

async function testInsert() {
  console.log('🧪 Testing array insertions...\n');

  // Test 1: Simple integer payouts (like Goldsky returns)
  console.log('Test 1: Integer payouts...');
  try {
    await ch.insert({
      table: 'default.resolutions_external_ingest',
      values: [
        {
          condition_id: 'test001',
          payout_numerators: [1, 0],
          payout_denominator: 1,
          winning_index: 0,
          resolved_at: new Date().toISOString(),
          source: 'test',
        },
      ],
      format: 'JSONEachRow',
    });
    console.log('✅ Integer payouts work!\n');
  } catch (e: any) {
    console.log('❌ Integer payouts failed:', e.message, '\n');
  }

  // Test 2: Decimal payouts (like 0.54, 0.46)
  console.log('Test 2: Decimal payouts...');
  try {
    await ch.insert({
      table: 'default.resolutions_external_ingest',
      values: [
        {
          condition_id: 'test002',
          payout_numerators: [0.54, 0.46],
          payout_denominator: 1,
          winning_index: 0,
          resolved_at: new Date().toISOString(),
          source: 'test',
        },
      ],
      format: 'JSONEachRow',
    });
    console.log('✅ Decimal payouts work!\n');
  } catch (e: any) {
    console.log('❌ Decimal payouts failed:', e.message, '\n');
  }

  // Test 3: Fetch conditions with decimal payouts from Goldsky
  console.log('Test 3: Fetching Goldsky conditions with potential decimal payouts...');
  const GOLDSKY_ENDPOINT =
    'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn';

  const query = `{
    conditions(
      first: 100
      where: {payouts_not: null}
      orderBy: id
      orderDirection: asc
    ) {
      id
      payouts
    }
  }`;

  const response = await fetch(GOLDSKY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const result = await response.json();
  const conditions = result.data.conditions;

  // Find conditions with decimal payouts
  const withDecimals = conditions.filter((c: any) =>
    c.payouts.some((p: string) => p.includes('.'))
  );

  console.log(`   Found ${withDecimals.length} conditions with decimal payouts out of ${conditions.length}`);

  if (withDecimals.length > 0) {
    console.log('\n   Sample decimal payouts:');
    withDecimals.slice(0, 3).forEach((c: any) => {
      console.log(`   - ${c.id}: ${JSON.stringify(c.payouts)}`);
    });

    // Try inserting one with decimals
    console.log('\nTest 4: Insert actual Goldsky condition with decimals...');
    const testCondition = withDecimals[0];
    const payouts = testCondition.payouts.map((p: string) => parseFloat(p));

    try {
      await ch.insert({
        table: 'default.resolutions_external_ingest',
        values: [
          {
            condition_id: testCondition.id.toLowerCase().replace(/^0x/, ''),
            payout_numerators: payouts,
            payout_denominator: payouts.reduce((sum: number, p: number) => sum + p, 0),
            winning_index: payouts.indexOf(Math.max(...payouts)),
            resolved_at: new Date().toISOString(),
            source: 'test-goldsky',
          },
        ],
        format: 'JSONEachRow',
      });
      console.log('✅ Goldsky decimal condition inserted!\n');
    } catch (e: any) {
      console.log('❌ Goldsky decimal condition failed:', e.message, '\n');
    }
  }

  // Cleanup test rows
  console.log('🧹 Cleaning up test rows...');
  await ch.command({
    query: "DELETE FROM default.resolutions_external_ingest WHERE source LIKE 'test%'",
  });

  await ch.close();
}

testInsert().catch(console.error);
