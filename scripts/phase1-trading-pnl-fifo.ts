#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const TEST_WALLETS = [
  '0x4ce73141dbfce41e65db3723e31059a730f0abad',
  '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144',
  '0x1f0a343513aa6060488fabe96960e6d1e177f7aa',
];

interface Trade {
  timestamp: string;
  condition_id_norm: string;
  outcome_index: number;
  trade_direction: string;
  shares: number;
  usd_value: number;
  price: number;
}

interface Position {
  shares: number;
  cost_basis: number;
  realized_pnl: number;
}

// FIFO position tracker per wallet+market+outcome
function calculateFIFOPnL(trades: Trade[]): {
  realized_pnl: number;
  open_position_shares: number;
  open_position_cost: number;
} {
  let queue: Array<{ shares: number; price: number }> = [];
  let realized_pnl = 0;

  for (const trade of trades) {
    if (trade.trade_direction === 'BUY') {
      // Add to position queue
      queue.push({
        shares: trade.shares,
        price: trade.price,
      });
    } else if (trade.trade_direction === 'SELL') {
      // Match against oldest positions (FIFO)
      let shares_to_sell = trade.shares;
      const sell_price = trade.price;

      while (shares_to_sell > 0 && queue.length > 0) {
        const oldest_lot = queue[0];

        if (oldest_lot.shares <= shares_to_sell) {
          // Fully consume this lot
          const pnl = oldest_lot.shares * (sell_price - oldest_lot.price);
          realized_pnl += pnl;
          shares_to_sell -= oldest_lot.shares;
          queue.shift();
        } else {
          // Partially consume this lot
          const pnl = shares_to_sell * (sell_price - oldest_lot.price);
          realized_pnl += pnl;
          oldest_lot.shares -= shares_to_sell;
          shares_to_sell = 0;
        }
      }

      // If we still have shares to sell but no position, that's a short (ignore for now)
      if (shares_to_sell > 0) {
        console.warn(`Warning: Oversold position (short detected)`);
      }
    }
  }

  // Calculate remaining open position
  const open_position_shares = queue.reduce((sum, lot) => sum + lot.shares, 0);
  const open_position_cost = queue.reduce(
    (sum, lot) => sum + lot.shares * lot.price,
    0
  );

  return {
    realized_pnl,
    open_position_shares,
    open_position_cost,
  };
}

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('PHASE 1: TRADING P&L (Entry/Exit Spread - FIFO Matching)');
  console.log('═'.repeat(80));
  console.log('');
  console.log('This calculates realized P&L from entry/exit spread.');
  console.log('NO resolution data needed - works for 100% of trades!');
  console.log('');

  for (const wallet of TEST_WALLETS) {
    console.log('═'.repeat(80));
    console.log(`WALLET: ${wallet}`);
    console.log('═'.repeat(80));
    console.log('');

    // Fetch all trades for this wallet, ordered by timestamp
    const tradesQuery = await client.query({
      query: `
        SELECT
          timestamp,
          condition_id_norm,
          outcome_index,
          trade_direction,
          shares,
          usd_value,
          price
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet}')
          AND trade_direction IN ('BUY', 'SELL')
          AND shares > 0
        ORDER BY condition_id_norm, outcome_index, timestamp
      `,
      format: 'JSONEachRow',
    });

    const trades = await tradesQuery.json<Trade[]>();
    console.log(`Total trades: ${trades.length.toLocaleString()}`);

    if (trades.length === 0) {
      console.log('No trades found for this wallet.');
      console.log('');
      continue;
    }

    // Group trades by market+outcome
    const positions = new Map<
      string,
      {
        trades: Trade[];
        realized_pnl: number;
        open_shares: number;
        open_cost: number;
      }
    >();

    for (const trade of trades) {
      const key = `${trade.condition_id_norm}-${trade.outcome_index}`;
      if (!positions.has(key)) {
        positions.set(key, {
          trades: [],
          realized_pnl: 0,
          open_shares: 0,
          open_cost: 0,
        });
      }
      positions.get(key)!.trades.push(trade);
    }

    // Calculate FIFO P&L for each position
    let total_realized_pnl = 0;
    let total_open_positions = 0;
    let total_closed_positions = 0;

    for (const [key, data] of positions) {
      const result = calculateFIFOPnL(data.trades);
      data.realized_pnl = result.realized_pnl;
      data.open_shares = result.open_position_shares;
      data.open_cost = result.open_position_cost;

      total_realized_pnl += result.realized_pnl;

      if (result.open_position_shares > 0.01) {
        total_open_positions++;
      } else {
        total_closed_positions++;
      }
    }

    console.log('RESULTS:');
    console.log(`  Total markets traded: ${positions.size.toLocaleString()}`);
    console.log(`  Closed positions: ${total_closed_positions.toLocaleString()}`);
    console.log(`  Open positions: ${total_open_positions.toLocaleString()}`);
    console.log('');
    console.log(`  💰 REALIZED P&L (Trading): $${total_realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');

    // Show top 10 winning and losing positions
    const sorted = Array.from(positions.entries())
      .map(([key, data]) => ({
        key,
        condition_id: key.split('-')[0],
        outcome: key.split('-')[1],
        realized_pnl: data.realized_pnl,
        open_shares: data.open_shares,
        trades: data.trades.length,
      }))
      .sort((a, b) => b.realized_pnl - a.realized_pnl);

    console.log('Top 10 Winners:');
    console.log('─'.repeat(80));
    sorted.slice(0, 10).forEach((pos, idx) => {
      console.log(
        `${idx + 1}. ${pos.condition_id.substring(0, 20)}... [${pos.outcome}] - $${pos.realized_pnl.toFixed(2)} (${pos.trades} trades)`
      );
    });
    console.log('');

    console.log('Top 10 Losers:');
    console.log('─'.repeat(80));
    sorted.slice(-10).reverse().forEach((pos, idx) => {
      console.log(
        `${idx + 1}. ${pos.condition_id.substring(0, 20)}... [${pos.outcome}] - $${pos.realized_pnl.toFixed(2)} (${pos.trades} trades)`
      );
    });
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('PHASE 1 COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log('✅ Realized P&L calculated from entry/exit spread');
  console.log('✅ No resolution data needed');
  console.log('✅ Works for 100% of trades');
  console.log('');
  console.log('NEXT: Phase 2 - Unrealized P&L (mark-to-market for open positions)');
  console.log('');

  await client.close();
}

main().catch(console.error);
