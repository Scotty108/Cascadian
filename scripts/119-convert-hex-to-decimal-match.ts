#!/usr/bin/env tsx
/**
 * Convert hex token_ids to decimal and check for matches with CLOB asset_ids
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

async function main() {
  console.log('Hex-to-Decimal Conversion and Matching');
  console.log('='.repeat(80));
  console.log('');

  // ClickHouse has reinterpretAsUInt256 for hex to decimal conversion
  const matchQuery = `
    WITH blockchain AS (
      SELECT
        token_id as hex_id,
        reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))) as decimal_id
      FROM erc1155_transfers
      WHERE lower(from_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
         OR lower(to_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
      GROUP BY token_id
    ),
    clob AS (
      SELECT
        asset_id,
        toUInt256(asset_id) as decimal_id
      FROM clob_fills
      WHERE lower(proxy_wallet) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
         OR lower(user_eoa) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
      GROUP BY asset_id
    )
    SELECT COUNT(*) as matches
    FROM blockchain b
    INNER JOIN clob c ON b.decimal_id = c.decimal_id
  `;

  console.log('Converting hex token_ids to decimal and matching with CLOB asset_ids...');
  console.log('');

  const matchResult = await clickhouse.query({ query: matchQuery });
  const matchData = await matchResult.json();
  const matches = matchData.data?.[0]?.matches || 0;

  console.log(`Matches after hex→decimal conversion: ${matches}`);
  console.log('');

  if (matches > 0) {
    console.log(`✅ Found ${matches} matching markets between blockchain and CLOB!`);
    console.log('');
    console.log('The formats were different but data overlaps.');
    console.log('Now calculating the REAL delta...');
    console.log('');

    // Calculate real delta
    const deltaQuery = `
      WITH blockchain AS (
        SELECT
          token_id,
          reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))) as decimal_id,
          COUNT(*) as transfers
        FROM erc1155_transfers
        WHERE lower(from_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
           OR lower(to_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
        GROUP BY token_id
      ),
      clob AS (
        SELECT
          asset_id,
          toUInt256(asset_id) as decimal_id,
          COUNT(*) as fills
        FROM clob_fills
        WHERE lower(proxy_wallet) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
           OR lower(user_eoa) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
        GROUP BY asset_id
      )
      SELECT
        COUNT(DISTINCT b.decimal_id) as blockchain_tokens,
        COUNT(DISTINCT c.decimal_id) as clob_tokens,
        COUNT(DISTINCT b.decimal_id) - COUNT(DISTINCT c.decimal_id) as delta_tokens
      FROM blockchain b
      FULL OUTER JOIN clob c ON b.decimal_id = c.decimal_id
    `;

    const deltaResult = await clickhouse.query({ query: deltaQuery });
    const deltaData = await deltaResult.json();

    if (deltaData.data && deltaData.data.length > 0) {
      const stats = deltaData.data[0];
      console.log(`Blockchain unique tokens: ${stats.blockchain_tokens}`);
      console.log(`CLOB unique tokens: ${stats.clob_tokens}`);
      console.log(`Delta (blockchain only): ${stats.delta_tokens}`);
    }
  } else {
    console.log('❌ Still zero matches even after conversion');
    console.log('');
    console.log('This could mean:');
    console.log('1. Conversion formula is wrong');
    console.log('2. erc1155_transfers has different wallet addresses');
    console.log('3. Truly separate trading streams (AMM vs CLOB)');
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
