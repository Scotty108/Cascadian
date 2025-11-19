import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function checkOutcome1() {
  console.log('\n🔍 Checking what outcome_index = 1 maps to\n');
  
  const query = `
    SELECT
      ctm.outcome_index,
      gm.outcome,
      count(*) as token_count
    FROM ctf_token_map ctm
    INNER JOIN gamma_markets gm ON ctm.token_id = gm.token_id
    WHERE ctm.outcome_index = 1
    GROUP BY ctm.outcome_index, gm.outcome
    ORDER BY token_count DESC
    LIMIT 30
  `;
  
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  
  console.log('Top outcomes for outcome_index = 1:');
  console.table(data);
  
  const hasNo = data.some((r: any) => ['No', 'no'].includes(r.outcome));
  const hasYes = data.some((r: any) => ['Yes', 'yes'].includes(r.outcome));
  
  console.log('\n📊 Analysis:');
  if (hasNo && !hasYes) {
    console.log('✅ outcome_index = 1 maps to NO (second outcome)');
    console.log('✅ outcome_index = 0 maps to YES (first outcome)');
    console.log('\n❌ VALIDATION SCRIPT HAS INVERTED LOGIC!');
    console.log('\nThe validation script checks:');
    console.log('  - outcome_idx = 1 AND winning_outcome = \'yes\' → WIN');
    console.log('  - outcome_idx = 0 AND winning_outcome = \'no\' → WIN');
    console.log('\nBut it should check:');
    console.log('  - outcome_idx = 0 AND winning_outcome = \'yes\' → WIN');
    console.log('  - outcome_idx = 1 AND winning_outcome = \'no\' → WIN');
  }
}

checkOutcome1().catch(console.error);
