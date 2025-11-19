#!/usr/bin/env npx tsx

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('Debugging outcome_idx JOIN issue...\n');

  // Check if JOIN is working
  const test = await clickhouse.query({
    query: `
      SELECT
        cf.asset_id,
        ctm.token_id,
        ctm.outcome_index,
        ctm.condition_id_norm as ctm_cid,
        lower(replaceAll(cf.condition_id, '0x', '')) as cf_cid_norm
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${BASELINE_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const rows = await test.json();
  console.log('Sample JOINs between clob_fills and ctf_token_map:');
  rows.forEach((r: any, i: number) => {
    const outcomeStr = (r.outcome_index !== null && r.outcome_index !== undefined) ? r.outcome_index.toString() : 'NULL ❌';
    console.log(`\nRow ${i + 1}:`);
    console.log(`  asset_id (from fills):    ${r.asset_id}`);
    console.log(`  token_id (from map):      ${r.token_id || 'NULL ❌'}`);
    console.log(`  outcome_index:            ${outcomeStr}`);
    console.log(`  ctm_cid:                  ${r.ctm_cid || 'NULL'}`);
    console.log(`  cf_cid_norm:              ${r.cf_cid_norm}`);
  });

  // Count JOIN successes vs failures
  console.log('\n' + '─'.repeat(80));
  const stats = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_fills,
        COUNTIf(ctm.token_id IS NOT NULL) as joined_count
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${BASELINE_WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const statsRow = (await stats.json())[0];
  const joinPct = (parseInt(statsRow.joined_count) / parseInt(statsRow.total_fills) * 100).toFixed(1);

  console.log('\nJOIN Statistics:');
  console.log(`  Total fills for wallet:   ${parseInt(statsRow.total_fills).toLocaleString()}`);
  console.log(`  Successfully joined:      ${parseInt(statsRow.joined_count).toLocaleString()} (${joinPct}%)`);
  console.log();

  if (parseFloat(joinPct) < 95.0) {
    console.log('❌ PROBLEM: JOIN success rate is below 95%!');
    console.log('   This explains why outcome_idx is undefined in the validation.');
  } else {
    console.log('✅ JOIN looks good - investigating further...');
  }
}

main().catch(console.error);
