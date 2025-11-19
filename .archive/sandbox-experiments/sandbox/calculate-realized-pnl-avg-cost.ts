import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

export async function calculateRealizedPnLAvgCost(): Promise<void> {
  console.log('💰 Calculating realized P&L using average cost method...');

  try {
    // Step 1: Load all trades for the wallet, ordered by trade time
    console.log('\nStep 1: Loading all trades for wallet...');
    const tradesQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_64,
          outcome_idx,
          side,
          qty,
          px,
          fee,
          timestamp,
          mapping_source,
          market_slug
        FROM sandbox.fills_norm_fixed_v2
        WHERE wallet = '${WALLET}'
          AND condition_id_64 != ''  -- Only include mapped trades
        ORDER BY condition_id_64, outcome_idx, timestamp, tx_hash
      `,
      format: 'JSONEachRow'
    });
    const trades: any[] = await tradesQuery.json();

    console.log(`Loaded ${trades.length} mapped trades`);

    // Group by condition + outcome
    const positionsByMarket = new Map<string, any[]>();
    trades.forEach(trade => {
      const key = `${trade.condition_id_64}:${trade.outcome_idx}`;
      if (!positionsByMarket.has(key)) {
        positionsByMarket.set(key, []);
      }
      positionsByMarket.get(key)!.push(trade);
    });

    console.log(`Processing ${positionsByMarket.size} unique market/outcome combinations`);

    // Step 2: Create results table
    console.log('\nStep 2: Creating results table...');
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS sandbox.realized_pnl_by_market_v2 (
          wallet String,
          condition_id_64 String,
          outcome_idx Int32,
          realized_trade_pnl Float64,
          fees Float64,
          trades UInt32,
          total_closing_qty Float64,
          avg_buy_price Float64,
          avg_sell_price Float64,
          position_remaining Float64,
          start_timestamp DateTime,
          end_timestamp DateTime,
          algo String DEFAULT 'avg_cost_v2',
          market_slug Nullable(String)
        )
        ENGINE = ReplacingMergeTree()
        ORDER BY (wallet, condition_id_64, outcome_idx)
        SETTINGS index_granularity = 8192
      `,
      format: 'JSONEachRow'
    });

    // Step 3: Calculate P&L for each market
    console.log('\nStep 3: Calculating P&L per market...');
    let totalResults = 0;
    let totalRealizedPnl = 0;
    let totalFees = 0;

    for (const [key, trades] of positionsByMarket.entries()) {
      const [condition_id_64, outcome_idx_str] = key.split(':');
      const outcome_idx = parseInt(outcome_idx_str);

      if (trades.length === 0) continue;

      console.log(`\nProcessing ${key} (${trades.length} trades)`);

      let total_fees = 0;
      let total_closing_qty = 0;
      let buy_trades = 0;
      let sell_trades = 0;
      let total_buy_value = 0;
      let total_sell_value = 0;
      let avg_buy_px = 0;
      let avg_sell_px = 0;
      let position_qty = 0;
      let avg_cost = 0;
      let realized_pnl = 0;
      let start_date = new Date(trades[0].timestamp);
      let end_date = new Date(trades[trades.length - 1].timestamp);

      // Process each trade in sequence
      for (let i = 0; i < trades.length; i++) {
        const trade = trades[i];

        // Convert side to numeric quantity multiplier
        const trade_sign = trade.side.toLowerCase() === 'buy' ? 1 : -1;
        const trade_qty = trade.qty * trade_sign;

        // Track all trades for buy/sell statistics
        if (trade.side.toLowerCase() === 'buy') {
          buy_trades++;
          total_buy_value += trade.qty * trade.px;
        } else {
          sell_trades++;
          total_sell_value += trade.qty * trade.px;
        }

        // Subtract fee from realized P&L
        total_fees += trade.fee;
        realized_pnl -= trade.fee;

        // Update position using average cost method
        if (position_qty === 0) {
          // Empty position - just add the new position
          position_qty = trade_qty;
          avg_cost = trade.px;
        } else if (Math.sign(position_qty) === Math.sign(trade_qty)) {
          // Adding to existing position - calculate new average cost
          const total_cost = (position_qty * avg_cost) + (trade_qty * trade.px);
          const total_qty = position_qty + trade_qty;
          avg_cost = total_cost / total_qty;
          position_qty = total_qty;
        } else {
          // Reducing or reversing position
          if (Math.abs(position_qty) >= Math.abs(trade_qty)) {
            // Reducing position size
            const closing_qty = Math.abs(trade_qty);
            total_closing_qty += closing_qty;

            // Calculate realized P&L
            const pnl_on_close = closing_qty * (trade.px - avg_cost) * Math.sign(trade_qty);
            realized_pnl += pnl_on_close;

            // Update position quantity
            position_qty += trade_qty;
          } else {
            // Reversing position - closing existing and opening opposite
            const closing_qty = Math.abs(position_qty);
            total_closing_qty += closing_qty;

            // Realize P&L on existing position
            const realized_on_complete_close = closing_qty * (trade.px - avg_cost) * Math.sign(position_qty);
            realized_pnl += realized_on_complete_close;

            // Now open position in opposite direction
            const remaining_qty = trade_qty + position_qty;
            position_qty = remaining_qty;
            avg_cost = trade.px;
          }
        }
      }

      // Calculate final buy/sell average prices
      if (buy_trades > 0) avg_buy_px = total_buy_value / buy_trades;
      if (sell_trades > 0) avg_sell_px = total_sell_value / sell_trades;

      // Save result
      totalResults++;
      totalRealizedPnl += realized_pnl;
      totalFees += total_fees;

      // Insert into database
      await clickhouse.query({
        query: `
          INSERT INTO sandbox.realized_pnl_by_market_v2 (
            wallet, condition_id_64, outcome_idx, realized_trade_pnl,
            fees, trades, total_closing_qty, avg_buy_price, avg_sell_price,
            position_remaining, start_timestamp, end_timestamp, algo,
            market_slug
          ) VALUES (
            '${WALLET}',
            '${condition_id_64}',
            ${outcome_idx},
            ${realized_pnl},
            ${total_fees},
            ${trades.length},
            ${total_closing_qty},
            ${avg_buy_px || 0},
            ${avg_sell_px || 0},
            ${position_qty},
            '${start_date.toISOString()}',
            '${end_date.toISOString()}',
            'avg_cost_v2',
            '${trades[0].market_slug || ''}'
          )
        `,
        format: 'JSONEachRow'
      });

      console.log(`  Result: realized_pnl=$${realized_pnl.toFixed(4)}, fees=$${total_fees.toFixed(4)}`);
      console.log(`  Buy avg: $${avg_buy_px.toFixed(3)}, Sell avg: $${avg_sell_px.toFixed(3)}`);
      console.log(`  Position remaining: ${position_qty} shares`);
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('🎯 REALIZED P&L CALCULATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total markets processed: ${totalResults}`);
    console.log(`Total realized P&L: $${totalRealizedPnl.toFixed(4)}`);
    console.log(`Total fees paid: $${totalFees.toFixed(4)}`);
    console.log(`Net after fees: $${(totalRealizedPnl - totalFees).toFixed(4)}`);

    // Show top performers/losers
    const summaryQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_64,
          outcome_idx,
          market_slug,
          realized_trade_pnl,
          fees,
          trades,
          total_closing_qty,
          position_remaining
        FROM sandbox.realized_pnl_by_market_v2
        WHERE wallet = '${WALLET}'
        ORDER BY realized_trade_pnl DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const summaryData = await summaryQuery.json();

    console.log('\n📈 Top performing markets:');
    summaryData.forEach((row: any, idx: number) => {
      const slug = row.market_slug || 'unknown';
      console.log(`  #${idx + 1}: ${slug.slice(0, 20)}... → +$${row.realized_trade_pnl.toFixed(4)} ` +
                  `(${row.trades} trades, ${row.total_closing_qty} closed)`);
    });

    const negativeQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_64,
          outcome_idx,
          market_slug,
          realized_trade_pnl,
          fees,
          trades,
          total_closing_qty,
          position_remaining
        FROM sandbox.realized_pnl_by_market_v2
        WHERE wallet = '${WALLET}' AND realized_trade_pnl < 0
        ORDER BY realized_trade_pnl ASC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const negativeData = await negativeQuery.json();

    if (negativeData.length > 0) {
      console.log('\n📉 Negative P&L markets:');
      negativeData.forEach((row: any) => {
        const slug = row.market_slug || 'unknown';
        console.log(`    ${slug.slice(0, 20)}... → -$${Math.abs(row.realized_trade_pnl).toFixed(4)} ` +
                    `(${row.trades} trades, ${row.total_closing_qty} closed)`);
      });
    }

    console.log('\n✅ P&L calculation complete!');
    console.log(`🔍 Save data to sandbox.realized_pnl_by_market_v2 table`);

  } catch (error) {
    console.error('❌ P&L calculation failed:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  calculateRealizedPnLAvgCost()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

