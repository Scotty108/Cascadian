import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 4: BURNS VALUATION (REDEMPTION CASH FLOWS)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Step 1: Creating wallet_payout_collected view...');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_payout_collected AS
      WITH burns AS (
        SELECT
          lower(from_address) AS wallet,
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS ctf_hex64,
          toUInt16(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 255)) AS mask,
          toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6 AS shares,
          block_timestamp
        FROM erc1155_transfers
        WHERE lower(to_address) = '0x0000000000000000000000000000000000000000'
      )
      SELECT
        b.wallet,
        b.ctf_hex64,
        b.mask,
        sum(b.shares) AS total_shares,
        sum(
          b.shares * arraySum(arrayMap(
            j -> if(bitAnd(b.mask, bitShiftLeft(1, j)) > 0,
                    coalesce(arrayElement(t.pps, j + 1), 0.0), 0.0),
            range(length(coalesce(t.pps, [])))
          ))
        ) AS payout_collected
      FROM burns b
      LEFT JOIN token_per_share_payout t ON t.condition_id_ctf = b.ctf_hex64
      GROUP BY b.wallet, b.ctf_hex64, b.mask
    `
  });

  console.log('   ✅ View created\n');

  console.log('Step 2: Calculating redemption value for test wallet...\n');

  const redemptionQuery = await clickhouse.query({
    query: `
      SELECT
        ctf_hex64,
        mask,
        total_shares,
        round(payout_collected, 2) AS payout_collected
      FROM wallet_payout_collected
      WHERE lower(wallet) = lower('${wallet}')
      ORDER BY payout_collected DESC
    `,
    format: 'JSONEachRow'
  });
  const redemptions: any[] = await redemptionQuery.json();

  console.log(`   Redemptions with value > $0:\n`);

  let totalPayout = 0;
  let countWithValue = 0;

  redemptions.forEach((r, i) => {
    if (Number(r.payout_collected) > 0) {
      countWithValue++;
      if (countWithValue <= 5) {
        console.log(`   ${countWithValue}. ${r.ctf_hex64.substring(0, 20)}... (mask: ${r.mask})`);
        console.log(`      Shares: ${Number(r.total_shares).toLocaleString()}`);
        console.log(`      Payout: $${Number(r.payout_collected).toLocaleString()}`);
      }
      totalPayout += Number(r.payout_collected);
    }
  });

  console.log(`\n   Total redemption value: $${totalPayout.toLocaleString()}`);
  console.log(`   Redemptions with value: ${countWithValue} / ${redemptions.length}\n`);

  // Step 3: Calculate total P&L
  console.log('Step 3: Calculating total realized P&L...\n');

  const clobPnlQuery = await clickhouse.query({
    query: `
      SELECT sum(pnl_net) AS clob_pnl
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const clobPnl = await clobPnlQuery.json();

  const clobValue = Number(clobPnl[0].clob_pnl);
  const totalRealized = clobValue + totalPayout;

  console.log(`   CLOB P&L: $${clobValue.toLocaleString()}`);
  console.log(`   Redemption value: $${totalPayout.toLocaleString()}`);
  console.log(`   ────────────────────────────────────`);
  console.log(`   Total Realized P&L: $${totalRealized.toLocaleString()}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 4 ACCEPTANCE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check for NULL/NaN
  const nullCheckQuery = await clickhouse.query({
    query: `
      SELECT
        countIf(isNaN(payout_collected) OR isInfinite(payout_collected)) AS bad_values
      FROM wallet_payout_collected
    `,
    format: 'JSONEachRow'
  });
  const nullCheck = await nullCheckQuery.json();

  console.log(`   ✅ Burn cash flows calculated`);
  console.log(`   ${nullCheck[0].bad_values === 0 ? '✅' : '❌'} No NULL or NaN in outputs (${nullCheck[0].bad_values} bad values)`);
  console.log(`   ${countWithValue > 0 ? '✅' : '⚠️ '} ${countWithValue} redemptions with value > $0\n`);

  if (nullCheck[0].bad_values === 0 && countWithValue > 0) {
    console.log('✅ PHASE 4 COMPLETE\n');
    console.log(`Current P&L: $${totalRealized.toLocaleString()}`);
    console.log(`Polymarket UI: $95,406`);
    console.log(`Gap: $${(95406 - totalRealized).toLocaleString()}\n`);
    console.log(`Next: Phase 7 to backfill ${redemptions.length - countWithValue} markets with missing resolution data\n`);
  } else {
    console.log('⚠️  PHASE 4 NEEDS REVIEW\n');
  }
}

main().catch(console.error);
