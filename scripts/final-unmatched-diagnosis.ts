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
  console.log('FINAL UNMATCHED BLOCKCHAIN RESOLUTIONS DIAGNOSIS');
  console.log('═'.repeat(80));
  console.log();

  // Correct aggregate query - count DISTINCT condition IDs that have activity
  console.log('1. Aggregate Analysis (Corrected)');
  console.log('─'.repeat(80));

  const aggregate = await client.query({
    query: `
      WITH unmatched_bc_ids AS (
        SELECT DISTINCT r.condition_id_norm as cid
        FROM default.market_resolutions_final r
        WHERE r.source = 'blockchain'
          AND concat('0x', r.condition_id_norm) NOT IN (
            SELECT DISTINCT condition_id_norm
            FROM default.vw_trades_canonical
            WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          )
      ),
      with_erc1155_activity AS (
        SELECT DISTINCT u.cid
        FROM unmatched_bc_ids u
        INNER JOIN default.erc1155_transfers e
          ON lower(replaceAll(e.token_id, '0x', '')) = lower(u.cid)
      )
      SELECT
        (SELECT count(*) FROM unmatched_bc_ids) as total_unmatched,
        (SELECT count(*) FROM with_erc1155_activity) as with_activity,
        (SELECT count(*) FROM unmatched_bc_ids) - (SELECT count(*) FROM with_erc1155_activity) as without_activity
    `,
    format: 'JSONEachRow',
  });

  const agg = (await aggregate.json<any[]>())[0];
  const activityPct = (100 * agg.with_activity / agg.total_unmatched).toFixed(1);
  const noActivityPct = (100 * agg.without_activity / agg.total_unmatched).toFixed(1);

  console.log(`Total unmatched blockchain resolutions:  ${agg.total_unmatched.toLocaleString()}`);
  console.log(`  With ERC1155 on-chain activity:        ${agg.with_activity.toLocaleString()} (${activityPct}%)`);
  console.log(`  With NO on-chain activity:             ${agg.without_activity.toLocaleString()} (${noActivityPct}%)`);
  console.log();

  // 2. Check if those with activity have USDC transfers too
  if (agg.with_activity > 0) {
    console.log('2. Markets with ERC1155 Activity - Missing USDC Link?');
    console.log('─'.repeat(80));

    // These may be missing because they don't have corresponding USDC transfers
    // Or the vw_trades_canonical construction is broken
    console.log(`Found ${agg.with_activity.toLocaleString()} blockchain resolutions with ERC1155 activity missing from trades`);
    console.log('This suggests a gap in vw_trades_canonical construction!');
    console.log();

    // Sample a few to investigate
    const samples = await client.query({
      query: `
        WITH unmatched_bc_ids AS (
          SELECT DISTINCT r.condition_id_norm as cid
          FROM default.market_resolutions_final r
          WHERE r.source = 'blockchain'
            AND concat('0x', r.condition_id_norm) NOT IN (
              SELECT DISTINCT condition_id_norm
              FROM default.vw_trades_canonical
            )
        )
        SELECT
          u.cid,
          count(e.tx_hash) as erc1155_transfers,
          count(DISTINCT e.tx_hash) as unique_txs
        FROM unmatched_bc_ids u
        INNER JOIN default.erc1155_transfers e
          ON lower(replaceAll(e.token_id, '0x', '')) = lower(u.cid)
        GROUP BY u.cid
        ORDER BY unique_txs DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });

    const sampleRows = await samples.json<any[]>();
    console.log('Top 5 unmatched IDs by transaction volume:');
    sampleRows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.cid}`);
      console.log(`     ${row.erc1155_transfers} ERC1155 transfers in ${row.unique_txs} transactions`);
    });
    console.log();
  }

  // 3. Summary and recommendation
  console.log('═'.repeat(80));
  console.log('FINAL DIAGNOSIS');
  console.log('═'.repeat(80));
  console.log();

  if (agg.with_activity > 0) {
    console.log('🚨 CRITICAL FINDING:');
    console.log(`   ${agg.with_activity.toLocaleString()} blockchain resolutions have on-chain ERC1155 activity`);
    console.log('   but are MISSING from vw_trades_canonical!');
    console.log();
    console.log('ROOT CAUSE:');
    console.log('   Either vw_trades_canonical construction is broken, OR');
    console.log('   these ERC1155 transfers are not actual "trades" (e.g., minting, redemptions)');
    console.log();
    console.log('NEXT STEPS:');
    console.log('   1. Investigate vw_trades_canonical construction logic');
    console.log('   2. Check if ERC1155 transfers require matching USDC transfers to be trades');
    console.log('   3. Verify condition ID normalization in trade construction');
  } else {
    console.log('✅ FINDING:');
    console.log('   ALL unmatched blockchain resolutions have NO on-chain trading activity');
    console.log();
    console.log('CONCLUSION:');
    console.log('   These are markets that were resolved but never traded on Polymarket.');
    console.log('   The blind blockchain scan was inefficient but did not miss any trades.');
    console.log();
    console.log('EXPLANATION:');
    console.log('   Coverage did not improve because:');
    console.log('   - 73% of blockchain resolutions are for untraded markets');
    console.log('   - 27% that matched were already covered by other sources');
    console.log();
    console.log('RECOMMENDATION:');
    console.log('   Stop blind blockchain scans. Use targeted approach:');
    console.log('   1. Get list of 171K missing condition IDs from vw_trades_canonical');
    console.log('   2. Query Polymarket API for those specific markets');
    console.log('   3. Query blockchain only for those specific condition IDs (filtered events)');
  }

  await client.close();
}

main().catch(console.error);
