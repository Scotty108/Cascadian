import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ERC1155 REDEMPTION ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get all ERC1155 transfers for this wallet
  const transfersQuery = await clickhouse.query({
    query: `
      SELECT
        token_id,
        from_address,
        to_address,
        value,
        block_timestamp,
        tx_hash
      FROM erc1155_transfers
      WHERE (lower(to_address) = lower('${wallet}')
         OR lower(from_address) = lower('${wallet}'))
      ORDER BY block_timestamp DESC
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const transfers: any[] = await transfersQuery.json();

  console.log(`Total ERC1155 transfers (last 100): ${transfers.length}\n`);

  // Categorize transfers
  const incoming = transfers.filter(t => t.to_address.toLowerCase() === wallet.toLowerCase());
  const outgoing = transfers.filter(t => t.from_address.toLowerCase() === wallet.toLowerCase());

  console.log('Transfer Breakdown:');
  console.log(`   Incoming: ${incoming.length}`);
  console.log(`   Outgoing: ${outgoing.length}\n`);

  // Look for redemptions (transfers FROM wallet TO zero address or CTF contract)
  const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'; // Polymarket CTF contract
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  const redemptions = outgoing.filter(t =>
    t.to_address.toLowerCase() === CTF_ADDRESS.toLowerCase() ||
    t.to_address.toLowerCase() === ZERO_ADDRESS
  );

  console.log(`Potential redemptions (to CTF/zero): ${redemptions.length}\n`);

  if (redemptions.length > 0) {
    console.log('Sample redemptions:');
    redemptions.slice(0, 10).forEach((r, i) => {
      console.log(`   ${i + 1}. token_id: ${r.token_id}`);
      console.log(`      value: ${r.value}`);
      console.log(`      to: ${r.to_address}`);
      console.log(`      timestamp: ${r.block_timestamp}`);
      console.log();
    });
  }

  // Calculate redemption value
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('REDEMPTION VALUE CALCULATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const redemptionValueQuery = await clickhouse.query({
    query: `
      WITH redemptions AS (
        SELECT
          token_id,
          toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6 AS shares_redeemed,
          block_timestamp
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND (lower(to_address) = lower('${CTF_ADDRESS}')
               OR lower(to_address) = lower('${ZERO_ADDRESS}'))
      ),
      decoded AS (
        SELECT
          r.token_id,
          r.shares_redeemed,
          r.block_timestamp,
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(r.token_id, 3)))), 8))), 62, '0') AS condition_id_ctf,
          toUInt16(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(r.token_id, 3)))), 255)) AS index_set_mask
        FROM redemptions r
      ),
      with_payout AS (
        SELECT
          d.token_id,
          d.shares_redeemed,
          d.block_timestamp,
          d.condition_id_ctf,
          d.index_set_mask,
          t.pps,
          arraySum(arrayMap(j ->
            if(bitAnd(d.index_set_mask, bitShiftLeft(1,j))>0,
               coalesce(arrayElement(t.pps, j+1),0.0), 0.0),
            range(length(coalesce(t.pps, []))))) AS per_share_payout,
          arraySum(arrayMap(j ->
            if(bitAnd(d.index_set_mask, bitShiftLeft(1,j))>0,
               coalesce(arrayElement(t.pps, j+1),0.0), 0.0),
            range(length(coalesce(t.pps, []))))) * d.shares_redeemed AS redemption_value
        FROM decoded d
        LEFT JOIN token_per_share_payout t USING(condition_id_ctf)
      )
      SELECT
        count() AS redemption_count,
        round(sum(shares_redeemed), 2) AS total_shares_redeemed,
        round(sum(redemption_value), 2) AS total_redemption_value
      FROM with_payout
    `,
    format: 'JSONEachRow'
  });

  const redemptionValue = await redemptionValueQuery.json();

  console.log(`   Redemption events: ${redemptionValue[0].redemption_count}`);
  console.log(`   Total shares redeemed: ${Number(redemptionValue[0].total_shares_redeemed).toLocaleString()}`);
  console.log(`   Total value redeemed: $${Number(redemptionValue[0].total_redemption_value).toLocaleString()}\n`);

  // Compare to CLOB-based P&L
  const clobPnlQuery = await clickhouse.query({
    query: `
      SELECT pnl_net
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const clobPnl = await clobPnlQuery.json();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOTAL P&L CALCULATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const clobPnlValue = Number(clobPnl[0].pnl_net);
  const redemptionPnl = Number(redemptionValue[0].total_redemption_value);
  const totalPnl = clobPnlValue + redemptionPnl;

  console.log(`   CLOB-based P&L: $${clobPnlValue.toLocaleString()}`);
  console.log(`   + Redemption value: $${redemptionPnl.toLocaleString()}`);
  console.log(`   = Total P&L: $${totalPnl.toLocaleString()}`);
  console.log(`\n   Polymarket UI shows: $95,406`);
  console.log(`   Our calculation: $${totalPnl.toLocaleString()}`);
  console.log(`   Variance: ${((totalPnl - 95406) / 95406 * 100).toFixed(2)}%`);

  const withinRange = Math.abs((totalPnl - 95406) / 95406) <= 0.02;
  console.log(`\n   ${withinRange ? '✅ SUCCESS' : '⚠️  REVIEW'}: ${withinRange ? 'Within 2%!' : 'Outside 2%'}\n`);

  // Show breakdown of redemptions by market
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOP REDEMPTIONS BY VALUE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const topRedemptionsQuery = await clickhouse.query({
    query: `
      WITH redemptions AS (
        SELECT
          token_id,
          toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6 AS shares_redeemed,
          block_timestamp
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND (lower(to_address) = lower('${CTF_ADDRESS}')
               OR lower(to_address) = lower('${ZERO_ADDRESS}'))
      ),
      decoded AS (
        SELECT
          r.token_id,
          r.shares_redeemed,
          r.block_timestamp,
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(r.token_id, 3)))), 8))), 62, '0') AS condition_id_ctf,
          toUInt16(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(r.token_id, 3)))), 255)) AS index_set_mask
        FROM redemptions r
      ),
      with_payout AS (
        SELECT
          d.condition_id_ctf,
          d.shares_redeemed,
          d.block_timestamp,
          arraySum(arrayMap(j ->
            if(bitAnd(d.index_set_mask, bitShiftLeft(1,j))>0,
               coalesce(arrayElement(t.pps, j+1),0.0), 0.0),
            range(length(coalesce(t.pps, []))))) * d.shares_redeemed AS redemption_value
        FROM decoded d
        LEFT JOIN token_per_share_payout t USING(condition_id_ctf)
      )
      SELECT
        condition_id_ctf,
        sum(shares_redeemed) AS total_shares,
        round(sum(redemption_value), 2) AS total_value
      FROM with_payout
      GROUP BY condition_id_ctf
      ORDER BY total_value DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const topRedemptions: any[] = await topRedemptionsQuery.json();

  topRedemptions.forEach((r, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${r.condition_id_ctf.substring(0, 12)}...`);
    console.log(`    Shares: ${Number(r.total_shares).toLocaleString()}`);
    console.log(`    Value: $${Number(r.total_value).toLocaleString()}`);
  });

  console.log();
}

main().catch(console.error);
