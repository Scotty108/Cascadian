import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Decode CTF token_id
function decodeTokenId(tokenId: string): { conditionId: string; outcomeIndex: number } | null {
  try {
    let hex = tokenId.startsWith('0x') ? tokenId.slice(2) : tokenId;
    hex = hex.padStart(64, '0');

    const lastByte = hex.slice(-2);
    const outcomeIndex = parseInt(lastByte, 16);
    const conditionId = hex.slice(0, 62) + '00';

    return { conditionId, outcomeIndex };
  } catch (error) {
    console.error(`Failed to decode token_id: ${tokenId}`, error);
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('BUCKET 2: REDEMPTIONS (Burns to 0x000...000)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Methodology:');
  console.log('   1. Find all ERC-1155 burns (transfers to 0x000...000)');
  console.log('   2. Check if burned tokens were from resolved markets');
  console.log('   3. If winning outcome, value at $1/share');
  console.log('   4. Calculate P&L: redemption_value - original_cost\n');

  // Get all burns
  const burnsQuery = await clickhouse.query({
    query: `
      SELECT
        token_id,
        reinterpretAsUInt256(reverse(unhex(substring(value, 3)))) as amount,
        block_timestamp
      FROM default.erc1155_transfers
      WHERE from_address = lower('${WALLET}')
        AND to_address = '0x0000000000000000000000000000000000000000'
      ORDER BY block_timestamp DESC
    `,
    format: 'JSONEachRow'
  });

  const burns: any[] = await burnsQuery.json();
  console.log(`Found ${burns.length} redemptions (burns)\n`);

  let totalRedemptionValue = 0;
  let totalCost = 0;
  let wonRedemptions = 0;
  let lostRedemptions = 0;

  for (const burn of burns) {
    const decoded = decodeTokenId(burn.token_id);
    if (!decoded) continue;

    console.log(`Redemption at ${burn.block_timestamp}:`);
    console.log(`   Token: ${burn.token_id.substring(0, 30)}...`);
    console.log(`   Amount burned: ${burn.amount}`);
    console.log(`   Condition: ${decoded.conditionId.substring(0, 30)}...`);
    console.log(`   Outcome: ${decoded.outcomeIndex}`);

    // Check if market resolved
    const resolutionQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          resolved_at
        FROM default.market_resolutions_final
        WHERE condition_id_norm = '${decoded.conditionId}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const resolutions = await resolutionQuery.json();

    if (resolutions.length > 0) {
      const resolution = resolutions[0];
      const won = resolution.winning_index === decoded.outcomeIndex;
      const redemptionValue = won ? parseInt(burn.amount.toString()) * 1.0 : 0;

      console.log(`   Resolution: ${won ? '✅ WON' : '❌ LOST'}`);
      console.log(`   Winning outcome: ${resolution.winning_index}`);
      console.log(`   Redemption value: $${redemptionValue.toFixed(2)}`);

      if (won) wonRedemptions++;
      else lostRedemptions++;

      totalRedemptionValue += redemptionValue;

      // Get cost basis
      const costQuery = await clickhouse.query({
        query: `
          SELECT
            SUM(price * size) as total_cost
          FROM default.clob_fills
          WHERE lower(proxy_wallet) = lower('${WALLET}')
            AND lower(condition_id) = lower('${decoded.conditionId}')
            AND side = 'BUY'
        `,
        format: 'JSONEachRow'
      });

      const costResult = await costQuery.json();
      const cost = costResult.length > 0 ? parseFloat(costResult[0].total_cost || '0') : 0;
      totalCost += cost;

      console.log(`   Cost basis: $${cost.toFixed(2)}`);
      console.log(`   P&L: ${redemptionValue - cost >= 0 ? '+' : ''}$${(redemptionValue - cost).toFixed(2)}\n`);
    } else {
      console.log(`   ⚠️  Market not resolved (shouldn't happen for redeemed tokens)\n`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('BUCKET 2 SUMMARY: REDEMPTIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total redemptions: ${burns.length}`);
  console.log(`   Won: ${wonRedemptions}`);
  console.log(`   Lost: ${lostRedemptions}\n`);

  const bucket2PnL = totalRedemptionValue - totalCost;

  console.log(`Total cost (from CLOB fills): $${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total redemption value: $${totalRedemptionValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Bucket 2 P&L: ${bucket2PnL >= 0 ? '+' : ''}$${bucket2PnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO DUNE ($80K)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Dune reported: ~$80,000`);
  console.log(`Our Bucket 2 P&L: $${Math.round(bucket2PnL).toLocaleString()}`);
  console.log(`Difference: $${Math.abs(80000 - bucket2PnL).toLocaleString()}\n`);

  if (Math.abs(bucket2PnL - 80000) < 10000) {
    console.log('✅ MATCH! Redemption P&L matches Dune\'s $80K!');
  } else if (Math.abs(bucket2PnL - 80000) < 30000) {
    console.log('🟡 CLOSE! Redemption P&L is within $30K of Dune');
  } else {
    console.log('❌ Still significant gap');
    console.log('   Redemptions alone don\'t explain the full $80K');
    console.log('   Need to combine with other P&L sources\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
