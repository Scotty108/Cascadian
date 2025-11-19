import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface Fill {
  condition_id: string;
  asset_id: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;  // Raw units, needs / 1e6
  fee_rate_bps: number;
  timestamp: string;
}

interface Position {
  qty: number;       // Current position size (can be negative for short)
  avg_cost: number;  // Average cost basis
  realized_pnl: number;  // Cumulative realized P&L
}

/**
 * Calculate realized P&L using average cost method
 *
 * Algorithm:
 * - For each condition_id + asset_id, maintain position and avg_cost
 * - On BUY: new_avg_cost = (pos*avg_cost + qty*price) / (pos+qty), pos += qty
 * - On SELL: realized += qty*(price - avg_cost), pos -= qty
 * - Supports shorting (position can cross zero)
 * - Fees subtracted from realized P&L
 */
function calculateRealizedPnL(fills: Fill[]): Map<string, Position> {
  const positions = new Map<string, Position>();

  // Sort by timestamp
  const sortedFills = [...fills].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const fill of sortedFills) {
    const key = `${fill.condition_id}_${fill.asset_id}`;

    // Normalize size (convert from token units to shares)
    const qty = fill.size / 1e6;
    const price = fill.price;
    const fee = (qty * price * fill.fee_rate_bps) / 10000;

    // Get or create position
    let pos = positions.get(key);
    if (!pos) {
      pos = { qty: 0, avg_cost: 0, realized_pnl: 0 };
      positions.set(key, pos);
    }

    if (fill.side === 'BUY') {
      // Opening or adding to long position
      if (pos.qty >= 0) {
        // Adding to long
        pos.avg_cost = pos.qty === 0
          ? price
          : (pos.qty * pos.avg_cost + qty * price) / (pos.qty + qty);
        pos.qty += qty;
      } else {
        // Closing short position
        const closing_qty = Math.min(qty, Math.abs(pos.qty));
        pos.realized_pnl += closing_qty * (pos.avg_cost - price);
        pos.qty += qty;

        // If we flipped to long, set new avg_cost
        if (pos.qty > 0) {
          pos.avg_cost = price;
        }
      }

      // Subtract fee
      pos.realized_pnl -= fee;

    } else {  // SELL
      // Closing or shorting
      if (pos.qty > 0) {
        // Closing long position
        const closing_qty = Math.min(qty, pos.qty);
        pos.realized_pnl += closing_qty * (price - pos.avg_cost);
        pos.qty -= qty;

        // If we flipped to short, set new avg_cost
        if (pos.qty < 0) {
          pos.avg_cost = price;
        }
      } else {
        // Adding to short or initiating short
        pos.avg_cost = pos.qty === 0
          ? price
          : (Math.abs(pos.qty) * pos.avg_cost + qty * price) / (Math.abs(pos.qty) + qty);
        pos.qty -= qty;
      }

      // Subtract fee
      pos.realized_pnl -= fee;
    }
  }

  return positions;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CALCULATE REALIZED P&L FROM FILLS (AVERAGE COST METHOD)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${WALLET}\n`);

  console.log('Step 1: Fetching all fills from clob_fills...\n');

  const fillsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        asset_id,
        side,
        price,
        size,
        fee_rate_bps,
        timestamp
      FROM default.clob_fills
      WHERE lower(proxy_wallet) = lower('${WALLET}')
        OR lower(user_eoa) = lower('${WALLET}')
      ORDER BY timestamp ASC
    `,
    format: 'JSONEachRow'
  });

  const fills: Fill[] = await fillsQuery.json();

  console.log(`   Fetched ${fills.length} fills\n`);

  console.log('Step 2: Calculating realized P&L with average cost basis...\n');

  const positions = calculateRealizedPnL(fills);

  console.log(`   Processed ${positions.size} unique positions\n`);

  console.log('Step 3: Aggregating results...\n');

  let totalRealizedPnL = 0;
  let totalOpenPositionValue = 0;
  let closedPositions = 0;
  let openPositions = 0;

  positions.forEach((pos, key) => {
    totalRealizedPnL += pos.realized_pnl;

    if (Math.abs(pos.qty) < 0.01) {  // Closed (within rounding)
      closedPositions++;
    } else {  // Open
      openPositions++;
      // Mark-to-market value would be: pos.qty * current_price
      // But we don't have current prices, so we use avg_cost as estimate
      totalOpenPositionValue += pos.qty * pos.avg_cost;
    }
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total Realized P&L: $${totalRealizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

  console.log('Position breakdown:');
  console.log(`   Closed positions: ${closedPositions}`);
  console.log(`   Open positions: ${openPositions}`);
  console.log(`   Open position value (at avg cost): $${totalOpenPositionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const currentReported = 23426;
  const duneValue = 80000;  // Approximate

  console.log(`   Current system: $${currentReported.toLocaleString()}`);
  console.log(`   Dune reported: ~$${duneValue.toLocaleString()}`);
  console.log(`   Our calculation: $${Math.round(totalRealizedPnL).toLocaleString()}\n`);

  const gapToDune = duneValue - totalRealizedPnL;
  const gapToCurrent = totalRealizedPnL - currentReported;

  console.log(`   Gap to Dune: $${Math.round(gapToDune).toLocaleString()}`);
  console.log(`   Gap to current: $${Math.round(gapToCurrent).toLocaleString()}\n`);

  if (Math.abs(gapToDune) < 5000) {
    console.log('✅ Close match to Dune! Our calculation is accurate.\n');
  } else if (gapToDune > 0) {
    console.log('⚠️  Still below Dune - possible causes:');
    console.log('   1. Missing fills in clob_fills table');
    console.log('   2. Different cost basis method (Dune uses FIFO?)');
    console.log('   3. Fee treatment differences');
    console.log('   4. Time window mismatch\n');
  } else {
    console.log('⚠️  Above Dune - check for double-counting or fee errors\n');
  }

  // Save detailed breakdown
  console.log('Step 4: Saving detailed position breakdown...\n');

  const breakdown: any[] = [];
  positions.forEach((pos, key) => {
    const [condition_id, asset_id] = key.split('_');
    breakdown.push({
      condition_id,
      asset_id: asset_id.substring(0, 20) + '...',
      position_qty: pos.qty,
      avg_cost: pos.avg_cost,
      realized_pnl: pos.realized_pnl,
      status: Math.abs(pos.qty) < 0.01 ? 'CLOSED' : 'OPEN'
    });
  });

  // Sort by realized P&L
  breakdown.sort((a, b) => b.realized_pnl - a.realized_pnl);

  const fs = require('fs');
  fs.writeFileSync(
    'realized-pnl-breakdown.json',
    JSON.stringify({
      wallet: WALLET,
      calculated_at: new Date().toISOString(),
      total_realized_pnl: totalRealizedPnL,
      total_fills: fills.length,
      closed_positions: closedPositions,
      open_positions: openPositions,
      positions: breakdown
    }, null, 2)
  );

  console.log('   Saved to realized-pnl-breakdown.json\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
