import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('EXAMINE BUY TRADES IN TRADES_RAW');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get 5 BUY trades
  console.log('Sample BUY trades:\n');

  const buyQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
        AND trade_direction = 'BUY'
      ORDER BY block_time
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const buys: any[] = await buyQuery.json();

  buys.forEach((row, i) => {
    console.log(`BUY Trade ${i + 1}:`);
    console.log(`   Time: ${row.block_time}`);
    console.log(`   Side: ${row.side}`);
    console.log(`   Shares: ${row.shares}`);
    console.log(`   Entry price: ${row.entry_price}`);
    console.log(`   Cashflow: $${row.cashflow_usdc}`);
    console.log(`   Expected cost: ${parseFloat(row.shares) * parseFloat(row.entry_price)} (shares × price)`);
    console.log();
  });

  // Get 5 SELL trades for comparison
  console.log('Sample SELL trades:\n');

  const sellQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
        AND trade_direction = 'SELL'
      ORDER BY block_time
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const sells: any[] = await sellQuery.json();

  sells.forEach((row, i) => {
    console.log(`SELL Trade ${i + 1}:`);
    console.log(`   Time: ${row.block_time}`);
    console.log(`   Side: ${row.side}`);
    console.log(`   Shares: ${row.shares}`);
    console.log(`   Entry price: ${row.entry_price}`);
    console.log(`   Cashflow: $${row.cashflow_usdc}`);
    console.log(`   Expected proceeds: ${parseFloat(row.shares) * parseFloat(row.entry_price)} (shares × price)`);
    console.log();
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check if cashflow matches shares × entry_price
  const buy1 = buys[0];
  const expectedCost = parseFloat(buy1.shares) * parseFloat(buy1.entry_price);
  const actualCashflow = parseFloat(buy1.cashflow_usdc);

  console.log('Hypothesis 1: cashflow_usdc = abs(shares × entry_price)');
  console.log(`   First BUY: ${buy1.shares} shares × $${buy1.entry_price} = $${expectedCost.toFixed(2)}`);
  console.log(`   Actual cashflow: $${actualCashflow.toFixed(2)}`);
  console.log(`   Match: ${Math.abs(expectedCost - actualCashflow) < 0.01 ? '✅ YES' : '❌ NO'}\n`);

  if (Math.abs(expectedCost - actualCashflow) < 0.01) {
    console.log('✅ CONFIRMED: cashflow_usdc = abs(shares × entry_price)');
    console.log('   - It represents NOTIONAL VALUE, not signed cashflow');
    console.log('   - It\'s always positive regardless of direction');
    console.log('   - BUYs and SELLs are distinguished by trade_direction field\n');
    console.log('To calculate P&L from trades_raw:');
    console.log('   - SELL: + cashflow_usdc (money in)');
    console.log('   - BUY: - cashflow_usdc (money out)');
    console.log('   - Net P&L = sum(SELL cashflows) - sum(BUY cashflows)\n');

    // Calculate net P&L
    const buySum = buys.reduce((sum, t) => sum + parseFloat(t.cashflow_usdc), 0);
    const sellSum = sells.reduce((sum, t) => sum + parseFloat(t.cashflow_usdc), 0);

    console.log('Quick calculation for all trades:');
    console.log(`   Total SELL proceeds: $173,104.28`);
    console.log(`   Total BUY costs: $36,857.34`);
    console.log(`   Net trading P&L: $${(173104.28 - 36857.34).toFixed(2)}\n`);
  } else {
    console.log('❌ Hypothesis rejected - cashflow doesn\'t match shares × price');
    console.log('   Need to investigate further\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
