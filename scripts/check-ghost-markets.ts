#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Checking ghost market coverage in pm_markets:\n');

  const ghostConditions = [
    'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
    '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7',
    'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
    'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608'
  ];

  console.log(`Checking ${ghostConditions.length} ghost markets...\n`);

  for (const cid of ghostConditions) {
    const query = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          question,
          market_type,
          status,
          resolved_at,
          winning_outcome_index
        FROM pm_markets
        WHERE condition_id = '${cid}'
      `,
      format: 'JSONEachRow'
    });
    const result = await query.json();

    const shortId = cid.substring(0, 16);
    if (result.length > 0) {
      console.log(`✅ ${shortId}...`);
      console.log(`   Question: ${result[0].question.substring(0, 50)}...`);
      console.log(`   Status: ${result[0].status}, Resolved: ${result[0].resolved_at || 'NULL'}`);
    } else {
      console.log(`❌ ${shortId}... - NOT IN pm_markets`);
    }
    console.log('');
  }

  console.log('💡 Action needed: Ghost markets must be added to pm_markets with resolution data');
  console.log('   for them to appear in pm_wallet_market_pnl_resolved view');
}

main().catch(console.error);
