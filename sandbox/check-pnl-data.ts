import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkPnlData() {
  console.log('🔍 Checking P&L calculation data...');

  // Quick check of ALL tables in our sandbox
  console.log('\n1. Available sandbox tables:');
  const tables = await clickhouse.query({
    query: `
      SELECT name,
             engine,
             total_rows,
             formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database = 'sandbox'
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const tablesData = await tables.json();
  tablesData.forEach((table: any) => {
    console.log(` - ${table.name}: ${table.size}, ${table.total_rows} rows`);
  });

  // Check our CURRENT tables specifically
  const ourResult = await clickhouse.query({
    query: `
      SELECT name,
             engine,
             total_rows,
             formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database = 'sandbox'
        AND name IN ('fills_norm_fixed_v2', 'realized_pnl_by_market_v2', 'token_cid_map', 'ctf_market_identity')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const ourData = await ourResult.json();

  if (ourData.length == 0) {
    console.log('❌ No expected tables found');
    return;
  }

  console.log('\n2. Our specific P&L tables:');
  ourData.forEach((table: any) => {
    console.log(`   ${table.name}: ${table.total_rows} rows, ${table.size}`);
  });

  // Show sample data from realized_pnl_by_market_v2
  console.log('\n3. Sample P&L calculation results:');
  const pnlResult = await clickhouse.query({
    query: `
      SELECT * EXCEPT wallet
      FROM sandbox.realized_pnl_by_market_v2
      WHERE wallet = '${WALLET}'
      ORDER BY realized_trade_pnl DESC
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const pnlSample = await pnlResult.json();

  if (pnlSample.length == 0) {
    console.log('   No P&L data stored yet - need to run the calculation script');
    return;
  }

  console.log(`   Found ${pnlSample.length} P&L calculations:`);
  pnlSample.forEach((row: any) => {
    const slug = row.market_slug || 'unknown';
    const sign = row.realized_trade_pnl > 0 ? '+' : '';
    console.log(`   - ${slug.slice(0, 25)}...: ${sign}$${row.realized_trade_pnl.toFixed(4)} P&L, ` +
                `avg:$${row.avg_buy_price.toFixed(3)}-${row.avg_sell_price.toFixed(3)}, ` +
                `${row.trades} trades`);
  });

  // Summary totals
  const totals = await clickhouse.query({
    query: `
      SELECT
        sum(realized_trade_pnl) as total_pnl,
        sum(fees) as total_fees,
        count() as market_count,
        sum(total_closing_qty) as total_closed
      FROM sandbox.realized_pnl_by_market_v2
      WHERE wallet = '${WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const totalsData = await totals.json();

  if (totalsData.length > 0 && totalsData[0].total_pnl != null) {
    console.log('\n4. Calculation Totals:');
    console.log(`   Total realized P&L: $${totalsData[0].total_pnl.toFixed(2)}`);
    console.log(`   Total fees: $${totalsData[0].total_fees.toFixed(2)}`);
    console.log(`   Net after fees: $${(totalsData[0].total_pnl - totalsData[0].total_fees).toFixed(2)}`);
    console.log(`   Markets processed: ${totalsData[0].market_count}`);
    console.log(`   Total shares closed: ${totalsData[0].total_closed}`);
  }
}

checkPnlData().catch(console.error);