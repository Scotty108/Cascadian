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

/**
 * PHASE 3: Drop Temporary Views
 * Target: Views with _ or tmp_ prefix (clearly temporary/debug helpers)
 * Risk: VERY LOW - these are explicitly temporary
 */

const TEMP_VIEWS = [
  // Underscore-prefixed views (temp helpers)
  'default._candidate_contracts',
  'default._candidate_ctf_addresses',
  'default._cid_res',
  'default._fact_cid',
  'default._market_map',
  'default._mkey_to_cid',
  'default._mkey_to_cid_candidates',
  'default._mkey_vwc',
  'default._raw_missing_tx',
  'default._repair_pairs_vwc',
  'default._res_cid',
  'default._res_norm',
  'default._still_missing_cids',
  'default._token_cid_map',
  'default._token_to_cid',
  'default._tx_cid_union',
  'default._tx_cid_via_erc1155',
  'default._tx_cid_via_market',
  'default._tx_cid_via_token',
  'default._tx_vwc',
  'default._vwc_hex',
  'default._vwc_market',
  'default._vwc_norm',
  'default._vwc_token_decoded_fallback',
  'default._vwc_token_joined',
  'default._vwc_token_src',

  // tmp_ prefixed views (explicitly temporary)
  'default.tmp_raw_bad',
  'default.tmp_res_norm',
  'default.tmp_trenf_norm',
  'default.tmp_vwc_norm',
];

async function cleanupTempViews() {
  console.log('PHASE 3: Cleanup Temporary Views\\n');
  console.log('═'.repeat(80));
  console.log(`Target: ${TEMP_VIEWS.length} temporary/debug views`);
  console.log('Status: SAFE to run (clearly temporary helpers)\\n');
  console.log('Note: These views are:');
  console.log('  - Prefixed with _ or tmp_');
  console.log('  - Used for debugging/data processing');
  console.log('  - Not referenced in production code\\n');

  let dropped = 0;
  let skipped = 0;
  let errors = 0;

  for (const view of TEMP_VIEWS) {
    try {
      await client.exec({
        query: `DROP VIEW IF EXISTS ${view}`,
      });
      console.log(`✓ Dropped ${view}`);
      dropped++;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unknown table')) {
        console.log(`ℹ️  ${view} already doesn't exist`);
        skipped++;
      } else {
        console.error(`✗ Error dropping ${view}:`, err);
        errors++;
      }
    }
  }

  console.log('\\n' + '═'.repeat(80));
  console.log('PHASE 3 COMPLETE!\\n');
  console.log(`Dropped: ${dropped} views`);
  console.log(`Skipped (doesn't exist): ${skipped} views`);
  console.log(`Errors: ${errors}`);
  console.log('\\nImpact: Cleaner namespace, easier to navigate views\\n');

  await client.close();
}

cleanupTempViews().catch(console.error);
