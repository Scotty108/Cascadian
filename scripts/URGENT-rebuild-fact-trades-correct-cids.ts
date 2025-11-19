#!/usr/bin/env npx tsx
/**
 * URGENT: REBUILD fact_trades_clean with CORRECT CID NORMALIZATION
 *
 * BUG FOUND: Current fact_trades_clean has CIDs like:
 *   0x00000000000000000fee... (17 leading zeros - WRONG!)
 *
 * Should be:
 *   0x0000a3aa2ac9a909... (normal leading zeros - CORRECT!)
 *
 * This is why PnL join shows 0% match despite having all resolution data!
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
console.log('REBUILD fact_trades_clean WITH CORRECT CID NORMALIZATION');
console.log('═'.repeat(80));
console.log();

console.log('Step 1: Backup current fact_trades_clean...');
await client.query({ query: 'DROP TABLE IF EXISTS cascadian_clean.fact_trades_BROKEN_CIDS' });
await client.query({
  query: 'RENAME TABLE cascadian_clean.fact_trades_clean TO cascadian_clean.fact_trades_BROKEN_CIDS'
});
console.log('✅ Backed up to fact_trades_BROKEN_CIDS');
console.log();

console.log('Step 2: Rebuild with CORRECT normalization...');
console.log('─'.repeat(80));

await client.query({
  query: `
    CREATE TABLE cascadian_clean.fact_trades_clean
    ENGINE = ReplacingMergeTree()
    ORDER BY (tx_hash, cid_hex, wallet_address)
    AS
    SELECT
      tx_hash,
      -- CORRECT normalization: lower('0x' || condition_id without padding to 66)
      lower(concat('0x', replaceAll(condition_id_norm, '0x', ''))) AS cid_hex,
      wallet_address,
      outcome_index,
      direction,
      shares,
      price,
      usdc_amount,
      block_time
    FROM cascadian_clean.fact_trades_BROKEN_CIDS
  `
});

console.log('✅ Rebuilt fact_trades_clean with correct CIDs');
console.log();

console.log('Step 3: Verify CID format...');
console.log('─'.repeat(80));

const sample = await client.query({
  query: 'SELECT cid_hex FROM cascadian_clean.fact_trades_clean LIMIT 5',
  format: 'JSONEachRow',
});

const cids = await sample.json<Array<{ cid_hex: string }>>();

console.log();
console.log('Sample CIDs (should have normal leading zeros):');
cids.forEach((r, i) => console.log(`  ${i + 1}. ${r.cid_hex}`));
console.log();

console.log('Step 4: Test join coverage...');
console.log('─'.repeat(80));

const coverage = await client.query({
  query: `
    WITH
    res_norm AS (
      SELECT DISTINCT
        lower(concat('0x', replaceAll(condition_id_norm, '0x', ''))) AS cid_hex
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL AND payout_denominator > 0
    )
    SELECT
      (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS fact_cids,
      (SELECT count() FROM res_norm) AS res_cids,
      (SELECT count(DISTINCT f.cid_hex)
       FROM cascadian_clean.fact_trades_clean f
       INNER JOIN res_norm r ON r.cid_hex = f.cid_hex) AS matched,
      round(100.0 * matched / fact_cids, 2) AS coverage_pct
  `,
  format: 'JSONEachRow',
});

const c = (await coverage.json<Array<{
  fact_cids: number;
  res_cids: number;
  matched: number;
  coverage_pct: number;
}>>())[0];

console.log();
console.log('Join Coverage:');
console.log(`  Fact CIDs:    ${c.fact_cids.toLocaleString()}`);
console.log(`  Res CIDs:     ${c.res_cids.toLocaleString()}`);
console.log(`  Matched:      ${c.matched.toLocaleString()}`);
console.log(`  Coverage:     ${c.coverage_pct}%`);
console.log();

if (c.coverage_pct > 90) {
  console.log('✅✅✅ SUCCESS! Coverage jumped to >90%! Join is FIXED!');
} else if (c.coverage_pct > 50) {
  console.log('✅ IMPROVED! Coverage is now >50%');
} else {
  console.log('❌ Still poor coverage - need more investigation');
}

console.log();
console.log('═'.repeat(80));
console.log('NEXT STEPS');
console.log('═'.repeat(80));
console.log();
console.log('1. Rebuild PnL views (build-pnl-views-with-wallet-remap.ts)');
console.log('2. Verify wallet PnL against Polymarket UI');
console.log('3. Delete fact_trades_BROKEN_CIDS backup after verification');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
