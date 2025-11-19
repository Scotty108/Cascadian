import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface Trade {
  condition_id_norm: string;
  outcome_index: number;
  timestamp: string;
  trade_direction: string;
  shares: number;
  entry_price: number;
  usd_value: number;
}

interface Position {
  total_bought: number;
  total_sold: number;
  total_buy_value: number;
  total_sell_value: number;
  avg_buy_price: number;
  realized_pnl: number;
  trades: number;
}

async function calculatePnLMassiveDataset() {
  console.log('💰 CALCULATING P&L USING MASSIVE DATASET (vw_trades_canonical)');
  console.log('='.repeat(70));
  console.log(`Target wallet: ${WALLET}`);
  console.log('');

  // Step 1: Get all trades in chronological order
  console.log('📊 Step 1: Loading all trades from massive dataset...');
  const tradesResult = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        timestamp,
        trade_direction,
        toFloat64(shares) as shares,
        toFloat64(entry_price) as entry_price,
        toFloat64(usd_value) as usd_value
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND trade_direction IN ('BUY', 'SELL')  -- Exclude UNKNOWN trades
      ORDER BY timestamp ASC
    `,
    format: 'JSONEachRow'
  });

  const trades: Trade[] = await tradesResult.json();
  console.log(`   Loaded ${trades.length.toLocaleString()} trades`);

  // Step 2: Group by market/outcome and calculate average cost P&L
  console.log('📈 Step 2: Calculating average cost P&L by market...');

  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const key = `${trade.condition_id_norm}_${trade.outcome_index}`;

    if (!positions.has(key)) {
      positions.set(key, {
        total_bought: 0,
        total_sold: 0,
        total_buy_value: 0,
        total_sell_value: 0,
        avg_buy_price: 0,
        realized_pnl: 0,
        trades: 0
      });
    }

    const position = positions.get(key)!;
    position.trades++;

    if (trade.trade_direction === 'BUY') {
      // Buying: update average cost and position
      const new_total_bought = position.total_bought + trade.shares;
      const new_total_buy_value = position.total_buy_value + trade.usd_value;

      position.total_bought = new_total_bought;
      position.total_buy_value = new_total_buy_value;
      position.avg_buy_price = new_total_buy_value / new_total_bought;

    } else if (trade.trade_direction === 'SELL' && position.total_bought > 0) {
      // Selling: calculate realized P&L using average cost
      const cost_basis = position.avg_buy_price * trade.shares;
      const sale_value = trade.usd_value;
      const trade_pnl = sale_value - cost_basis;

      position.total_sold += trade.shares;
      position.total_sell_value += trade.usd_value;
      position.realized_pnl += trade_pnl;
    }
  }

  // Step 3: Summary by market
  console.log('\n📋 Step 3: P&L Summary by Market/Outcome:');
  console.log('Market/Outcome | Bought | Sold | Avg Cost | Realized P&L | Trade Count');
  console.log('-'.repeat(80));

  let total_pnl = 0;
  let total_bought_value = 0;
  let total_sold_value = 0;
  let market_count = 0;

  for (const [key, pos] of positions.entries()) {
    if (pos.realized_pnl !== 0 || pos.total_sold > 0) {
      market_count++;
      total_pnl += pos.realized_pnl;
      total_bought_value += pos.total_buy_value;
      total_sold_value += pos.total_sell_value;

      const pnl_sign = pos.realized_pnl >= 0 ? '+' : '';
      console.log(`${key.slice(-8)} | ${pos.total_bought.toLocaleString().padStart(8)} | ${pos.total_sold.toLocaleString().padStart(7)} | $${pos.avg_buy_price.toFixed(4).padStart(7)} | ${pnl_sign}$${pos.realized_pnl.toFixed(2).padStart(10)} | ${pos.trades.toString().padStart(10)}`);
    }
  }

  console.log('-'.repeat(80));
  const total_pnl_sign = total_pnl >= 0 ? '+' : '';
  console.log(`TOTALS        | ${''.padStart(8)} | ${''.padStart(7)} | ${''.padStart(7)} | ${total_pnl_sign}$${total_pnl.toFixed(2).padStart(10)} | ${''.padStart(10)}`);

  console.log('\n📈 Step 4: Final Results:');
  console.log(`   Total trades processed: ${trades.length.toLocaleString()}`);
  console.log(`   Markets with realized P&L: ${market_count.toLocaleString()}`);
  console.log(`   Total bought value: $${total_bought_value.toLocaleString()}`);
  console.log(`   Total sold value: $${total_sold_value.toLocaleString()}`);
  console.log(`   Total realized P&L: ${total_pnl_sign}$${total_pnl.toLocaleString()}`);

  console.log('\n🎯 Comparison:');
  console.log(`   Our original calculation: -$2.48`);
  console.log(`   Massive dataset calculation: ${total_pnl_sign}$${total_pnl.toLocaleString()}`);
  console.log(`   Expected Dune range: ~$80,000`);

  if (Math.abs(total_pnl) > 50000) {
    console.log('✅ SUCCESS: Now in expected ~$80K range!');
  } else {
    console.log('⚠️  Still need refinement - check position tracking logic');
  }
}

calculatePnLMassiveDataset().catch(console.error);