import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('REDEMPTION P&L ANALYSIS (WITH CORRECT TOKEN DECODING)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Using CORRECT CTF token decoding formula:');
  console.log('   condition_id = token_id >> 8 (bitwise right shift)');
  console.log('   outcome_index = token_id & 255 (bitwise AND)\n');

  // Get all redemptions with CORRECT decoding
  const redemptionsQuery = await clickhouse.query({
    query: `
      WITH burns AS (
        SELECT
          token_id,
          reinterpretAsUInt256(reverse(unhex(substring(value, 3)))) as amount,
          block_timestamp
        FROM default.erc1155_transfers
        WHERE from_address = lower('${WALLET}')
          AND to_address = '0x0000000000000000000000000000000000000000'
      ),
      decoded AS (
        SELECT
          token_id,
          amount,
          block_timestamp,
          lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))) as condition_id_norm,
          toUInt8(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 255)) as outcome_index
        FROM burns
      )
      SELECT
        d.token_id,
        d.amount,
        d.block_timestamp,
        d.condition_id_norm,
        d.outcome_index,
        r.winning_index,
        r.resolved_at,
        CASE
          WHEN r.winning_index = d.outcome_index THEN toFloat64(d.amount) * 1.0
          ELSE 0
        END as redemption_value
      FROM decoded d
      LEFT JOIN default.market_resolutions_final r
        ON d.condition_id_norm = r.condition_id_norm
      ORDER BY d.block_timestamp DESC
    `,
    format: 'JSONEachRow'
  });

  const redemptions: any[] = await redemptionsQuery.json();

  console.log(`Found ${redemptions.length} redemptions\n`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('REDEMPTION DETAILS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let totalRedemptionValue = 0;
  let totalCost = 0;
  let resolvedCount = 0;
  let wonCount = 0;
  let lostCount = 0;

  for (const redemption of redemptions) {
    console.log(`Redemption at ${redemption.block_timestamp}:`);
    console.log(`   Token: ${redemption.token_id.substring(0, 30)}...`);
    console.log(`   Amount: ${redemption.amount.toLocaleString()}`);
    console.log(`   Condition ID: ${redemption.condition_id_norm.substring(0, 30)}...`);
    console.log(`   Outcome: ${redemption.outcome_index}`);

    if (redemption.winning_index !== null && redemption.winning_index !== undefined) {
      resolvedCount++;
      const won = redemption.winning_index === redemption.outcome_index;
      const redemptionValue = parseFloat(redemption.redemption_value);

      if (won) {
        wonCount++;
        console.log(`   ✅ WON - Winning outcome: ${redemption.winning_index}`);
      } else {
        lostCount++;
        console.log(`   ❌ LOST - Winning outcome: ${redemption.winning_index}`);
      }

      console.log(`   Redemption value: $${redemptionValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      totalRedemptionValue += redemptionValue;

      // Get cost basis from clob_fills
      const costQuery = await clickhouse.query({
        query: `
          SELECT
            SUM(price * size) as total_cost
          FROM default.clob_fills
          WHERE lower(proxy_wallet) = lower('${WALLET}')
            AND lower(hex(bitShiftRight(toUInt256(asset_id), 8))) = '${redemption.condition_id_norm}'
            AND toUInt8(bitAnd(toUInt256(asset_id), 255)) = ${redemption.outcome_index}
            AND side = 'BUY'
        `,
        format: 'JSONEachRow'
      });

      const costResult = await costQuery.json();
      const cost = costResult.length > 0 && costResult[0].total_cost ? parseFloat(costResult[0].total_cost) : 0;
      totalCost += cost;

      console.log(`   Cost basis: $${cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`   P&L: ${redemptionValue - cost >= 0 ? '+' : ''}$${(redemptionValue - cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
    } else {
      console.log(`   ⚠️  Market not resolved (missing in market_resolutions_final)\n`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total redemptions: ${redemptions.length}`);
  console.log(`   With resolution data: ${resolvedCount} (${(resolvedCount / redemptions.length * 100).toFixed(1)}%)`);
  console.log(`   Won: ${wonCount}`);
  console.log(`   Lost: ${lostCount}`);
  console.log(`   Missing resolution: ${redemptions.length - resolvedCount}\n`);

  const bucket2PnL = totalRedemptionValue - totalCost;

  console.log(`Total cost basis: $${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total redemption value: $${totalRedemptionValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`BUCKET 2 P&L: ${bucket2PnL >= 0 ? '+' : ''}$${bucket2PnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  if (resolvedCount > 0) {
    const avgWinRate = wonCount / resolvedCount * 100;
    console.log(`Win rate: ${avgWinRate.toFixed(1)}%`);
    console.log(`Avg P&L per redemption: $${(bucket2PnL / resolvedCount).toFixed(2)}\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO DUNE ($80K)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Dune reported: ~$80,000`);
  console.log(`Our Bucket 2 P&L: $${Math.round(bucket2PnL).toLocaleString()}`);
  console.log(`Difference: $${Math.abs(80000 - bucket2PnL).toLocaleString()}\n`);

  if (resolvedCount < redemptions.length) {
    console.log('⚠️  INCOMPLETE DATA:');
    console.log(`   Missing resolution data for ${redemptions.length - resolvedCount} redemptions`);
    console.log(`   This ${resolvedCount === 0 ? 'completely' : 'partially'} explains the gap\n`);
  }

  if (Math.abs(bucket2PnL - 80000) < 10000) {
    console.log('✅ MATCH! Redemption P&L matches Dune!');
  } else if (Math.abs(bucket2PnL - 80000) < 30000) {
    console.log('🟡 CLOSE - Within $30K of Dune');
  } else {
    console.log('💡 NEXT STEPS:');
    console.log('   1. Backfill missing resolution data');
    console.log('   2. Check gamma_markets for resolution info');
    console.log('   3. Query Polymarket API for market outcomes');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
