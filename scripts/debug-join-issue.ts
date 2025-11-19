import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function debugJoin() {
  console.log('\n🔍 Debugging ctf_token_map join issue\n');
  
  // Check clob_fills asset_id format
  console.log('1️⃣ Sample asset_ids from clob_fills for this wallet:\n');
  const fillsQuery = `
    SELECT
      asset_id,
      lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
      side,
      size
    FROM clob_fills
    WHERE lower(proxy_wallet) = lower('${WALLET}')
    LIMIT 5
  `;
  
  const fillsResult = await clickhouse.query({ query: fillsQuery, format: 'JSONEachRow' });
  const fills = await fillsResult.json();
  console.table(fills);
  
  // Check ctf_token_map token_id format
  console.log('\n2️⃣ Sample token_ids from ctf_token_map:\n');
  const ctmQuery = `
    SELECT
      token_id,
      condition_id_norm,
      outcome_index,
      source
    FROM ctf_token_map
    LIMIT 5
  `;
  
  const ctmResult = await clickhouse.query({ query: ctmQuery, format: 'JSONEachRow' });
  const ctm = await ctmResult.json();
  console.table(ctm);
  
  // Test the join
  console.log('\n3️⃣ Testing join (sample wallet fills with ctf_token_map):\n');
  const joinQuery = `
    SELECT
      cf.asset_id,
      cf.proxy_wallet,
      lower(replaceAll(cf.condition_id, '0x', '')) as fill_cid_norm,
      ctm.token_id,
      ctm.condition_id_norm as ctm_cid_norm,
      ctm.outcome_index,
      ctm.source
    FROM clob_fills cf
    INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
    WHERE lower(cf.proxy_wallet) = lower('${WALLET}')
    LIMIT 5
  `;
  
  const joinResult = await clickhouse.query({ query: joinQuery, format: 'JSONEachRow' });
  const joinData = await joinResult.json();
  
  if (joinData.length > 0) {
    console.log('✅ Join successful - sample results:');
    console.table(joinData);
  } else {
    console.log('❌ Join returned NO results');
    console.log('\nThis means asset_ids don\'t match. Checking formats...');
    
    // Check if asset_ids exist in both tables
    const checkQuery = `
      SELECT
        countDistinct(cf.asset_id) as fills_unique_assets,
        countDistinct(ctm.token_id) as ctm_unique_tokens,
        countDistinctIf(cf.asset_id, cf.asset_id IN (SELECT token_id FROM ctf_token_map)) as matching_assets
      FROM clob_fills cf, ctf_token_map ctm
      WHERE lower(cf.proxy_wallet) = lower('${WALLET}')
    `;
    
    const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
    const check = await checkResult.json();
    console.table(check);
  }
}

debugJoin().catch(console.error);
