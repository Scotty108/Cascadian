import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const assetId = '72016524934977102644827669188692754213186711249642025547408896104495709692655';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('END-TO-END TRACE FOR SINGLE MARKET');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Asset ID: ${assetId}\n`);

  // Step 1: Decode asset_id
  console.log('Step 1: Decode asset_id');
  console.log('─'.repeat(60));
  const decodeQuery = await clickhouse.query({
    query: `
      SELECT
        lower(hex(bitShiftRight(toUInt256('${assetId}'), 8))) AS condition_id_ctf,
        toUInt16(bitAnd(toUInt256('${assetId}'), 255)) AS index_set_mask
    `,
    format: 'JSONEachRow'
  });
  const decoded = await decodeQuery.json();
  const ctfId = decoded[0].condition_id_ctf;
  const mask = decoded[0].index_set_mask;

  console.log(`   CTF condition_id: ${ctfId}`);
  console.log(`   index_set_mask: ${mask} (binary: ${mask.toString(2).padStart(8, '0')})\n`);

  // Step 2: Look up in cid_bridge
  console.log('Step 2: Look up in cid_bridge');
  console.log('─'.repeat(60));
  const bridgeQuery = await clickhouse.query({
    query: `
      SELECT condition_id_market
      FROM cid_bridge
      WHERE condition_id_ctf = '${ctfId}'
    `,
    format: 'JSONEachRow'
  });
  const bridge = await bridgeQuery.json();

  if (bridge.length === 0) {
    console.log('   ❌ NOT FOUND in cid_bridge!\n');
    return;
  }

  const marketId = bridge[0].condition_id_market;
  console.log(`   Market condition_id: ${marketId}\n`);

  // Step 3: Look up resolution
  console.log('Step 3: Look up resolution in market_resolutions_final');
  console.log('─'.repeat(60));
  const resolutionQuery = await clickhouse.query({
    query: `
      SELECT
        payout_numerators,
        payout_denominator,
        winning_index
      FROM market_resolutions_final
      WHERE condition_id_norm = '${marketId}'
    `,
    format: 'JSONEachRow'
  });
  const resolution = await resolutionQuery.json();

  if (resolution.length === 0) {
    console.log('   ❌ NOT FOUND in market_resolutions_final!\n');
    return;
  }

  const numerators = resolution[0].payout_numerators;
  const denominator = resolution[0].payout_denominator;
  const winningIndex = resolution[0].winning_index;
  const pps = numerators.map((n: number) => n / denominator);

  console.log(`   payout_numerators: [${numerators.join(', ')}]`);
  console.log(`   payout_denominator: ${denominator}`);
  console.log(`   winning_index: ${winningIndex}`);
  console.log(`   pps: [${pps.map((p: number) => p.toFixed(6)).join(', ')}]\n`);

  // Step 4: Get wallet's position for this token
  console.log('Step 4: Get wallet position from wallet_token_flows');
  console.log('─'.repeat(60));
  const positionQuery = await clickhouse.query({
    query: `
      SELECT
        net_shares,
        gross_cf,
        fees
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${wallet}')
        AND condition_id_ctf = '${ctfId}'
    `,
    format: 'JSONEachRow'
  });
  const position = await positionQuery.json();

  if (position.length === 0) {
    console.log('   ❌ Wallet has no position in this token!\n');
    return;
  }

  const netShares = Number(position[0].net_shares);
  const grossCf = Number(position[0].gross_cf);
  const fees = Number(position[0].fees);

  console.log(`   net_shares: ${netShares.toFixed(2)}`);
  console.log(`   gross_cf: $${grossCf.toFixed(2)}`);
  console.log(`   fees: $${fees.toFixed(2)}\n`);

  // Step 5: Calculate payout manually
  console.log('Step 5: Calculate payout using mask logic');
  console.log('─'.repeat(60));

  let ppsSum = 0;
  console.log('   Mask bit analysis:');
  for (let j = 0; j < pps.length; j++) {
    const bitSet = (mask & (1 << j)) > 0;
    const contribution = bitSet ? pps[j] : 0;
    ppsSum += contribution;
    console.log(`     Bit ${j}: ${bitSet ? '✓' : '✗'} ${bitSet ? 'SET' : 'not set'} → ${bitSet ? `add pps[${j}] = ${pps[j].toFixed(6)}` : 'add 0'}`);
  }

  const realizedPayout = ppsSum * netShares;
  const pnlGross = grossCf + realizedPayout;
  const pnlNet = grossCf - fees + realizedPayout;

  console.log(`\n   pps_sum: ${ppsSum.toFixed(6)}`);
  console.log(`   realized_payout: ${ppsSum.toFixed(6)} * ${netShares.toFixed(2)} = $${realizedPayout.toFixed(2)}`);
  console.log(`   pnl_gross: $${grossCf.toFixed(2)} + $${realizedPayout.toFixed(2)} = $${pnlGross.toFixed(2)}`);
  console.log(`   pnl_net: $${grossCf.toFixed(2)} - $${fees.toFixed(2)} + $${realizedPayout.toFixed(2)} = $${pnlNet.toFixed(2)}\n`);

  // Step 6: Compare to what wallet_condition_pnl returns
  console.log('Step 6: Compare to wallet_condition_pnl view');
  console.log('─'.repeat(60));
  const viewQuery = await clickhouse.query({
    query: `
      SELECT
        realized_payout,
        pnl_gross,
        pnl_net
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${wallet}')
        AND condition_id_ctf = '${ctfId}'
    `,
    format: 'JSONEachRow'
  });
  const viewResult = await viewQuery.json();

  if (viewResult.length > 0) {
    console.log(`   View realized_payout: $${Number(viewResult[0].realized_payout).toFixed(2)}`);
    console.log(`   View pnl_gross: $${Number(viewResult[0].pnl_gross).toFixed(2)}`);
    console.log(`   View pnl_net: $${Number(viewResult[0].pnl_net).toFixed(2)}\n`);

    const matches = Math.abs(Number(viewResult[0].pnl_net) - pnlNet) < 0.01;
    console.log(`   ${matches ? '✅ MATCH' : '❌ MISMATCH'}!\n`);
  } else {
    console.log('   ❌ Not found in wallet_condition_pnl view!\n');
  }
}

main().catch(console.error);
