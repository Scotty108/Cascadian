/**
 * Detailed debug script to trace V40 calculations for SPLIT_HEAVY
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba';
const FIFTY_CENTS = 0.5;

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

async function main() {
  console.log('═'.repeat(80));
  console.log('🔍 V40 Detailed Debug: SPLIT_HEAVY');
  console.log('═'.repeat(80));

  // 1. Get all CTF events
  const ctfQuery = `
    SELECT
      lower(condition_id) as condition_id,
      event_type,
      partition_index_sets,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      block_number
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND is_deleted = 0
    ORDER BY block_number ASC
  `;
  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as any[];
  console.log(`\nTotal CTF events: ${ctfRows.length}`);

  // 2. Get resolution prices
  const conditionIds = [...new Set(ctfRows.map(r => r.condition_id))];
  const idList = conditionIds.map(id => `'${id}'`).join(',');
  const resQuery = `
    SELECT lower(condition_id) as condition_id, norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (${idList}) AND is_deleted = 0
  `;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];
  const resolutions = new Map<string, number[]>();
  for (const row of resRows) {
    resolutions.set(row.condition_id, row.norm_prices);
  }
  console.log(`Conditions with resolutions: ${resolutions.size}`);

  // 3. Process events manually
  const positions = new Map<string, Position>();

  let splitCount = 0;
  let redemptionCount = 0;
  let totalRealizedPnl = 0;

  for (const event of ctfRows) {
    const conditionId = event.condition_id;
    const amount = event.amount;
    const resolution = resolutions.get(conditionId) || [0, 0];

    if (event.event_type === 'PositionSplit') {
      splitCount++;
      // Split creates positions in BOTH outcomes at $0.50
      const parsed = JSON.parse(event.partition_index_sets || '[]');
      for (const p of parsed) {
        const outcomeIndex = p - 1; // 1-indexed to 0-indexed
        if (outcomeIndex < 0) continue;

        const key = `${conditionId}_${outcomeIndex}`;
        let pos = positions.get(key);
        if (!pos) {
          pos = { amount: 0, avgPrice: 0, realizedPnl: 0 };
          positions.set(key, pos);
        }

        // BUY at $0.50
        const newAmount = pos.amount + amount;
        pos.avgPrice = (pos.avgPrice * pos.amount + FIFTY_CENTS * amount) / newAmount;
        pos.amount = newAmount;
      }
    } else if (event.event_type === 'PayoutRedemption') {
      redemptionCount++;
      const parsed = JSON.parse(event.partition_index_sets || '[]');

      for (const p of parsed) {
        const outcomeIndex = p - 1; // 1-indexed to 0-indexed
        if (outcomeIndex < 0) continue;

        const key = `${conditionId}_${outcomeIndex}`;
        let pos = positions.get(key);
        if (!pos) {
          pos = { amount: 0, avgPrice: 0, realizedPnl: 0 };
          positions.set(key, pos);
        }

        // SELL at resolution price
        const resolutionPrice = resolution[outcomeIndex] || 0;
        const sellAmount = Math.min(amount, pos.amount); // Cap to position

        if (sellAmount > 0) {
          const deltaPnl = sellAmount * (resolutionPrice - pos.avgPrice);
          pos.realizedPnl += deltaPnl;
          pos.amount -= sellAmount;
          totalRealizedPnl += deltaPnl;
        }
      }
    }
  }

  console.log(`\nProcessed: ${splitCount} splits, ${redemptionCount} redemptions`);
  console.log(`Total positions: ${positions.size}`);

  // 4. Calculate final metrics
  let unrealizedPnl = 0;
  let positionsWithBalance = 0;

  for (const [key, pos] of positions) {
    if (pos.amount > 0) {
      positionsWithBalance++;
      const [conditionId, outcomeStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeStr);
      const resolution = resolutions.get(conditionId);
      const resPrice = resolution ? resolution[outcomeIndex] : 0;
      const unrealized = pos.amount * (resPrice - pos.avgPrice);
      unrealizedPnl += unrealized;
    }
  }

  console.log(`\nPositions with remaining balance: ${positionsWithBalance}`);

  console.log('\n' + '═'.repeat(80));
  console.log('RESULTS');
  console.log('═'.repeat(80));
  console.log(`Total Realized PnL: $${totalRealizedPnl.toLocaleString()}`);
  console.log(`Total Unrealized PnL: $${unrealizedPnl.toLocaleString()}`);
  console.log(`Total PnL: $${(totalRealizedPnl + unrealizedPnl).toLocaleString()}`);
  console.log(`\nPolymarket shows: $48,509.59`);

  // 5. Sample some positions with non-zero PnL
  console.log('\n' + '═'.repeat(80));
  console.log('SAMPLE POSITIONS WITH BALANCE');
  console.log('═'.repeat(80));

  let count = 0;
  for (const [key, pos] of positions) {
    if (pos.amount > 0 && count < 5) {
      const [conditionId, outcomeStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeStr);
      const resolution = resolutions.get(conditionId);
      const resPrice = resolution ? resolution[outcomeIndex] : 0;
      console.log(`\n${key.slice(0, 20)}...:`);
      console.log(`  Amount: ${pos.amount.toLocaleString()}`);
      console.log(`  AvgPrice: $${pos.avgPrice.toFixed(4)}`);
      console.log(`  ResPrice: $${resPrice}`);
      console.log(`  Realized: $${pos.realizedPnl.toLocaleString()}`);
      console.log(`  Unrealized: $${(pos.amount * (resPrice - pos.avgPrice)).toLocaleString()}`);
      count++;
    }
  }
}

main().catch(console.error);
