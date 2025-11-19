/**
 * COMPARE ASSET IDS vs TOKEN IDS
 *
 * Purpose: Check if clob_fills.asset_id matches erc1155_transfers.token_id
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ASSET_ID vs TOKEN_ID COMPARISON');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get sample asset_ids from clob_fills
  const fillsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        asset_id
      FROM clob_fills
      WHERE proxy_wallet = '${TARGET_WALLET}'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const fills: any[] = await fillsQuery.json();

  console.log(`Sample asset_ids from clob_fills:\n`);
  for (const f of fills) {
    console.log(`  ${f.asset_id}`);
  }

  // Get sample token_ids from erc1155_transfers
  const transfersQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        token_id
      FROM erc1155_transfers
      WHERE from_address = '${TARGET_WALLET}'
         OR to_address = '${TARGET_WALLET}'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const transfers: any[] = await transfersQuery.json();

  console.log(`\nSample token_ids from erc1155_transfers:\n`);
  for (const t of transfers) {
    console.log(`  ${t.token_id}`);
    // Convert to decimal
    const decimal = BigInt(t.token_id).toString();
    console.log(`    (decimal: ${decimal})`);
  }

  // Check if any asset_id matches a token_id (as decimal)
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('CHECKING FOR MATCHES');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const f of fills.slice(0, 3)) {
    console.log(`\nChecking asset_id: ${f.asset_id.substring(0, 30)}...`);

    const matchQuery = await clickhouse.query({
      query: `
        SELECT
          token_id
        FROM erc1155_transfers
        WHERE toString(toUInt256(token_id)) = '${f.asset_id}'
           OR token_id = concat('0x', lower(hex(toUInt256('${f.asset_id}'))))
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const matches: any[] = await matchQuery.json();

    if (matches.length > 0) {
      console.log(`  ✅ MATCH FOUND: ${matches[0].token_id}`);
    } else {
      console.log(`  ❌ NO MATCH`);

      // Try to decode this asset_id anyway
      console.log(`\n  Decoding as if it were a token_id:`);

      const decodeQuery = await clickhouse.query({
        query: `
          SELECT
            lpad(lower(hex(bitShiftRight(toUInt256('${f.asset_id}'), 8))), 64, '0') as condition_id,
            toUInt8(bitAnd(toUInt256('${f.asset_id}'), 255)) as outcome_index
        `,
        format: 'JSONEachRow'
      });

      const decoded: any = (await decodeQuery.json())[0];
      console.log(`    Condition ID: ${decoded.condition_id}`);
      console.log(`    Outcome Index: ${decoded.outcome_index}`);

      // Check if condition_id exists in resolutions
      const resQuery = await clickhouse.query({
        query: `
          SELECT
            condition_id_norm,
            outcome_count,
            payout_numerators
          FROM market_resolutions_final
          WHERE condition_id_norm = '${decoded.condition_id}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const res: any[] = await resQuery.json();
      if (res.length > 0) {
        console.log(`    ✅ Condition found in resolutions!`);
        console.log(`       Outcome count: ${res[0].outcome_count}`);
        console.log(`       Payouts: ${JSON.stringify(res[0].payout_numerators)}`);
        console.log(`       ⚠️ Outcome ${decoded.outcome_index} out of range for ${res[0].outcome_count} outcomes!`);
      } else {
        console.log(`    ❌ Condition NOT in resolutions`);
      }
    }
  }

  console.log('\n✅ COMPARISON COMPLETE\n');
}

main().catch(console.error);
