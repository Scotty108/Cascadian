import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function compareConditionIds() {
  console.log('\n🔍 Comparing condition_id: gamma_markets vs clob_fills\n');
  
  // Compare condition_ids for same token
  const query = `
    SELECT
      gm.token_id,
      gm.outcome,
      lower(replaceAll(gm.condition_id, '0x', '')) as gamma_cid_norm,
      lower(replaceAll(cf.condition_id, '0x', '')) as fill_cid_norm,
      gamma_cid_norm = fill_cid_norm as match
    FROM gamma_markets gm
    INNER JOIN clob_fills cf ON gm.token_id = cf.asset_id
    WHERE gm.token_id != '' AND cf.condition_id != ''
    LIMIT 10
  `;
  
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  
  console.log('Sample comparison:');
  console.table(data);
  
  // Get match statistics
  const statsQuery = `
    SELECT
      count() as total_comparisons,
      countIf(lower(replaceAll(gm.condition_id, '0x', '')) = lower(replaceAll(cf.condition_id, '0x', ''))) as matches,
      round(matches / total_comparisons * 100, 2) as match_pct
    FROM gamma_markets gm
    INNER JOIN clob_fills cf ON gm.token_id = cf.asset_id
    WHERE gm.token_id != '' AND cf.condition_id != ''
    LIMIT 10000
  `;
  
  const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
  const stats = await statsResult.json();
  
  console.log('\n\n📊 Match statistics:');
  console.table(stats);
  
  const matchPct = parseFloat(stats[0].match_pct);
  
  if (matchPct > 90) {
    console.log(`\n✅ condition_id values MATCH ${matchPct}%`);
    console.log('gamma_markets.condition_id is CORRECT - can use it directly!');
  } else {
    console.log(`\n❌ condition_id values MISMATCH`);
    console.log(`Only ${matchPct}% match - gamma_markets has wrong condition_id`);
    console.log('Must use clob_fills.condition_id instead');
  }
}

compareConditionIds().catch(console.error);
