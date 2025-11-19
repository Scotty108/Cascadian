#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

async function main() {
  console.log('Cleaning up temporary objects...\n');

  const objects = [
    '_repair_pairs_vwc',
    '_vwc_hex',
    '_vwc_token_src',
    '_token_cid_map',
    '_vwc_token_joined',
    '_vwc_token_decoded_fallback',
    '_res_cid',
    '_vwc_tx',
    '_vwc_cid',
    '_residual_cids',
    '_token_cid',
    '_tx_cid_from_erc1155',
    '_tx_cid_from_tokens',
    '_repair_pairs',
    '_still_missing_cids',
    '_candidate_contracts',
  ];

  for (const obj of objects) {
    try {
      await clickhouse.command({ query: `DROP TABLE IF EXISTS ${obj}` });
      await clickhouse.command({ query: `DROP VIEW IF EXISTS ${obj}` });
      console.log(`  ✅ Dropped ${obj}`);
    } catch (error: any) {
      console.log(`  ⚠️  ${obj}: ${error.message}`);
    }
  }

  console.log('\n✅ Cleanup complete');
  await clickhouse.close();
}

main();
