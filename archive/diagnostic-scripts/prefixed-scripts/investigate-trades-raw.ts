import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('INVESTIGATE TRADES_RAW TABLE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Target wallet: ${WALLET}\n`);

  // Check schema
  console.log('Step 1: Check schema of trades_raw...\n');

  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE default.trades_raw`,
    format: 'JSONEachRow'
  });

  const schema: any[] = await schemaQuery.json();

  console.log('Schema:');
  schema.forEach(col => {
    console.log(`   ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log();

  // Sample 10 rows
  console.log('Step 2: Sample 10 trades ordered by time...\n');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
      ORDER BY block_time
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  console.log('Sample trades:');
  samples.forEach((row, i) => {
    console.log(`\n   Trade ${i + 1}:`);
    Object.entries(row).forEach(([key, value]) => {
      console.log(`      ${key}: ${value}`);
    });
  });
  console.log();

  // Check date range
  console.log('Step 3: Check date range...\n');

  const rangeQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS total_trades,
        min(block_time) AS first_trade,
        max(block_time) AS last_trade,
        dateDiff('day', min(block_time), max(block_time)) AS days_span
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const range: any[] = await rangeQuery.json();
  const r = range[0];

  console.log(`   Total trades: ${r.total_trades}`);
  console.log(`   First trade: ${r.first_trade}`);
  console.log(`   Last trade: ${r.last_trade}`);
  console.log(`   Time span: ${r.days_span} days\n`);

  // Check cashflow statistics
  console.log('Step 4: Analyze cashflow_usdc...\n');

  const cashflowQuery = await clickhouse.query({
    query: `
      SELECT
        sum(toFloat64(cashflow_usdc)) AS total_cashflow,
        avg(toFloat64(cashflow_usdc)) AS avg_cashflow,
        min(toFloat64(cashflow_usdc)) AS min_cashflow,
        max(toFloat64(cashflow_usdc)) AS max_cashflow,
        countIf(toFloat64(cashflow_usdc) > 0) AS positive_cashflow_count,
        countIf(toFloat64(cashflow_usdc) < 0) AS negative_cashflow_count,
        countIf(toFloat64(cashflow_usdc) = 0) AS zero_cashflow_count
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const cashflow: any[] = await cashflowQuery.json();
  const c = cashflow[0];

  console.log(`   Total cashflow: $${parseFloat(c.total_cashflow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Average per trade: $${parseFloat(c.avg_cashflow).toFixed(2)}`);
  console.log(`   Min: $${parseFloat(c.min_cashflow).toFixed(2)}`);
  console.log(`   Max: $${parseFloat(c.max_cashflow).toFixed(2)}`);
  console.log(`   Positive cashflow trades: ${c.positive_cashflow_count} (money in)`);
  console.log(`   Negative cashflow trades: ${c.negative_cashflow_count} (money out)`);
  console.log(`   Zero cashflow trades: ${c.zero_cashflow_count}\n`);

  // Check for condition_id field
  console.log('Step 5: Check if trades_raw has market/condition identifiers...\n');

  const fieldsQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const sampleRow: any[] = await fieldsQuery.json();

  if (sampleRow.length > 0) {
    console.log('Available fields in sample row:');
    Object.keys(sampleRow[0]).forEach(key => {
      console.log(`   - ${key}`);
    });
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ASSESSMENT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const totalCashflow = parseFloat(c.total_cashflow);
  const currentReported = 23426;
  const duneValue = 80000;

  console.log(`   Current system: $${currentReported.toLocaleString()}`);
  console.log(`   Dune reported: ~$${duneValue.toLocaleString()}`);
  console.log(`   trades_raw cashflow: $${Math.round(totalCashflow).toLocaleString()}\n`);

  if (totalCashflow > 100000) {
    console.log('⚠️  Cashflow ($210K) is much higher than both current ($23K) and Dune ($80K)');
    console.log('   This suggests cashflow_usdc may not be directly usable as realized P&L\n');
    console.log('Possible explanations:');
    console.log('   1. cashflow_usdc includes unrealized positions (mark-to-market)');
    console.log('   2. cashflow_usdc is cumulative, not per-trade net');
    console.log('   3. Need to filter by trade type or status');
    console.log('   4. Need to apply additional processing (fees, basis calculation)\n');
  } else {
    console.log('✅ Cashflow value is in expected range\n');
  }

  console.log('Next step: Examine sample trades to understand cashflow_usdc semantics\n');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
