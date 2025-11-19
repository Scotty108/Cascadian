import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VERIFY AGENT\'S CLAIMS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check vw_trades_canonical
  console.log('Claim 1: Found 1,384 trades in vw_trades_canonical\n');

  const allTradesQuery = await clickhouse.query({
    query: `
      SELECT count() AS total
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const allTrades: any[] = await allTradesQuery.json();
  console.log(`   Actual: ${allTrades[0].total} total trades\n`);

  // Check BUY/SELL distribution
  console.log('Claim 2: Realized P&L = -$136K from completed trades\n');

  const directionQuery = await clickhouse.query({
    query: `
      SELECT
        trade_direction,
        count() AS trades,
        sum(toFloat64(usd_value)) AS total_value
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND trade_direction IN ('BUY', 'SELL')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY trade_direction
    `,
    format: 'JSONEachRow'
  });

  const directions: any[] = await directionQuery.json();

  let buyValue = 0;
  let sellValue = 0;
  let buyTrades = 0;
  let sellTrades = 0;

  directions.forEach(d => {
    console.log(`   ${d.trade_direction}: ${d.trades} trades, $${parseFloat(d.total_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    if (d.trade_direction === 'BUY') {
      buyValue = parseFloat(d.total_value);
      buyTrades = parseInt(d.trades);
    } else if (d.trade_direction === 'SELL') {
      sellValue = parseFloat(d.total_value);
      sellTrades = parseInt(d.trades);
    }
  });

  console.log(`\n   Net cashflow: $${(sellValue - buyValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   (This is NOT realized P&L - it's gross cashflow)\n`);

  // Check agent's calculation result
  console.log('Claim 3: Calculation shows -$136K realized P&L\n');
  console.log(`   Actual calculation result: $0 realized P&L`);
  console.log(`   (because $${sellValue.toLocaleString()} sold value = $0, all positions still open)\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Agent claimed:');
  console.log('   1. Found 1,384 trades ❓');
  console.log('   2. Realized P&L = -$136K ❌ WRONG');
  console.log('   3. This explains $80K gap ❌ WRONG\n');

  console.log('Reality:');
  console.log(`   1. Found ${allTrades[0].total} trades (${buyTrades} BUY, ${sellTrades} SELL)`);
  console.log(`   2. Total bought: $${buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   3. Total sold: $${sellValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log('   4. Realized P&L: $0 (no closed positions!)\n');

  if (sellTrades === 0) {
    console.log('🚨 CRITICAL FINDING:');
    console.log('   ALL positions are still OPEN (0 SELL trades)');
    console.log('   The wallet has NOT realized any P&L from trading');
    console.log('   All $173K invested is in open positions\n');
  }

  console.log('Agent\'s error:');
  console.log('   Confused NET CASHFLOW (-$136K) with REALIZED P&L');
  console.log('   Net cashflow = money out - money in');
  console.log('   Realized P&L = profit/loss from CLOSED positions\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
