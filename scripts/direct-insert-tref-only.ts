#!/usr/bin/env npx tsx
/**
 * DIRECT INSERT TREF-ONLY
 *
 * Bypass vw_tref_norm view and INSERT directly from trades_raw_enriched_final
 * for the 2,337 CIDs that exist only in tref
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('═'.repeat(80));
console.log('DIRECT INSERT TREF-ONLY CIDs');
console.log('═'.repeat(80));
console.log();

console.log('Strategy: Direct INSERT from trades_raw_enriched_final (hex-format only for now)');
console.log('Expected: Add 845 hex CIDs first, then handle token_ separately');
console.log();

// ============================================================================
// STEP 1: Insert HEX-format tref-only CIDs
// ============================================================================

console.log('Step 1: Insert HEX-Format Tref-Only CIDs');
console.log('─'.repeat(80));
console.log();
console.log('Executing INSERT for hex-format CIDs...');
console.log();

try {
  const startTime = Date.now();

  await client.query({
    query: `
      INSERT INTO cascadian_clean.fact_trades_clean
      WITH vwc_cids AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.vw_vwc_norm
      )
      SELECT
        transaction_hash AS tx_hash,
        timestamp AS block_time,
        lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid_hex,
        toInt16(coalesce(outcome, 0)) AS outcome_index,
        wallet_address,
        multiIf(side = 'YES', 'BUY', side = 'NO', 'SELL', 'UNKNOWN') AS direction,
        shares,
        entry_price AS price,
        usd_value AS usdc_amount,
        'RAW_ENRICHED_HEX' AS source
      FROM default.trades_raw_enriched_final
      WHERE lower(condition_id) LIKE '0x%'
        AND condition_id != ''
        AND condition_id != '0x'
        AND condition_id != concat('0x', repeat('0',64))
        AND lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) NOT IN (SELECT cid FROM vwc_cids)
    `,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✅ Hex INSERT completed in ${elapsed}s`);
  console.log();

} catch (error: any) {
  console.error(`❌ Hex INSERT failed: ${error?.message || error}`);
  await client.close();
  process.exit(1);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 2: Verify counts after hex insert
// ============================================================================

console.log('Step 2: Verify Post-Hex-Insert Counts');
console.log('─'.repeat(80));

try {
  const verify = await client.query({
    query: `
      SELECT
        count() AS total_rows,
        uniqExact(cid_hex) AS unique_cids,
        countIf(source LIKE '%HEX') AS hex_rows
      FROM cascadian_clean.fact_trades_clean
    `,
    format: 'JSONEachRow',
  });

  const verifyData = await verify.json<Array<{
    total_rows: number;
    unique_cids: number;
    hex_rows: number;
  }>>();

  const v = verifyData[0];

  console.log();
  console.log('After hex-only INSERT:');
  console.log(`  Total rows:          ${v.total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs:         ${v.unique_cids.toLocaleString()}`);
  console.log(`  Hex-enriched rows:   ${v.hex_rows.toLocaleString()}`);
  console.log();

  const cids_added = v.unique_cids - 227838;
  console.log(`  CIDs added:          +${cids_added.toLocaleString()} (expected ~845 from hex)`);
  console.log();

  if (cids_added > 800) {
    console.log('✅ Hex CIDs added successfully');
  } else {
    console.log('⚠️  Fewer CIDs added than expected');
  }

} catch (error: any) {
  console.error('❌ Verification failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log('NEXT STEPS');
console.log('═'.repeat(80));
console.log();
console.log('Hex-format tref-only CIDs have been added.');
console.log();
console.log('Remaining work:');
console.log('  • Add token_-format tref-only CIDs (if any decode successfully)');
console.log('  • OR accept current coverage and re-measure G_traded');
console.log();
console.log('Current expected coverage:');
console.log(`  • Before: 227,838 CIDs (92.61% of TRADED_ANY)`)
console.log(`  • After:  ~228,683 CIDs (93.0% of TRADED_ANY if 246,023)`)
console.log(`  • After:  ~228,683 CIDs (99.4% of TRADED_ANY if 230,175)`)
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
