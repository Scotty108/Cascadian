/**
 * CHECK RESOLUTION FORMATS
 *
 * Purpose: Compare condition_id formats between tables to find the mismatch
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('RESOLUTION FORMAT INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check 1: What condition_ids exist in market_resolutions_final?
  console.log('📊 Sample condition_ids from market_resolutions_final:\n');

  const resolutionsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        payout_numerators,
        length(condition_id_norm) as id_length
      FROM market_resolutions_final
      WHERE winning_index IS NOT NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const resolutions: any[] = await resolutionsQuery.json();

  console.log(`Found ${resolutions.length} sample resolutions:\n`);
  for (const r of resolutions) {
    console.log(`Condition ID: ${r.condition_id_norm}`);
    console.log(`  Length: ${r.id_length} chars`);
    console.log(`  Winning Index: ${r.winning_index}`);
    console.log(`  Payout: ${JSON.stringify(r.payout_numerators)}\n`);
  }

  // Check 2: What asset_ids exist in clob_fills?
  console.log('\n📊 Sample asset_ids from clob_fills:\n');

  const fillsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        asset_id,
        length(asset_id) as id_length
      FROM clob_fills
      WHERE proxy_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const fills: any[] = await fillsQuery.json();

  console.log(`Found ${fills.length} distinct asset_ids:\n`);
  for (const f of fills) {
    console.log(`Asset ID: ${f.asset_id}`);
    console.log(`  Length: ${f.id_length} chars\n`);
  }

  // Check 3: Try to find WHERE resolutions ARE coming from
  console.log('\n📊 Checking alternative resolution sources:\n');

  // Check if there's a different table
  const tablesQuery = await clickhouse.query({
    query: `
      SELECT
        name,
        engine
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%resolution%' OR name LIKE '%market%' OR name LIKE '%outcome%')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await tablesQuery.json();
  console.log('Tables with resolution/market/outcome in name:\n');
  for (const t of tables) {
    console.log(`  - ${t.name} (${t.engine})`);
  }

  // Check 4: Are asset_ids actually ERC1155 token_ids?
  console.log('\n📊 Checking erc1155_transfers.token_id format:\n');

  const erc1155Query = await clickhouse.query({
    query: `
      SELECT DISTINCT
        token_id,
        length(token_id) as id_length
      FROM erc1155_transfers
      WHERE "from" = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
         OR "to" = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const erc1155: any[] = await erc1155Query.json();

  console.log(`Found ${erc1155.length} distinct token_ids:\n`);
  for (const e of erc1155) {
    console.log(`Token ID: ${e.token_id}`);
    console.log(`  Length: ${e.id_length} chars\n`);
  }

  // Check 5: Try decoding an actual ERC1155 token_id
  if (erc1155.length > 0) {
    console.log('\n📊 Decoding sample ERC1155 token_id:\n');

    const sampleTokenId = erc1155[0].token_id;
    console.log(`Sample token_id: ${sampleTokenId}\n`);

    const decodeQuery = await clickhouse.query({
      query: `
        SELECT
          '${sampleTokenId}' as token_id,
          lpad(lower(hex(bitShiftRight(toUInt256('${sampleTokenId}'), 8))), 64, '0') as condition_id_hex,
          toUInt8(bitAnd(toUInt256('${sampleTokenId}'), 255)) as outcome_index
      `,
      format: 'JSONEachRow'
    });

    const decoded: any = (await decodeQuery.json())[0];
    console.log(`Decoded condition_id: ${decoded.condition_id_hex}`);
    console.log(`Decoded outcome_index: ${decoded.outcome_index}\n`);

    // Check if THIS matches in resolutions
    const matchQuery = await clickhouse.query({
      query: `
        SELECT COUNT(*) as match_count
        FROM market_resolutions_final
        WHERE condition_id_norm = '${decoded.condition_id_hex}'
      `,
      format: 'JSONEachRow'
    });

    const matchResult: any = (await matchQuery.json())[0];
    console.log(`Matches in market_resolutions_final: ${matchResult.match_count}\n`);
  }

  console.log('✅ INVESTIGATION COMPLETE\n');
}

main().catch(console.error);
