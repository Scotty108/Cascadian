import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CHECK REDEMPTIONS/BURNS FOR WALLET');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Target wallet: ${WALLET}\n`);

  // Check for burns (transfers to zero address)
  console.log('Step 1: Check for burn events (transfers to 0x0)...\n');

  const burnsQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS burn_count,
        count(DISTINCT token_id) AS unique_tokens,
        min(block_timestamp) AS first_burn,
        max(block_timestamp) AS last_burn
      FROM default.erc1155_transfers
      WHERE lower(from_address) = lower('${WALLET}')
        AND lower(to_address) = lower('${ZERO_ADDRESS}')
    `,
    format: 'JSONEachRow'
  });

  const burns: any[] = await burnsQuery.json();
  const b = burns[0];

  console.log(`   Burn events: ${b.burn_count}`);
  console.log(`   Unique tokens: ${b.unique_tokens}`);
  console.log(`   First burn: ${b.first_burn || 'N/A'}`);
  console.log(`   Last burn: ${b.last_burn || 'N/A'}\n`);

  if (parseInt(b.burn_count) === 0) {
    console.log('❌ NO BURN EVENTS FOUND');
    console.log('   This wallet has not redeemed any positions\n');
    console.log('Implication: Dune\'s $80K realized CANNOT come from redemptions');
    console.log('             It must be from round-trip CLOB trading\n');
  } else {
    console.log('✅ Found burn events - wallet has redeemed positions\n');

    // Sample some burns
    console.log('Step 2: Sample burn events...\n');

    const sampleQuery = await clickhouse.query({
      query: `
        SELECT
          token_id,
          value,
          block_timestamp,
          tx_hash
        FROM default.erc1155_transfers
        WHERE lower(from_address) = lower('${WALLET}')
          AND lower(to_address) = lower('${ZERO_ADDRESS}')
        ORDER BY block_timestamp DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const samples: any[] = await sampleQuery.json();

    samples.forEach((s, i) => {
      console.log(`   Burn ${i + 1}:`);
      console.log(`      Token: ${s.token_id.substring(0, 20)}...`);
      console.log(`      Value: ${s.value}`);
      console.log(`      Time: ${s.block_timestamp}`);
      console.log(`      Tx: ${s.tx_hash.substring(0, 20)}...\n`);
    });
  }

  // Check for USDC receipts (potential payouts)
  console.log('Step 3: Check for USDC inflows (potential payouts)...\n');

  const usdcQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS transfer_count,
        min(block_timestamp) AS first_receipt,
        max(block_timestamp) AS last_receipt
      FROM default.erc20_transfers
      WHERE lower(to_address) = lower('${WALLET}')
        AND lower(token_address) = lower('0x2791bca1f2de4661ed88a30c99a7a9449aa84174')
    `,
    format: 'JSONEachRow'
  });

  const usdc: any[] = await usdcQuery.json();

  if (usdc.length > 0 && usdc[0].transfer_count) {
    const u = usdc[0];
    console.log(`   USDC receipts: ${u.transfer_count}`);
    console.log(`   First: ${u.first_receipt || 'N/A'}`);
    console.log(`   Last: ${u.last_receipt || 'N/A'}\n`);
  } else {
    console.log('   No USDC transfers found or table does not exist\n');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ASSESSMENT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const burnCount = parseInt(b.burn_count);

  if (burnCount === 0) {
    console.log('Current findings:');
    console.log('   ✅ Trading P&L (average cost): $3.51');
    console.log('   ✅ Redemption P&L: $0.00 (no burns)');
    console.log('   ✅ Total realized: $3.51\n');
    console.log('Gap to Dune (~$80K): $79,996.49\n');
    console.log('This gap MUST come from CLOB trading we\'re missing. Possible causes:');
    console.log('   1. Missing historical trades before 2024-08-22');
    console.log('   2. Missing trader proxy addresses');
    console.log('   3. Incomplete fill data in clob_fills');
    console.log('   4. Different cost basis method (FIFO vs average cost)\n');
    console.log('Next step: Check if Dune uses data from before 2024-08-22\n');
  } else {
    console.log(`Found ${burnCount} redemptions - need to calculate redemption P&L`);
    console.log('Next step: Match burns to market outcomes and calculate payouts\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
