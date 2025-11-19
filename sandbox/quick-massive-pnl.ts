import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function quickMassivePnL() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('🔍 QUICK P&L CALCULATION FROM MASSIVE DATASET');
  console.log('='.repeat(50));

  // Get buy/sell totals from massive dataset
  const result = await clickhouse.query({
    query: `
      SELECT
        trade_direction,
        count() as trades,
        sum(toFloat64(usd_value)) as total_usd_value,
        sum(toFloat64(shares)) as total_shares
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${wallet}')
        AND trade_direction IN ('BUY', 'SELL')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY trade_direction
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();

  let total_buys = 0;
  let total_sells = 0;
  let buy_trades = 0;
  let sell_trades = 0;

  data.forEach((row: any) => {
    if (row.trade_direction === 'BUY') {
      total_buys = Number(row.total_usd_value);
      buy_trades = Number(row.trades);
    } else if (row.trade_direction === 'SELL') {
      total_sells = Number(row.total_usd_value);
      sell_trades = Number(row.trades);
    }
  });

  const gross_pnl = total_sells - total_buys;
  const total_trades = buy_trades + sell_trades;

  console.log(`Massive dataset summary (excl. 00000000):`);
  console.log(`  Total trades: ${total_trades.toLocaleString()}`);
  console.log(`  Buy trades: ${buy_trades.toLocaleString()} for $${total_buys.toLocaleString()}`);
  console.log(`  Sell trades: ${sell_trades.toLocaleString()} for $${total_sells.toLocaleString()}`);
  console.log(`  Gross P&L: ${gross_pnl >= 0 ? '+' : ''}$${gross_pnl.toLocaleString()}`);

  console.log('\n🎯 Comparison:');
  console.log(`  Original clob_fills: -$2.48`);
  console.log(`  Expected Dune: ~$80,000`);
  console.log(`  Massive dataset: ${gross_pnl >= 0 ? '+' : ''}$${gross_pnl.toLocaleString()}`);

  if (Math.abs(gross_pnl) > 25000) {
    console.log('✅ MAJOR BREAKTHROUGH: Found the missing P&L magnitude!');
  } else {
    console.log('⚠️ Need to investigate further...');
  }
}

quickMassivePnL().catch(console.error);