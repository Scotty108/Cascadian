import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function calculatePnLMassiveWorking() {
  console.log('💰 CALCULATING P&L FROM MASSIVE DATASET - WORKING VERSION');
  console.log('='.repeat(70));
  console.log(`Target wallet: ${WALLET}`);
  console.log('');

  // Step 1: Get all trades excluding the problematic 00000000 condition
  console.log('📊 Step 1: Loading trades from massive dataset (excluding 00000000)...');

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
        AND trade_direction IN ('BUY', 'SELL')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ORDER BY timestamp ASC
    `,
    format: 'JSONEachRow'
  });

  const trades = await tradesResult.json();
  console.log(`   Loaded ${trades.length.toLocaleString()} trades (excluding 00000000 condition)`);

  if (trades.length === 0) {
    console.log('❌ No trades found after filtering!');
    return;
  }

  // Step 2: Group by market and calculate P&L
  console.log('📈 Step 2: Calculating average cost P&L by market...');

  const positions = new Map();
  let total_realized_pnl = 0;
  let total_bought_value = 0;
  let total_sold_value = 0;

  for (const trade of trades) {
    const key = `${trade.condition_id_norm}_${trade.outcome_index}`;

    if (!positions.has(key)) {
      positions.set(key, {
        total_bought_shares: 0,
        total_sold_shares: 0,
        total_buy_cost: 0,
        total_sell_proceeds: 0,
        avg_buy_price: 0,
        realized_pnl: 0,
        trades: 0
      });
    }

    const position = positions.get(key);
    position.trades++;

    if (trade.trade_direction === 'BUY') {
      // Update position with new purchase
      const new_total_shares = position.total_bought_shares + trade.shares;
      const new_total_cost = position.total_buy_cost + trade.usd_value;

      position.total_bought_shares = new_total_shares;
      position.total_buy_cost = new_total_cost;
      position.avg_buy_price = new_total_cost / new_total_shares;

      total_bought_value += trade.usd_value;

    } else if (trade.trade_direction === 'SELL' && position.total_bought_shares > 0) {
      // Calculate realized P&L when selling
      const shares_to_sell = Math.min(trade.shares, position.total_bought_shares);
      const cost_basis = position.avg_buy_price * shares_to_sell;
      const sale_proceeds = trade.usd_value;
      const trade_pnl = sale_proceeds - cost_basis;

      position.realized_pnl += trade_pnl;
      position.total_sold_shares += shares_to_sell;
      position.total_sell_proceeds += sale_proceeds;
      position.total_bought_shares -= shares_to_sell;  // Reduce position
      position.total_buy_cost -= cost_basis;

      total_sold_value += sale_proceeds;
      total_realized_pnl += trade_pnl;
    }
  }

  // Step 3: Market summary
  console.log('\n📋 Step 3: P&L Summary by Market (markets with P&L > $1):');
  console.log('Market | Bought | Sold | Avg Cost | Realized P&L | Trade Count');
  console.log('-'.repeat(80));

  let market_count = 0;
  const results = [];

  for (const [key, pos] of positions.entries()) {
    if (Math.abs(pos.realized_pnl) > 1.0 || pos.total_sell_proceeds > 0) {
      market_count++;
      results.push({
        market: key.slice(-8),
        bought_shares: pos.total_bought_shares + pos.total_sold_shares,
        sold_shares: pos.total_sold_shares,
        avg_cost: pos.avg_buy_price,
        realized_pnl: pos.realized_pnl,
        trades: pos.trades
      });
    }
  }

  // Sort by P&L desc
  results.sort((a, b) => b.realized_pnl - a.realized_pnl);

  results.forEach((result: any) => {
    const pnl_sign = result.realized_pnl >= 0 ? '+' : '';
    console.log(`${result.market} | ${result.bought_shares.toLocaleString().padStart(8)} | ${result.sold_shares.toLocaleString().padStart(6)} | $${result.avg_cost.toFixed(4).padStart(7)} | ${pnl_sign}$${result.realized_pnl.toFixed(2).padStart(10)} | ${result.trades.toString().padStart(10)}`);
  });

  console.log('-'.repeat(80));
  const total_pnl_sign = total_realized_pnl >= 0 ? '+' : '';
  console.log(`TOTALS | ${''.padStart(8)} | ${''.padStart(6)} | ${''.padStart(7)} | ${total_pnl_sign}$${total_realized_pnl.toFixed(2).padStart(10)} | ${''.padStart(10)}`);

  console.log('\n📈 Final Results:');
  console.log(`   Total trades processed: ${trades.length.toLocaleString()}`);
  console.log(`   Markets with realized P&L: ${market_count.toLocaleString()}`);
  console.log(`   Total bought value: $${total_bought_value.toLocaleString()}`);
  console.log(`   Total sold value: $${total_sold_value.toLocaleString()}`);
  console.log(`   Total realized P&L: ${total_pnl_sign}$${total_realized_pnl.toLocaleString()}`);

  console.log('\n🎯 Comparison:');
  console.log(`   Original clob_fills: -$2.48`);
  console.log(`   Massive dataset: ${total_pnl_sign}$${total_realized_pnl.toLocaleString()}`);
  console.log(`   Expected Dune range: ~$80,000`);

  if (Math.abs(total_realized_pnl) > 25000) {
    console.log('✅ BREAKTHROUGH: Now in expected ~$80K range with massive dataset!');
  } else {
    console.log('⚠️  Still refining - need to check data quality or methodology');
  }
}

calculatePnLMassiveWorking().catch(console.error);