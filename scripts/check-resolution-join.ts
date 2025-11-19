import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkResolutionJoin() {
  console.log('\n🔍 Checking why gamma_resolved join fails\n');
  
  // Get distinct condition_ids from wallet's fills
  console.log('1️⃣ Condition IDs from wallet fills (normalized):\n');
  const fillsQuery = `
    SELECT DISTINCT
      lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
    FROM clob_fills
    WHERE lower(proxy_wallet) = lower('${WALLET}')
      AND condition_id != ''
    LIMIT 10
  `;
  
  const fillsResult = await clickhouse.query({ query: fillsQuery, format: 'JSONEachRow' });
  const fills = await fillsResult.json();
  console.log('Sample condition_ids from fills:');
  fills.forEach((r: any) => console.log(`  ${r.condition_id_norm}`));
  
  // Check gamma_resolved cid format
  console.log('\n2️⃣ Condition IDs from gamma_resolved (cid column):\n');
  const resolvedQuery = `
    SELECT DISTINCT cid
    FROM gamma_resolved
    LIMIT 10
  `;
  
  const resolvedResult = await clickhouse.query({ query: resolvedQuery, format: 'JSONEachRow' });
  const resolved = await resolvedResult.json();
  console.log('Sample cids from gamma_resolved:');
  resolved.forEach((r: any) => console.log(`  ${r.cid}`));
  
  // Test the join
  console.log('\n3️⃣ Testing join (wallet fills → gamma_resolved):\n');
  const joinQuery = `
    SELECT
      lower(replaceAll(cf.condition_id, '0x', '')) as fill_cid_norm,
      gr.cid as resolved_cid,
      gr.winning_outcome
    FROM clob_fills cf
    LEFT JOIN gamma_resolved gr
      ON lower(replaceAll(cf.condition_id, '0x', '')) = gr.cid
    WHERE lower(cf.proxy_wallet) = lower('${WALLET}')
      AND cf.condition_id != ''
    LIMIT 5
  `;
  
  const joinResult = await clickhouse.query({ query: joinQuery, format: 'JSONEachRow' });
  const joinData = await joinResult.json();
  console.table(joinData);
  
  // Check match rate
  console.log('\n4️⃣ Match statistics:\n');
  const statsQuery = `
    SELECT
      countDistinct(lower(replaceAll(cf.condition_id, '0x', ''))) as unique_fill_conditions,
      countDistinctIf(gr.cid, gr.cid IS NOT NULL) as matched_conditions,
      round(matched_conditions / unique_fill_conditions * 100, 2) as match_pct
    FROM clob_fills cf
    LEFT JOIN gamma_resolved gr
      ON lower(replaceAll(cf.condition_id, '0x', '')) = gr.cid
    WHERE lower(cf.proxy_wallet) = lower('${WALLET}')
      AND cf.condition_id != ''
  `;
  
  const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
  const stats = await statsResult.json();
  console.table(stats);
  
  const matchPct = parseFloat(stats[0].match_pct);
  
  if (matchPct < 50) {
    console.log(`\n❌ Only ${matchPct}% of wallet conditions have resolutions`);
    console.log('This explains why P&L calculation shows all losses.');
    console.log('\nPossible fixes:');
    console.log('1. Use different resolution table (market_resolutions_final?)');
    console.log('2. Backfill missing resolutions');
    console.log('3. Check condition_id normalization');
  } else {
    console.log(`\n✅ ${matchPct}% match rate`);
  }
}

checkResolutionJoin().catch(console.error);
