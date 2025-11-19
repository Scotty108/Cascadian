import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CALCULATE REDEMPTION P&L - DIRECT APPROACH');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${WALLET}\n`);

  // Step 1: Get burns with resolutions
  console.log('Step 1: Join burns with market resolutions...\n');

  const query = await clickhouse.query({
    query: `
      WITH burns AS (
        SELECT
          token_id,
          reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) / 1e6 AS shares_burned,
          block_timestamp AS burn_time,
          tx_hash
        FROM default.erc1155_transfers
        WHERE lower(from_address) = lower('${WALLET}')
          AND lower(to_address) = lower('${ZERO_ADDRESS}')
      )
      SELECT
        b.token_id,
        b.shares_burned,
        b.burn_time,
        b.tx_hash,
        mr.condition_id_norm,
        mr.winning_outcome,
        mr.winning_index,
        mr.resolved_at,
        mr.payout_numerators
      FROM burns b
      LEFT JOIN default.market_resolutions_final mr
        ON lower(mr.condition_id_norm) = lower(replaceAll(b.token_id, '0x', ''))
      ORDER BY b.burn_time
    `,
    format: 'JSONEachRow'
  });

  const results: any[] = await query.json();

  console.log(`   Found ${results.length} burn events:\n`);

  let totalRedemptionPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  results.forEach((r, i) => {
    const shares = parseFloat(r.shares_burned);
    const resolved = r.resolved_at !== null;

    console.log(`   ${i + 1}. Burn ${r.token_id.substring(0, 20)}...`);
    console.log(`      Shares: ${shares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`      Burn time: ${r.burn_time}`);

    if (r.condition_id_norm) {
      console.log(`      Condition: ${r.condition_id_norm.substring(0, 20)}...`);
      console.log(`      Resolved: ${resolved ? 'Yes' : 'No'}`);

      if (resolved) {
        console.log(`      Winning outcome: ${r.winning_outcome}`);
        console.log(`      Winning index: ${r.winning_index}`);
        // Assuming burned token = winning outcome, payout = shares × $1
        const payout = shares * 1;
        console.log(`      Payout: $${payout.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        totalRedemptionPnl += payout;
        resolvedCount++;
      } else {
        console.log(`      Status: Unresolved (no payout)`);
        unresolvedCount++;
      }
    } else {
      console.log(`      ❌ No market resolution found`);
      unresolvedCount++;
    }
    console.log();
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Total burns: ${results.length}`);
  console.log(`   Resolved markets: ${resolvedCount}`);
  console.log(`   Unresolved/unmapped: ${unresolvedCount}\n`);

  console.log(`   Gross redemption payout: $${totalRedemptionPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   (before subtracting cost basis)\n`);

  console.log('Note: This assumes ALL burned tokens were WINNING outcomes');
  console.log('      In reality, need to check if burned token = winning outcome\n');

  console.log('To calculate NET redemption P&L:');
  console.log('   1. Find original cost basis for each burned position');
  console.log('   2. Net P&L = payout - cost_basis\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
