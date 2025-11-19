#!/usr/bin/env npx tsx
/**
 * RECREATE VW_TREF_NORM VIEW
 *
 * Fix the view to properly handle token_ format without trying to parse hex as UInt256
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
console.log('Recreating vw_tref_norm view with proper token_ guards...');
console.log();

try {
  await client.query({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_tref_norm AS
      WITH base AS (
        SELECT
          transaction_hash AS tx_hash,
          timestamp        AS block_time,
          condition_id     AS cond_raw,
          outcome,
          wallet_address,
          side,
          shares,
          entry_price AS price,
          usd_value   AS usdc_amount
        FROM default.trades_raw_enriched_final
        WHERE condition_id IS NOT NULL
          AND condition_id != ''
          AND condition_id != '0x'
          AND condition_id != concat('0x', repeat('0',64))
      )
      SELECT
        tx_hash,
        block_time,
        lower('0x' || leftPad(replaceOne(lower(cond_raw),'0x',''),64,'0')) AS cid_hex,
        toInt16(coalesce(outcome, 0)) AS outcome_index,
        wallet_address,
        multiIf(side = 'YES', 'BUY', side = 'NO', 'SELL', 'UNKNOWN') AS direction,
        shares,
        price,
        usdc_amount
      FROM base
      WHERE lower(cond_raw) LIKE '0x%'

      UNION ALL

      SELECT
        tx_hash,
        block_time,
        concat('0x', leftPad(
          lower(hex(intDiv(toUInt256(replaceAll(cond_raw,'token_','')), 256)))
        , 64, '0')) AS cid_hex,
        toInt16(modulo(toUInt256(replaceAll(cond_raw,'token_','')), 256)) AS outcome_index,
        wallet_address,
        multiIf(side = 'YES', 'BUY', side = 'NO', 'SELL', 'UNKNOWN') AS direction,
        shares,
        price,
        usdc_amount
      FROM base
      WHERE lower(cond_raw) LIKE 'token_%'
        AND match(replaceAll(cond_raw,'token_',''), '^[0-9]+$')
        AND length(replaceAll(cond_raw,'token_','')) <= 76
    `,
  });

  console.log('✅ View recreated successfully');
  console.log();

  // Test the view
  const testQuery = await client.query({
    query: 'SELECT count() AS cnt, uniqExact(cid_hex) AS unique_cids FROM cascadian_clean.vw_tref_norm',
    format: 'JSONEachRow',
  });

  const testData = await testQuery.json<Array<{ cnt: number; unique_cids: number }>>();

  console.log(`View test:`);
  console.log(`  Rows:        ${testData[0].cnt.toLocaleString()}`);
  console.log(`  Unique CIDs: ${testData[0].unique_cids.toLocaleString()}`);
  console.log();

} catch (error: any) {
  console.error(`❌ Failed: ${error?.message || error}`);
  process.exit(1);
}

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
