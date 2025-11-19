import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CHECK TRADE DIRECTIONS IN TRADES_RAW');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check distribution of trade_direction
  const directionQuery = await clickhouse.query({
    query: `
      SELECT
        trade_direction,
        count() AS count,
        sum(toFloat64(cashflow_usdc)) AS total_cashflow,
        avg(toFloat64(cashflow_usdc)) AS avg_cashflow
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
      GROUP BY trade_direction
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });

  const directions: any[] = await directionQuery.json();

  console.log('Trade direction breakdown:\n');
  directions.forEach(d => {
    console.log(`   ${d.trade_direction}:`);
    console.log(`      Count: ${d.count}`);
    console.log(`      Total cashflow: $${parseFloat(d.total_cashflow).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`      Avg cashflow: $${parseFloat(d.avg_cashflow).toFixed(2)}\n`);
  });

  // Check if there are any negative cashflows
  const negativeQuery = await clickhouse.query({
    query: `
      SELECT count() AS count
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
        AND toFloat64(cashflow_usdc) < 0
    `,
    format: 'JSONEachRow'
  });

  const negative: any[] = await negativeQuery.json();

  console.log(`\nTrades with negative cashflow: ${negative[0].count}\n`);

  // Check side distribution
  const sideQuery = await clickhouse.query({
    query: `
      SELECT
        side,
        count() AS count,
        sum(toFloat64(cashflow_usdc)) AS total_cashflow
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
      GROUP BY side
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });

  const sides: any[] = await sideQuery.json();

  console.log('Side (outcome) breakdown:\n');
  sides.forEach(s => {
    console.log(`   ${s.side}:`);
    console.log(`      Count: ${s.count}`);
    console.log(`      Total cashflow: $${parseFloat(s.total_cashflow).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CONCLUSION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const buyCount = directions.find(d => d.trade_direction === 'BUY')?.count || 0;
  const sellCount = directions.find(d => d.trade_direction === 'SELL')?.count || 0;

  if (buyCount === 0) {
    console.log('❌ NO BUY TRADES FOUND IN TRADES_RAW');
    console.log('   All 674 trades are marked as SELL');
    console.log('   cashflow_usdc ($210K) = gross receipts from sells only\n');
    console.log('This explains why it\'s so high:');
    console.log('   - It\'s not net P&L');
    console.log('   - It doesn\'t subtract buy costs');
    console.log('   - It\'s just one side of the equation\n');
    console.log('✅ SOLUTION: Use clob_fills which has proper BUY/SELL sides\n');
    console.log('Next step: Implement average cost P&L from clob_fills');
    console.log('           (even though it only has 194 fills, they have both sides)\n');
  } else {
    console.log(`Found ${buyCount} BUY and ${sellCount} SELL trades`);
    console.log('Need to investigate why cashflows are all positive\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
