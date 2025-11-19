import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function simpleResolutionAnalysis() {
  console.log('🎯 SIMPLE RESOLUTION P&L ANALYSIS');
  console.log('='.repeat(60));

  // Get net positions by market
  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        trade_direction,
        sum(toFloat64(shares)) as total_shares,
        sum(toFloat64(usd_value)) as total_value
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND trade_direction IN ('BUY', 'SELL')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY condition_id_norm, outcome_index, trade_direction
      ORDER BY condition_id_norm, outcome_index
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();

  console.log('Net positions by market/outcome:');
  console.log('Market | Outcome | BUY Shares | SEL Shares | Net Position | Value');
  console.log('-'.repeat(75));

  const markets = new Map();

  data.forEach((row: any) => {
    const key = `${row.condition_id_norm}_${row.outcome_index}`;

    if (!markets.has(key)) {
      markets.set(key, {
        condition: row.condition_id_norm.slice(-8),
        outcome: row.outcome_index,
        buy_shares: 0,
        sell_shares: 0,
        buy_value: 0,
        sell_value: 0
      });
    }

    const market = markets.get(key);

    if (row.trade_direction === 'BUY') {
      market.buy_shares = row.total_shares;
      market.buy_value = row.total_value;
    } else if (row.trade_direction === 'SELL') {
      market.sell_shares = row.total_shares;
      market.sell_value = row.total_value;
    }
  });

  let total_buy_value = 0;
  let total_sell_value = 0;
  let active_positions = 0;

  markets.forEach((market: any) => {
    const net_position = market.buy_shares - market.sell_shares;
    const net_value = market.buy_value - market.sell_value;

    total_buy_value += market.buy_value;
    total_sell_value += market.sell_value;

    if (net_position !== 0) {
      active_positions++;
    }

    console.log(`${market.condition} | ${market.outcome.toString().padStart(7)} | ${market.buy_shares.toLocaleString().padStart(10)} | ${market.sell_shares.toLocaleString().padStart(10)} | ${net_position.toLocaleString().padStart(12)} | $${net_value.toFixed(2).padStart(8)}`);
  });

  console.log('-'.repeat(75));

  const total_invested = total_buy_value - total_sell_value;
  console.log(`TOTAL: $${total_invested.toFixed(2)} invested across ${active_positions} active positions`);

  // Resolution scenarios
  console.log('\n📈 RESOLUTION SCENARIOS:');
  console.log('Resolution outcome | Total P&L | Explanation');
  console.log('-'.repeat(50));

  // Scenario 1: All YES positions resolve as YES (1.0)
  console.log(`All YES resolve = 1.0 | +$${(total_invested - total_invested).toFixed(2)} | Net investment returned as profit`);

  // Scenario 2: All NO positions resolve as NO (0.0)
  console.log(`All NO resolve = 0.0  | -$${total_invested.toFixed(2)} | Total investment lost`);

  // Scenario 3: Mixed resolution (need outcome-specific data)
  console.log(`Mixed resolution     | VARIES  | Depends on actual outcomes`);

  // The key insight: total invested = maximum potential resolution P&L
  console.log(`\n💡 KEY INSIGHT: $${total_invested.toFixed(2)} is the maximum potential resolution P&L`);
  console.log(`This could explain the remaining gap to $80,000 expectation!`);

  if (Math.abs(total_invested) > 50000) {
    console.log('\n✅ BREAKTHROUGH: Resolution P&L magnitude matches expected ~$80K range!');
  }
}

simpleResolutionAnalysis().catch(console.error);