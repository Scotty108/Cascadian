#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Get a few real condition_ids from our trades and test them
async function testRealConditionIds() {
  console.log('Fetching sample condition_ids from our trades...\n');

  const result = await client.query({
    query: `
      SELECT DISTINCT condition_id_norm AS cid
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const ids = await result.json<Array<{cid: string}>>();

  for (const {cid} of ids) {
    const cleanId = cid.replace('0x', '');
    const url = `https://gamma-api.polymarket.com/markets?condition_id=${cleanId}`;

    console.log(`\nTesting: ${cid}`);
    console.log(`URL: ${url}`);

    try {
      const response = await fetch(url);
      console.log(`Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          const market = data[0];
          console.log('✅ Found market:');
          console.log(`  Question: ${market.question || 'N/A'}`);
          console.log(`  Condition ID (response): ${market.conditionId || 'N/A'}`);
          console.log(`  Closed: ${market.closed || false}`);
          console.log(`  Resolved: ${market.resolved || false}`);
          console.log(`  Outcome: ${market.outcome || 'N/A'}`);
          console.log(`  Category: ${market.category || 'N/A'}`);
          console.log(`  Payout numerators: ${market.payoutNumerators || market.payout_numerators || 'N/A'}`);
        } else {
          console.log('⚠️  Empty response or not an array');
        }
      } else {
        console.log(`❌ HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
    }

    // Rate limit: wait 500ms between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await client.close();
}

testRealConditionIds();
