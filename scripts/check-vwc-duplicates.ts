#!/usr/bin/env npx tsx
/**
 * Check if vw_trades_canonical has multiple condition_id formats
 * for the same tx_hash
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
console.log('CHECKING FOR DUPLICATE CONDITION IDS IN VWC');
console.log('═'.repeat(80));
console.log();

// Does vw_trades_canonical have same tx_hash with BOTH token_ and 0x formats?
console.log('Q: Does vw_trades_canonical have duplicate tx_hashes with different CID formats?');
console.log('─'.repeat(80));

try {
  const duplicateCheck = await client.query({
    query: `
      WITH per_tx AS (
        SELECT
          transaction_hash,
          groupArray(DISTINCT condition_id_norm) AS cids,
          length(cids) AS num_formats
        FROM default.vw_trades_canonical
        WHERE transaction_hash IN (
          SELECT transaction_hash
          FROM default.vw_trades_canonical
          WHERE condition_id_norm LIKE 'token_%'
          LIMIT 1000
        )
        GROUP BY transaction_hash
      )
      SELECT
        'Total tx_hashes sampled' AS metric,
        toString(count()) AS value
      FROM per_tx
      UNION ALL
      SELECT 'tx_hashes with >1 condition_id format',
        toString(countIf(num_formats > 1))
      FROM per_tx
      UNION ALL
      SELECT 'tx_hashes with exactly 1 format',
        toString(countIf(num_formats = 1))
      FROM per_tx
    `,
    format: 'JSONEachRow',
  });

  const dupData = await duplicateCheck.json<Array<{ metric: string; value: string }>>();

  console.log();
  dupData.forEach(row => {
    console.log(`  ${row.metric.padEnd(45)} ${row.value.padStart(10)}`);
  });

  console.log();

  // Sample transactions with multiple formats
  const sampleMulti = await client.query({
    query: `
      WITH per_tx AS (
        SELECT
          transaction_hash,
          groupArray(DISTINCT condition_id_norm) AS cids
        FROM default.vw_trades_canonical
        WHERE transaction_hash IN (
          SELECT transaction_hash
          FROM default.vw_trades_canonical
          WHERE condition_id_norm LIKE 'token_%'
          LIMIT 1000
        )
        GROUP BY transaction_hash
        HAVING length(cids) > 1
      )
      SELECT
        transaction_hash,
        cids
      FROM per_tx
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const multiData = await sampleMulti.json<Array<{
    transaction_hash: string;
    cids: string[];
  }>>();

  if (multiData.length > 0) {
    console.log('Sample transactions with multiple condition_id formats:');
    console.log();
    multiData.forEach((row, i) => {
      console.log(`  ${i + 1}. tx_hash: ${row.transaction_hash}`);
      row.cids.forEach((cid, j) => {
        const format = cid.startsWith('token_') ? 'token_' : (cid.startsWith('0x') ? '0x' : 'other');
        console.log(`     CID ${j + 1}: ${cid.substring(0, 60)}... (${format} format)`);
      });
      console.log();
    });
  }

} catch (error) {
  console.error('❌ Failed:', error);
}

console.log('═'.repeat(80));
console.log();

// Check if fact_trades_clean was built from the 0x rows only
console.log('Q: Was fact_trades_clean built from only 0x format rows?');
console.log('─'.repeat(80));

try {
  const factSource = await client.query({
    query: `
      WITH vwc_hex AS (
        SELECT DISTINCT transaction_hash AS tx
        FROM default.vw_trades_canonical
        WHERE condition_id_norm LIKE '0x%'
          AND condition_id_norm != concat('0x', repeat('0',64))
      ),
      fact_txs AS (
        SELECT DISTINCT tx_hash AS tx
        FROM cascadian_clean.fact_trades_clean
      )
      SELECT
        (SELECT count() FROM vwc_hex) AS vwc_hex_txs,
        (SELECT count() FROM fact_txs) AS fact_txs,
        (SELECT count() FROM fact_txs WHERE tx IN (SELECT tx FROM vwc_hex)) AS overlap,
        round(100.0 * overlap / fact_txs, 2) AS pct_from_hex
    `,
    format: 'JSONEachRow',
  });

  const sourceData = await factSource.json<Array<{
    vwc_hex_txs: number;
    fact_txs: number;
    overlap: number;
    pct_from_hex: number;
  }>>();

  console.log();
  console.log(`  vw_trades_canonical (0x format):  ${sourceData[0].vwc_hex_txs.toLocaleString()} tx_hashes`);
  console.log(`  fact_trades_clean:                ${sourceData[0].fact_txs.toLocaleString()} tx_hashes`);
  console.log(`  Overlap:                          ${sourceData[0].overlap.toLocaleString()} (${sourceData[0].pct_from_hex}%)`);
  console.log();

  if (sourceData[0].pct_from_hex > 90) {
    console.log('  🎯 CONFIRMED: fact_trades_clean was built from 0x format rows only!');
    console.log();
  }

} catch (error) {
  console.error('❌ Failed:', error);
}

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
