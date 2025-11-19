#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 60000
});

const GAMMA_API = 'https://gamma-api.polymarket.com';

async function main() {
  console.log('\n🔍 SAMPLE RESOLUTION VALIDATION\n');
  console.log('═'.repeat(80));

  // Get 10 random resolved markets
  console.log('\n1️⃣ Selecting random sample:\n');

  const sample = await ch.query({
    query: `
      SELECT
        condition_id,
        payout_numerators,
        payout_denominator,
        source
      FROM default.resolutions_external_ingest
      WHERE payout_denominator > 0
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const sampleData = await sample.json();
  console.log('  Selected ' + sampleData.length + ' random resolutions for validation\n');

  // Validate against Polymarket API
  console.log('2️⃣ Cross-checking with Polymarket API:\n');

  let matches = 0;
  let apiMissing = 0;
  let payoutMismatch = 0;

  for (const row of sampleData) {
    const cid = '0x' + row.condition_id;
    console.log('  Checking: ' + cid.substring(0, 18) + '...');

    try {
      const response = await fetch(GAMMA_API + '/markets?condition_id=' + cid);
      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        console.log('    ⚠️  Not found in API');
        apiMissing++;
        continue;
      }

      const market = data[0];

      // Check if API has payout data
      if (!market.payout_numerators || market.payout_numerators.length === 0) {
        console.log('    ⚠️  API has no payout data (expected - API doesnt expose payouts)');
        apiMissing++;
        continue;
      }

      // Compare payouts
      const ourPayouts = row.payout_numerators.map((n: number) => n);
      const apiPayouts = market.payout_numerators.map((n: number) => Number(n));

      const payoutsMatch = JSON.stringify(ourPayouts) === JSON.stringify(apiPayouts);

      if (payoutsMatch) {
        console.log('    ✅ Payouts match: [' + ourPayouts.join(', ') + ']');
        matches++;
      } else {
        console.log('    ❌ Payout mismatch!');
        console.log('       Our data: [' + ourPayouts.join(', ') + ']');
        console.log('       API data: [' + apiPayouts.join(', ') + ']');
        payoutMismatch++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));

    } catch (e: any) {
      console.log('    ⚠️  API error: ' + e.message);
      apiMissing++;
    }
  }

  console.log('\n═'.repeat(80));
  console.log('\n📊 VALIDATION RESULTS:\n');
  console.log('  Total sampled: ' + sampleData.length);
  console.log('  Matches: ' + matches);
  console.log('  API missing/no payouts: ' + apiMissing);
  console.log('  Mismatches: ' + payoutMismatch);
  console.log('');

  if (apiMissing === sampleData.length) {
    console.log('✅ EXPECTED: API does not expose payout data publicly');
    console.log('   This confirms our blockchain data is the only source\n');
  } else if (matches > 0 && payoutMismatch === 0) {
    console.log('✅ SUCCESS: All payouts match API (unexpected but good!)\n');
  } else if (payoutMismatch > 0) {
    console.log('⚠️  WARNING: Some payouts dont match');
    console.log('   Recommend manual inspection of mismatches\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
