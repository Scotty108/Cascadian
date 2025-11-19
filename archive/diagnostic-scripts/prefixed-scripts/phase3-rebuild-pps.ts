import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 3: REBUILD token_per_share_payout WITH NEW BRIDGE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Step 1: Rebuilding token_per_share_payout view...');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW token_per_share_payout AS
      SELECT
        b.ctf_hex64 AS condition_id_ctf,
        arrayMap(
          i -> toFloat64(r.payout_numerators[i]) / nullIf(toFloat64(r.payout_denominator), 0.0),
          arrayEnumerate(r.payout_numerators)
        ) AS pps
      FROM ctf_to_market_bridge_mat b
      JOIN market_resolutions_final r
        ON lower(r.condition_id_norm) = lower(b.market_hex64)
    `
  });

  console.log('   ✅ View rebuilt\n');

  console.log('Step 2: Checking coverage...\n');

  // Total PPS entries
  const totalQuery = await clickhouse.query({
    query: `SELECT count() AS total FROM token_per_share_payout`,
    format: 'JSONEachRow'
  });
  const total = await totalQuery.json();
  console.log(`   Total PPS entries: ${total[0].total.toLocaleString()}\n`);

  // Check redemptions coverage
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const redemptionCoverageQuery = await clickhouse.query({
    query: `
      WITH burns AS (
        SELECT DISTINCT
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS ctf_hex64
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND lower(to_address) = '0x0000000000000000000000000000000000000000'
      )
      SELECT
        (SELECT count() FROM burns) AS total_burns,
        (SELECT count() FROM burns b JOIN token_per_share_payout t ON t.condition_id_ctf = b.ctf_hex64) AS with_pps,
        (SELECT count() FROM burns b JOIN token_per_share_payout t ON t.condition_id_ctf = b.ctf_hex64 WHERE length(t.pps) > 0) AS with_non_empty_pps,
        round(with_pps * 100.0 / total_burns, 2) AS join_pct,
        round(with_non_empty_pps * 100.0 / total_burns, 2) AS data_pct
    `,
    format: 'JSONEachRow'
  });
  const coverage = await redemptionCoverageQuery.json();

  console.log('   Redemption coverage for test wallet:');
  console.log(`      Total redemption CTF IDs: ${coverage[0].total_burns}`);
  console.log(`      With PPS (joined): ${coverage[0].with_pps} (${coverage[0].join_pct}%)`);
  console.log(`      With non-empty PPS: ${coverage[0].with_non_empty_pps} (${coverage[0].data_pct}%)\n`);

  // List missing ones
  const missingQuery = await clickhouse.query({
    query: `
      WITH burns AS (
        SELECT DISTINCT
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS ctf_hex64,
          sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6) AS total_shares
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND lower(to_address) = '0x0000000000000000000000000000000000000000'
        GROUP BY ctf_hex64
      )
      SELECT
        b.ctf_hex64,
        b.total_shares,
        t.pps,
        length(coalesce(t.pps, [])) AS pps_len,
        CASE
          WHEN t.pps IS NULL THEN 'NO_JOIN'
          WHEN length(t.pps) = 0 THEN 'EMPTY_PPS'
          ELSE 'HAS_DATA'
        END AS status
      FROM burns b
      LEFT JOIN token_per_share_payout t ON t.condition_id_ctf = b.ctf_hex64
      WHERE status != 'HAS_DATA'
      ORDER BY b.total_shares DESC
    `,
    format: 'JSONEachRow'
  });
  const missing: any[] = await missingQuery.json();

  if (missing.length > 0) {
    console.log(`   Missing/empty PPS for ${missing.length} CTF IDs:\n`);
    missing.slice(0, 5).forEach((m, i) => {
      console.log(`   ${(i + 1).toString().padStart(2)}. ${m.ctf_hex64.substring(0, 20)}...`);
      console.log(`       Shares: ${Number(m.total_shares).toLocaleString()}`);
      console.log(`       Status: ${m.status}`);
    });
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 3 ACCEPTANCE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const resolved_with_data = Number(coverage[0].data_pct);

  if (resolved_with_data === 100) {
    console.log('✅ 100% of redemptions have non-empty PPS arrays');
    console.log('✅ PHASE 3 COMPLETE\n');
  } else if (resolved_with_data > 0) {
    console.log(`⚠️  ${resolved_with_data}% of redemptions have PPS data`);
    console.log(`⚠️  ${100 - resolved_with_data}% need backfill (Phase 7)`);
    console.log('⚠️  PHASE 3 PARTIAL - Proceed to Phase 4, then Phase 7 for backfill\n');
  } else {
    console.log('❌ No redemptions have PPS data - investigate\n');
  }
}

main().catch(console.error);
