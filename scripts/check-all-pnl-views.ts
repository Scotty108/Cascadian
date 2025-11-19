import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0x6770bf688b8121331b1c5cfd7723ebd4152545fb';

async function checkAllViews() {
  console.log('Checking all P&L views for wallet:', WALLET);
  console.log('Expected from Polymarket UI: $1,914');
  console.log('='.repeat(80), '\n');
  
  // Check vw_wallet_total_pnl
  try {
    console.log('1. vw_wallet_total_pnl:');
    const r1 = await clickhouse.query({
      query: `SELECT * FROM vw_wallet_total_pnl WHERE wallet = '${WALLET}'`,
      format: 'JSONEachRow',
    });
    const d1 = await r1.json();
    console.log(JSON.stringify(d1, null, 2), '\n');
  } catch (e: any) {
    console.log('Error:', e.message, '\n');
  }
  
  // Check vw_wallet_pnl_summary
  try {
    console.log('2. vw_wallet_pnl_summary:');
    const r2 = await clickhouse.query({
      query: `SELECT * FROM vw_wallet_pnl_summary WHERE wallet = '${WALLET}'`,
      format: 'JSONEachRow',
    });
    const d2 = await r2.json();
    console.log(JSON.stringify(d2, null, 2), '\n');
  } catch (e: any) {
    console.log('Error:', e.message, '\n');
  }
  
  // Check vw_wallet_pnl_calculated
  try {
    console.log('3. vw_wallet_pnl_calculated:');
    const r3 = await clickhouse.query({
      query: `SELECT * FROM vw_wallet_pnl_calculated WHERE wallet = '${WALLET}'`,
      format: 'JSONEachRow',
    });
    const d3 = await r3.json();
    console.log(JSON.stringify(d3, null, 2), '\n');
  } catch (e: any) {
    console.log('Error:', e.message, '\n');
  }
  
  // Check wallet_pnl_summary_final
  try {
    console.log('4. wallet_pnl_summary_final:');
    const r4 = await clickhouse.query({
      query: `SELECT * FROM wallet_pnl_summary_final WHERE wallet = '${WALLET}'`,
      format: 'JSONEachRow',
    });
    const d4 = await r4.json();
    console.log(JSON.stringify(d4, null, 2), '\n');
  } catch (e: any) {
    console.log('Error:', e.message, '\n');
  }
  
  // Check realized_pnl_by_market_final
  try {
    console.log('5. realized_pnl_by_market_final (aggregated):');
    const r5 = await clickhouse.query({
      query: `
        SELECT 
          wallet,
          SUM(pnl_usd) as total_pnl,
          SUM(pnl_usd_abs) as total_pnl_abs,
          COUNT(*) as market_count
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
        GROUP BY wallet
      `,
      format: 'JSONEachRow',
    });
    const d5 = await r5.json();
    console.log(JSON.stringify(d5, null, 2), '\n');
  } catch (e: any) {
    console.log('Error:', e.message, '\n');
  }
  
  // Check wallet_metrics
  try {
    console.log('6. wallet_metrics (latest):');
    const r6 = await clickhouse.query({
      query: `
        SELECT 
          wallet,
          total_pnl_usd,
          realized_pnl_usd,
          unrealized_pnl_usd,
          total_markets_traded,
          win_rate
        FROM wallet_metrics
        WHERE wallet = '${WALLET}'
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const d6 = await r6.json();
    console.log(JSON.stringify(d6, null, 2), '\n');
  } catch (e: any) {
    console.log('Error:', e.message, '\n');
  }
}

checkAllViews().catch(console.error);
