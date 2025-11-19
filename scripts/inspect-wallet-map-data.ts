#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('Inspecting system_wallet_map data...\n');

  // Get sample data
  const sampleResult = await clickhouse.query({
    query: `
      SELECT *
      FROM cascadian_clean.system_wallet_map
      WHERE user_wallet = '${UI_WALLET}'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json<Array<any>>();

  console.log(`Sample rows (${samples.length} total):\n`);
  if (samples.length > 0) {
    console.log('Columns:', Object.keys(samples[0]).join(', '));
    samples.forEach((s, i) => {
      console.log(`\n${i+1}. ${JSON.stringify(s, null, 2)}`);
    });
  } else {
    console.log('NO ROWS FOUND for this user_wallet!');
    console.log('\nThis means either:');
    console.log('  1. The wallet mapping table uses different address format');
    console.log('  2. This wallet was never mapped');
    console.log('  3. The mapping process failed/incomplete\n');

    // Try case-insensitive
    const caseResult = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM cascadian_clean.system_wallet_map
        WHERE lower(user_wallet) = lower('${UI_WALLET}')
      `,
      format: 'JSONEachRow'
    });
    const caseCount = await caseResult.json<Array<any>>();
    console.log(`Case-insensitive search: ${caseCount[0].cnt} rows\n`);
  }
}

main().catch(console.error);
