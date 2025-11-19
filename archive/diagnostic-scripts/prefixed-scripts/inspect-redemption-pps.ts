import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('INSPECTING PPS ARRAYS FOR REDEMPTIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get redemptions with their full PPS arrays and calculate payouts manually
  const query = await clickhouse.query({
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
      )
      SELECT
        d.condition_id_ctf,
        d.index_set_mask,
        d.shares_redeemed,
        d.block_timestamp,
        t.pps,
        length(coalesce(t.pps, [])) AS pps_len
      FROM decoded d
      LEFT JOIN token_per_share_payout t USING(condition_id_ctf)
      ORDER BY d.shares_redeemed DESC
    `,
    format: 'JSONEachRow'
  });

  const results: any[] = await query.json();

  console.log('Redemptions with PPS Arrays:\n');

  results.forEach((r, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${r.shares_redeemed.toLocaleString()} shares`);
    console.log(`    CTF: ${r.condition_id_ctf.substring(0, 16)}...`);
    console.log(`    Mask (decimal): ${r.index_set_mask}`);
    console.log(`    Mask (binary): ${r.index_set_mask.toString(2).padStart(8, '0')}`);
    console.log(`    Date: ${r.block_timestamp}`);

    if (r.pps) {
      const pps_sum = r.pps.reduce((sum: number, val: number) => sum + (val || 0), 0);
      console.log(`    PPS Array (${r.pps_len} elements): [${r.pps.join(', ')}]`);
      console.log(`    PPS Sum: ${pps_sum}`);

      // Calculate which bits are set in the mask
      const bitsSet = [];
      for (let j = 0; j < 8; j++) {
        if ((r.index_set_mask & (1 << j)) > 0) {
          bitsSet.push(j);
        }
      }
      console.log(`    Bits set in mask: [${bitsSet.join(', ')}]`);

      // Calculate per-share payout using mask logic
      let perSharePayout = 0;
      for (let j = 0; j < r.pps.length; j++) {
        if ((r.index_set_mask & (1 << j)) > 0) {
          perSharePayout += r.pps[j];
        }
      }

      const totalPayout = perSharePayout * r.shares_redeemed;
      console.log(`    Per-share payout: ${perSharePayout}`);
      console.log(`    Total payout: $${totalPayout.toFixed(2)}`);
    } else {
      console.log(`    PPS Array: NULL (no payout data)`);
    }
    console.log();
  });

  // Sum total
  let totalRedemptionValue = 0;
  results.forEach(r => {
    if (r.pps) {
      let perSharePayout = 0;
      for (let j = 0; j < r.pps.length; j++) {
        if ((r.index_set_mask & (1 << j)) > 0) {
          perSharePayout += r.pps[j];
        }
      }
      totalRedemptionValue += perSharePayout * r.shares_redeemed;
    }
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`   Total redemption value: $${totalRedemptionValue.toFixed(2)}`);
  console.log(`   CLOB P&L: $14,490.18`);
  console.log(`   Combined: $${(14490.18 + totalRedemptionValue).toFixed(2)}`);
  console.log(`   Polymarket UI: $95,406`);
  console.log(`   Still missing: $${(95406 - 14490.18 - totalRedemptionValue).toFixed(2)}\n`);
}

main().catch(console.error);
