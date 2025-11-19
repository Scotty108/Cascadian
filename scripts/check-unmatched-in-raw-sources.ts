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

async function main() {
  console.log('CHECKING IF UNMATCHED BLOCKCHAIN IDs EXIST IN RAW SOURCES');
  console.log('═'.repeat(80));
  console.log();

  // Get sample unmatched blockchain IDs
  const unmatched = await client.query({
    query: `
      SELECT r.condition_id_norm
      FROM default.market_resolutions_final r
      WHERE r.source = 'blockchain'
        AND concat('0x', r.condition_id_norm) NOT IN (
          SELECT DISTINCT condition_id_norm
          FROM default.vw_trades_canonical
        )
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const unmatchedIds = await unmatched.json<Array<{condition_id_norm: string}>>();

  console.log(`Testing ${unmatchedIds.length} unmatched blockchain condition IDs:`);
  console.log();

  for (const {condition_id_norm: id} of unmatchedIds) {
    console.log(`Condition ID: ${id}`);
    console.log('─'.repeat(80));

    // Check vw_trades_canonical with all format variations
    const canonical = await client.query({
      query: `
        SELECT count(*) as cnt
        FROM default.vw_trades_canonical
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = lower('${id}')
      `,
      format: 'JSONEachRow',
    });
    const canonicalCnt = (await canonical.json<any[]>())[0].cnt;
    console.log(`  vw_trades_canonical: ${canonicalCnt} trades`);

    // Check raw CLOB fills
    try {
      const clob = await client.query({
        query: `
          SELECT count(*) as cnt
          FROM default.trades_clob_raw
          WHERE lower(replaceAll(asset_id, '0x', '')) = lower('${id}')
        `,
        format: 'JSONEachRow',
      });
      const clobCnt = (await clob.json<any[]>())[0].cnt;
      console.log(`  trades_clob_raw (asset_id): ${clobCnt} fills`);
    } catch (e: any) {
      console.log(`  trades_clob_raw: Table not accessible (${e.message})`);
    }

    // Check ERC1155 transfers (token_id)
    try {
      const erc1155 = await client.query({
        query: `
          SELECT count(*) as cnt, count(DISTINCT tx_hash) as txs
          FROM default.erc1155_transfers
          WHERE lower(replaceAll(token_id, '0x', '')) = lower('${id}')
        `,
        format: 'JSONEachRow',
      });
      const erc1155Res = (await erc1155.json<any[]>())[0];
      console.log(`  erc1155_transfers (token_id): ${erc1155Res.cnt} transfers, ${erc1155Res.txs} txs`);
    } catch (e: any) {
      console.log(`  erc1155_transfers: Table not accessible (${e.message})`);
    }

    // Check if there are USDC transfers in the same transactions
    try {
      const usdc = await client.query({
        query: `
          SELECT count(*) as cnt
          FROM default.usdc_transfers u
          WHERE tx_hash IN (
            SELECT DISTINCT tx_hash
            FROM default.erc1155_transfers
            WHERE lower(replaceAll(token_id, '0x', '')) = lower('${id}')
          )
        `,
        format: 'JSONEachRow',
      });
      const usdcCnt = (await usdc.json<any[]>())[0].cnt;
      console.log(`  usdc_transfers (in same txs): ${usdcCnt} transfers`);
    } catch (e: any) {
      console.log(`  usdc_transfers: Table not accessible (${e.message})`);
    }

    console.log();
  }

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));

  // Count how many unmatched blockchain IDs have ANY activity in raw sources
  const activityCheck = await client.query({
    query: `
      WITH unmatched_ids AS (
        SELECT r.condition_id_norm as cid
        FROM default.market_resolutions_final r
        WHERE r.source = 'blockchain'
          AND concat('0x', r.condition_id_norm) NOT IN (
            SELECT DISTINCT condition_id_norm
            FROM default.vw_trades_canonical
          )
      )
      SELECT
        count(DISTINCT u.cid) as total_unmatched,
        countIf(e.token_id IS NOT NULL) as has_erc1155_activity,
        countIf(e.token_id IS NULL) as no_activity
      FROM unmatched_ids u
      LEFT JOIN default.erc1155_transfers e
        ON lower(replaceAll(e.token_id, '0x', '')) = lower(u.cid)
    `,
    format: 'JSONEachRow',
  });

  const summary = (await activityCheck.json<any[]>())[0];
  console.log(`Total unmatched blockchain resolutions: ${summary.total_unmatched.toLocaleString()}`);
  console.log(`  With ERC1155 transfer activity: ${summary.has_erc1155_activity.toLocaleString()}`);
  console.log(`  With NO on-chain activity: ${summary.no_activity.toLocaleString()}`);
  console.log();

  console.log('DIAGNOSIS:');
  if (summary.has_erc1155_activity > 0) {
    console.log('⚠️  CRITICAL: Some unmatched IDs have ERC1155 activity but are missing from vw_trades_canonical');
    console.log('   This indicates a gap in the trade reconstruction pipeline!');
  } else {
    console.log('✅ Unmatched blockchain resolutions have no on-chain trading activity');
    console.log('   These are likely markets that were resolved but never traded on Polymarket');
  }

  await client.close();
}

main().catch(console.error);
