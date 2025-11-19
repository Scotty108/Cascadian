#!/usr/bin/env npx tsx
/**
 * REBUILD fact_trades_clean FROM CORRECT SOURCE (vw_trades_canonical)
 *
 * Root cause: fact_trades_clean was built with incorrectly padded CIDs
 * Solution: Rebuild from vw_trades_canonical which has correct format
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
console.log('REBUILD fact_trades_clean FROM CORRECT SOURCE');
console.log('═'.repeat(80));
console.log();

console.log('Step 1: Check if fact_trades_clean exists...');
const tableCheck = await client.query({
  query: `
    SELECT count() AS c
    FROM system.tables
    WHERE database = 'cascadian_clean' AND name = 'fact_trades_clean'
  `,
  format: 'JSONEachRow',
});
const tableExists = (await tableCheck.json<Array<{ c: number }>>())[0].c > 0;

if (tableExists) {
  await client.query({
    query: 'RENAME TABLE cascadian_clean.fact_trades_clean TO cascadian_clean.fact_trades_BROKEN_CIDS'
  });
  console.log('✅ Backed up to fact_trades_BROKEN_CIDS');
} else {
  console.log('✅ Table already backed up (fact_trades_BROKEN_CIDS exists)');
}
console.log();

console.log('Step 2: Rebuild from vw_trades_canonical...');
console.log('─'.repeat(80));
console.log('This may take 1-2 minutes for large datasets...');
console.log();

const startTime = Date.now();

await client.query({
  query: `
    CREATE TABLE cascadian_clean.fact_trades_clean
    ENGINE = ReplacingMergeTree()
    ORDER BY (tx_hash, cid_hex, wallet_address)
    AS
    SELECT
      transaction_hash AS tx_hash,
      toDateTime(timestamp) AS block_time,
      lower(condition_id_norm) AS cid_hex,
      outcome_index,
      wallet_address_norm AS wallet_address,
      trade_direction AS direction,
      shares,
      entry_price AS price,
      usd_value AS usdc_amount,
      'VW_CANONICAL' AS source
    FROM default.vw_trades_canonical
    WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
  `,
  request_timeout: 300000  // 5 minutes
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`✅ Rebuilt fact_trades_clean from canonical source (${elapsed}s)`);
console.log();

console.log('Step 3: Verify CID format...');
console.log('─'.repeat(80));

const sample = await client.query({
  query: 'SELECT cid_hex, length(cid_hex) AS len FROM cascadian_clean.fact_trades_clean LIMIT 5',
  format: 'JSONEachRow',
});

const cids = await sample.json<Array<{ cid_hex: string; len: number }>>();

console.log();
console.log('Sample CIDs (should have 0x + 64 hex chars = 66 total):');
cids.forEach((r, i) => console.log(`  ${i + 1}. ${r.cid_hex} (len: ${r.len})`));
console.log();

console.log('Step 4: Test join coverage...');
console.log('─'.repeat(80));

const coverage = await client.query({
  query: `
    WITH
    res_norm AS (
      SELECT DISTINCT
        lower(concat('0x', condition_id_norm)) AS cid_hex
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
