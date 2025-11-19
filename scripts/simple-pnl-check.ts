import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0x6770bf688b8121331b1c5cfd7723ebd4152545fb';

async function simplePnLCheck() {
  console.log('SIMPLE P&L CHECK');
  console.log('Wallet:', WALLET);
  console.log('Polymarket UI: $1,914');
  console.log('='.repeat(80), '\n');

  // Check trade_cashflows_v3 total
  console.log('1. Total from trade_cashflows_v3 (our current source):');
  const tcfTotal = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as row_count,
        SUM(toFloat64(cashflow_usdc)) as total_cashflow,
        SUM(CASE WHEN toFloat64(cashflow_usdc) > 0 THEN toFloat64(cashflow_usdc) ELSE 0 END) as gross_gains,
        SUM(CASE WHEN toFloat64(cashflow_usdc) < 0 THEN toFloat64(cashflow_usdc) ELSE 0 END) as gross_losses,
        COUNT(DISTINCT condition_id_norm) as unique_markets
      FROM default.trade_cashflows_v3
      WHERE lower(wallet) = '${WALLET}'
    `,
    format: 'JSONEachRow',
  });
  const tcf = await tcfTotal.json();
  console.log(JSON.stringify(tcf, null, 2), '\n');

  // Check trades_raw total
  console.log('2. Total from trades_raw (source table):');
  const tradesRaw = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as row_count,
        COUNT(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as unique_markets,
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade
      FROM default.trades_raw
      WHERE lower(wallet) = '${WALLET}'
    `,
    format: 'JSONEachRow',
  });
  const raw = await tradesRaw.json();
  console.log(JSON.stringify(raw, null, 2), '\n');

  // Sample trade_cashflows_v3 rows
  console.log('3. Sample rows from trade_cashflows_v3:');
  const sample = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        toFloat64(shares) as shares,
        toFloat64(entry_price) as entry_price,
        toFloat64(cashflow_usdc) as cashflow_usdc,
        direction,
        timestamp
      FROM default.trade_cashflows_v3
      WHERE lower(wallet) = '${WALLET}'
      ORDER BY abs(toFloat64(cashflow_usdc)) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const sampleRows = await sample.json();
  console.log('Top 10 by cashflow magnitude:');
  console.log(JSON.stringify(sampleRows, null, 2), '\n');

  // Check if there's double-counting
  console.log('4. Check for potential double-counting:');
  const doubleCheck = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        COUNT(*) as row_count,
        SUM(toFloat64(cashflow_usdc)) as total_cashflow
      FROM default.trade_cashflows_v3
      WHERE lower(wallet) = '${WALLET}'
      GROUP BY condition_id_norm
      ORDER BY row_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const doubleData = await doubleCheck.json();
  console.log('Markets with most cashflow rows (possible double-counting):');
  console.log(JSON.stringify(doubleData, null, 2), '\n');

  const pmPnl = 1914;
  const ourPnl = tcf[0]?.total_cashflow || 0;

  console.log('SUMMARY:');
  console.log('-'.repeat(80));
  console.log(`Polymarket UI shows:     $${pmPnl.toFixed(2)}`);
  console.log(`trade_cashflows_v3 sum:  $${ourPnl.toFixed(2)}`);
  console.log(`Difference:              $${(ourPnl - pmPnl).toFixed(2)}`);
  console.log(`Ratio (our / polymarket): ${(ourPnl / pmPnl).toFixed(2)}x`);
}

simplePnLCheck().catch(console.error);
