import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigateResolutionPnL() {
  console.log('🎯 INVESTIGATING BUY-THEN-HOLD TO RESOLUTION P&L');
  console.log('='.repeat(70));

  // Step 1: Get all trades for our wallet
  console.log('Step 1: Analyzing complete trade history...');

  const allTrades = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        timestamp,
        trade_direction,
        toFloat64(shares) as shares,
        toFloat64(entry_price) as entry_price,
        toFloat64(usd_value) as usd_value,
        trade_key,
        outcome_token
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ORDER BY timestamp ASC
    `,
    format: 'JSONEachRow'
  });

  const trades = await allTrades.json();
  console.log(`Total trades: ${trades.length.toLocaleString()}`);

  // Step 2: Calculate net position by market
  const positions = new Map();

  trades.forEach((trade: any) => {
    const key = `${trade.condition_id_norm}_${trade.outcome_index}`;

    if (!positions.has(key)) {
      positions.set(key, {
        condition_id: trade.condition_id_norm,
        outcome_index: trade.outcome_index,
        total_bought_shares: 0,
        total_sold_shares: 0,
        net_position: 0,
        total_buy_cost: 0,
        total_sell_proceeds: 0,
        avg_buy_price: 0,
        trade_count: 0,
        first_trade: trade.timestamp,
        last_trade: trade.timestamp,
        outcome: trade.outcome_token
      });
    }

    const position = positions.get(key);
    position.trade_count++;
    position.last_trade = trade.timestamp;

    if (trade.trade_direction === 'BUY') {
      const new_total_shares = position.total_bought_shares + trade.shares;
      const new_total_cost = position.total_buy_cost + trade.usd_value;

      position.total_bought_shares = new_total_shares;
      position.total_buy_cost = new_total_cost;
      position.avg_buy_price = new_total_cost / new_total_shares;
      position.net_position += trade.shares;

    } else if (trade.trade_direction === 'SELL') {
      position.total_sold_shares += trade.shares;
      position.total_sell_proceeds += trade.usd_value;
      position.net_position -= trade.shares;
    }
  });

  console.log('\nStep 2: Net positions by market:');
  console.log('Market (last 8) | Outcome | Net Position | Avg Cost | Buy Value | Sell Value | Trades');
  console.log('-'.repeat(100));

  let total_bought_value = 0;
  let total_sell_value = 0;
  let active_positions = 0;

  const marketResults = [];

  for (const [key, pos] of positions.entries()) {
    total_bought_value += pos.total_buy_cost;
    total_sell_value += pos.total_sell_proceeds;

    if (pos.net_position !== 0) {
      active_positions++;
    }

    marketResults.push({
      market: key.slice(-8),
      outcome: pos.outcome,
      net_position: pos.net_position,
      avg_cost: pos.avg_buy_price,
      buy_value: pos.total_buy_cost,
      sell_value: pos.total_sell_proceeds,
      trades: pos.trade_count
    });

    console.log(`${key.slice(-8)} | ${pos.outcome.padEnd(5)} | ${pos.net_position.toLocaleString().padStart(12)} | $${pos.avg_buy_price.toFixed(3).padStart(7)} | $${pos.total_buy_cost.toFixed(2).padStart(9)} | $${pos.total_sell_proceeds.toFixed(2).padStart(10)} | ${pos.trade_count.toString().padStart(6)}`);
  }

  // Step 3: Check for resolution data
  console.log('\nStep 3: Checking market resolution data...');

  // Look for resolution tables
  const resolutionTables = await clickhouse.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND (name LIKE '%resolution%' OR name LIKE '%outcome%' OR name LIKE '%settle%')
        AND total_rows \u003e 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const resolutionData = await resolutionTables.json();
  console.log('Potential resolution data sources:');
  resolutionData.forEach((table: any) => {
    console.log(`  ${table.name}: ${table.total_rows.toLocaleString()} rows`);
  });

  // Check condition resolution mapping
  if (resolutionData.length \u003e 0) {
    const conditionIds = Array.from(positions.keys()).map(key =\u003e `'${key.split('_')[0]}'`).slice(0, 10);

    const sampleResolution = await clickhouse.query({
      query: `
        SELECT *
        FROM ${resolutionData[0].name}
        WHERE condition_id IN (${conditionIds.join(',')})
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const sampleData = await sampleResolution.json();
    if (sampleData.length \u003e 0) {
      console.log('\nSample resolution data:');
      sampleData.forEach((res: any, i: number) => {
        console.log(`  ${i+1}.`, Object.keys(res).map(k =\u003e `${k}: ${res[k]}`).join(' | '));
      });
    }
  }

  // Step 4: Estimate resolution P&L scenario
  console.log('\nStep 4: Resolution P&L scenarios for active positions:');

  const activeMarkets = marketResults.filter(m =\u003e m.net_position !== 0);

  if (activeMarkets.length \u003e 0) {
    console.log('Active positions that could generate resolution P&L:');
    console.log('Market | Outcome | Shares | Cost Basis | Resolution Value | P&L Impact');
    console.log('-'.repeat(85));

    activeMarkets.forEach(market =\u003e {
      const cost_basis = market.net_position * market.avg_cost;

      // Scenario 1: Outcome is YES (resolution = 1.0)
      const win_value_yes = market.net_position * 1.0;
      const pnl_yes = win_value_yes - cost_basis;

      // Scenario 2: Outcome is NO (resolution = 0.0)
      const win_value_no = market.net_position * 0.0;
      const pnl_no = win_value_no - cost_basis;

      console.log(`${market.market} | ${market.outcome.padEnd(5)} | ${market.net_position.toLocaleString().padStart(6)} | $${cost_basis.toFixed(2).padStart(10)} | $${win_value_yes.toFixed(2).padStart(14)} | ${pnl_yes \u003e= 0 ? '+' : ''}$${pnl_yes.toFixed(2).padStart(9)} (if YES)`);
      console.log(`${''.padStart(55)} | $${win_value_no.toFixed(2).padStart(14)} | ${pnl_no \u003e= 0 ? '+' : ''}$${pnl_no.toFixed(2).padStart(9)} (if NO)  `);
    });

    console.log('\n📈 Summary:');
    console.log(`Total bought: $${total_bought_value.toLocaleString()}`);
    console.log(`Total sold: $${total_sell_value.toLocaleString()}`);
    console.log(`Net realized: $${(total_sell_value - total_bought_value).toLocaleString()}`);
    console.log(`Active positions: ${active_positions} markets`);
    console.log(`Resolution P&L potential: $${total_bought_value.toLocaleString()} - $${total_sell_value.toLocaleString()} = $${(total_bought_value - total_sell_value).toLocaleString()}`);

    if (Math.abs(total_bought_value - total_sell_value) \u003e 50000) {
      console.log('✅ SIGNIFICANT: Resolution P&L could close gap to expected ~$80K!');
    }
  } else {
    console.log('ℹ️  All positions are closed - no resolution P&L expected');
  }
}

investigateResolutionPnL().catch(console.error);" file_path="/Users/scotty/Projects/Cascadian-app/sandbox/investigate-resolution-pnl.ts"/> > /Users/scotty/Projects/Cascadian-app/sandbox/investigate-resolution-pnl.ts
</parameter>
<file_path>/Users/scotty/Projects/Cascadian-app/sandbox/investigate-resolution-pnl.ts</file_path>
</invoke>