#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// Top market from per-market analysis
const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';
const CONDITION_ID = process.argv[2] || 'bc4a8b1cc876330d5a2c64c56c13c53e7e7f08a1976fbe4bd3bb1d2f55dc3c00';

interface Trade {
  timestamp: string;
  direction: string;
  shares: number;
  price: number;
  usd_value: number;
}

function calculateFIFOPnL(trades: Trade[]) {
  let inventory: Array<{shares: number, cost_basis: number}> = [];
  let realized_pnl = 0;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TRADE-BY-TRADE FIFO CALCULATION:');
  console.log('═══════════════════════════════════════════════════════════════\n');

  trades.forEach((trade, idx) => {
    const timestamp = new Date(trade.timestamp).toISOString().substring(0, 19);
    const shares = trade.shares;
    const price = trade.price;

    if (trade.direction === 'BUY') {
      inventory.push({ shares, cost_basis: price });
      console.log(`[${idx + 1}] ${timestamp} BUY  ${shares.toFixed(2).padStart(10)} @ $${price.toFixed(4)} | Inventory: ${inventory.reduce((s, i) => s + i.shares, 0).toFixed(2)} shares`);
    } else {
      // SELL - realize P&L using FIFO
      let remaining = shares;
      let trade_pnl = 0;

      while (remaining > 0 && inventory.length > 0) {
        const lot = inventory[0];
        const sold = Math.min(remaining, lot.shares);
        const pnl = sold * (price - lot.cost_basis);

        trade_pnl += pnl;
        remaining -= sold;
        lot.shares -= sold;

        if (lot.shares === 0) {
          inventory.shift();
        }
      }

      realized_pnl += trade_pnl;
      console.log(`[${idx + 1}] ${timestamp} SELL ${shares.toFixed(2).padStart(10)} @ $${price.toFixed(4)} | Realized P&L: $${trade_pnl.toFixed(2).padStart(10)} | Total: $${realized_pnl.toFixed(2)} | Inventory: ${inventory.reduce((s, i) => s + i.shares, 0).toFixed(2)} shares`);
    }
  });

  const final_inventory = inventory.reduce((s, i) => s + i.shares, 0);
  const final_cost = inventory.reduce((s, i) => s + (i.shares * i.cost_basis), 0);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('FINAL RESULTS:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Realized P&L:      $${realized_pnl.toFixed(2)}`);
  console.log(`  Unrealized Shares: ${final_inventory.toFixed(2)}`);
  console.log(`  Unrealized Cost:   $${final_cost.toFixed(2)}`);
  console.log(`  (At settlement, if shares held, add payout value)`)
  console.log();

  return { realized_pnl, final_inventory, final_cost };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SINGLE-MARKET FIFO P&L CALCULATOR');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Wallet:       ${WALLET.substring(0, 16)}...`);
  console.log(`Condition ID: ${CONDITION_ID.substring(0, 16)}...`);
  console.log();

  // Fetch all trades for this market, ordered by time
  const result = await clickhouse.query({
    query: `
      SELECT
        timestamp,
        trade_direction,
        toFloat64(shares) AS shares,
        toFloat64(price) AS price,
        toFloat64(usd_value) AS usd_value
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND condition_id_norm_v3 = '${CONDITION_ID}'
      ORDER BY timestamp ASC
    `,
    format: 'JSONEachRow'
  });

  const trades = await result.json<Array<any>>();

  console.log(`Found ${trades.length} trades`);

  // Simple aggregation (current method)
  const totalBuy = trades.filter(t => t.trade_direction === 'BUY').reduce((s, t) => s + t.usd_value, 0);
  const totalSell = trades.filter(t => t.trade_direction === 'SELL').reduce((s, t) => s + t.usd_value, 0);
  const simplePnL = totalSell - totalBuy;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CURRENT METHOD (Simple Aggregation):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Buy:   $${totalBuy.toFixed(2)}`);
  console.log(`  Total Sell:  $${totalSell.toFixed(2)}`);
  console.log(`  P&L:         $${simplePnL.toFixed(2)}`);

  // FIFO calculation
  const fifo = calculateFIFOPnL(trades.map(t => ({
    timestamp: t.timestamp,
    direction: t.trade_direction,
    shares: parseFloat(t.shares),
    price: parseFloat(t.price),
    usd_value: parseFloat(t.usd_value)
  })));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Simple Method:  $${simplePnL.toFixed(2)}`);
  console.log(`  FIFO Method:    $${fifo.realized_pnl.toFixed(2)}`);
  console.log(`  Difference:     $${(simplePnL - fifo.realized_pnl).toFixed(2)}`);
  console.log();

  if (Math.abs(simplePnL - fifo.realized_pnl) < 1) {
    console.log('✅ Methods match - simple aggregation works for this market');
  } else {
    console.log('❌ Methods differ - FIFO changes the P&L');
    console.log('   This suggests Polymarket may use FIFO or average-cost method');
  }
}

main().catch(console.error);
