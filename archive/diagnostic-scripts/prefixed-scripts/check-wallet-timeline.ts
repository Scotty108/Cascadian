import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('WALLET ACTIVITY TIMELINE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get time range
  const timeRangeQuery = await clickhouse.query({
    query: `
      SELECT
        min(timestamp) as first_trade,
        max(timestamp) as last_trade,
        dateDiff('day', min(timestamp), max(timestamp)) as days_active
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const timeRange = await timeRangeQuery.json();
  console.log('Data coverage:');
  console.log(`   First trade: ${timeRange[0].first_trade}`);
  console.log(`   Last trade: ${timeRange[0].last_trade}`);
  console.log(`   Days active: ${timeRange[0].days_active}\n`);

  // Get trade distribution by month
  const monthlyQuery = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(timestamp) as month,
        trade_direction,
        count() as trades,
        sum(toFloat64(usd_value)) as total_value
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND trade_direction IN ('BUY', 'SELL')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY month, trade_direction
      ORDER BY month ASC
    `,
    format: 'JSONEachRow'
  });

  const monthly = await monthlyQuery.json();

  console.log('Monthly activity:\n');

  const monthMap = new Map<string, { buys: number; buyValue: number; sells: number; sellValue: number }>();

  for (const row of monthly) {
    const month = row.month.substring(0, 7); // YYYY-MM
    if (!monthMap.has(month)) {
      monthMap.set(month, { buys: 0, buyValue: 0, sells: 0, sellValue: 0 });
    }

    const data = monthMap.get(month)!;
    if (row.trade_direction === 'BUY') {
      data.buys = parseInt(row.trades);
      data.buyValue = parseFloat(row.total_value);
    } else if (row.trade_direction === 'SELL') {
      data.sells = parseInt(row.trades);
      data.sellValue = parseFloat(row.total_value);
    }
  }

  for (const [month, data] of Array.from(monthMap.entries()).sort()) {
    console.log(`${month}:`);
    console.log(`   BUY:  ${data.buys} trades, $${data.buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   SELL: ${data.sells} trades, $${data.sellValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Net:  $${(data.sellValue - data.buyValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('KEY INSIGHT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('⚠️  CRITICAL FINDING:');
  console.log(`   Our data starts: ${timeRange[0].first_trade}`);
  console.log(`   Wallet likely active BEFORE this date`);
  console.log(`   Early SELLs are closing OLD positions (before data)`);
  console.log(`   We have NO cost basis for those old positions\n`);

  console.log('This means:');
  console.log('   ✅ We CAN calculate: Unrealized P&L on NEW positions (after ${timeRange[0].first_trade})');
  console.log('   ❌ We CANNOT calculate: Realized P&L from OLD positions (before ${timeRange[0].first_trade})');
  console.log('   ❌ We CANNOT calculate: Resolution P&L (no markets resolved yet)\n');

  console.log('Dune\'s $80K must be one of:');
  console.log('   1. Includes older data (before ${timeRange[0].first_trade})');
  console.log('   2. Uses unrealized/mark-to-market P&L');
  console.log('   3. Has complete cost basis for old positions\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
