// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000
});

const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';
const SPORTS = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

async function main() {
  // 1. Theo from vw_wallet_pnl_totals
  console.log('=== THEO - vw_wallet_pnl_totals ===');
  const theoTotalsRes = await clickhouse.query({
    query: `SELECT * FROM vw_wallet_pnl_totals WHERE wallet_address = '${THEO}'`,
    format: 'JSONEachRow'
  });
  const theoTotals = await theoTotalsRes.json();
  console.log(JSON.stringify(theoTotals, null, 2));
  
  // 2. Sports Bettor from vw_wallet_pnl_totals
  console.log('
=== SPORTS BETTOR - vw_wallet_pnl_totals ===');
  const sportsTotalsRes = await clickhouse.query({
    query: `SELECT * FROM vw_wallet_pnl_totals WHERE wallet_address = '${SPORTS}'`,
    format: 'JSONEachRow'
  });
  const sportsTotals = await sportsTotalsRes.json();
  console.log(JSON.stringify(sportsTotals, null, 2));
  
  // 3. Theo from pm_wallet_market_pnl_v4 - aggregated
  console.log('
=== THEO - pm_wallet_market_pnl_v4 AGGREGATED ===');
  const theoAggRes = await clickhouse.query({
    query: `
      SELECT 
        wallet,
        count() as positions,
        countDistinct(condition_id) as markets,
        sum(total_pnl) as total_pnl,
        sum(trading_pnl) as trading_pnl,
        sum(resolution_pnl) as resolution_pnl,
        sum(resolution_payout) as resolution_payouts,
        sum(total_bought_usdc) as total_bought,
        sum(total_sold_usdc) as total_sold,
        sum(total_trades) as total_trades,
        min(first_trade) as first_trade,
        max(last_trade) as last_trade
      FROM pm_wallet_market_pnl_v4 
      WHERE wallet = '${THEO}'
      GROUP BY wallet
    `,
    format: 'JSONEachRow'
  });
  const theoAgg = await theoAggRes.json();
  console.log(JSON.stringify(theoAgg, null, 2));
  
  // 4. Sports Bettor from pm_wallet_market_pnl_v4 - aggregated
  console.log('
=== SPORTS BETTOR - pm_wallet_market_pnl_v4 AGGREGATED ===');
  const sportsAggRes = await clickhouse.query({
    query: `
      SELECT 
        wallet,
        count() as positions,
        countDistinct(condition_id) as markets,
        sum(total_pnl) as total_pnl,
        sum(trading_pnl) as trading_pnl,
        sum(resolution_pnl) as resolution_pnl,
        sum(resolution_payout) as resolution_payouts,
        sum(total_bought_usdc) as total_bought,
        sum(total_sold_usdc) as total_sold,
        sum(total_trades) as total_trades,
        min(first_trade) as first_trade,
        max(last_trade) as last_trade
      FROM pm_wallet_market_pnl_v4 
      WHERE wallet = '${SPORTS}'
      GROUP BY wallet
    `,
    format: 'JSONEachRow'
  });
  const sportsAgg = await sportsAggRes.json();
  console.log(JSON.stringify(sportsAgg, null, 2));
  
  // 5. Resolution payouts for both wallets
  console.log('
=== RESOLUTION PAYOUTS ===');
  const payoutsRes = await clickhouse.query({
    query: `
      SELECT 
        wallet_address,
        count() as conditions_resolved,
        sum(resolution_payout_usdc) as total_payout
      FROM vw_pm_resolution_payouts 
      WHERE wallet_address IN ('${THEO}', '${SPORTS}')
      GROUP BY wallet_address
    `,
    format: 'JSONEachRow'
  });
  const payouts = await payoutsRes.json();
  console.log(JSON.stringify(payouts, null, 2));
  
  // 6. Check pm_wallet_condition_pnl_v4 for both wallets
  console.log('
=== pm_wallet_condition_pnl_v4 AGGREGATED ===');
  const conditionPnlRes = await clickhouse.query({
    query: `
      SELECT 
        wallet_address,
        count() as conditions,
        sum(total_pnl_usdc) as total_pnl,
        sum(net_cash_flow_usdc) as net_cash_flow,
        sum(resolution_payout_usdc) as resolution_payouts,
        sum(total_bought_usdc) as total_bought,
        sum(total_sold_usdc) as total_sold
      FROM pm_wallet_condition_pnl_v4 
      WHERE wallet_address IN ('${THEO}', '${SPORTS}')
      GROUP BY wallet_address
    `,
    format: 'JSONEachRow'
  });
  const conditionPnl = await conditionPnlRes.json();
  console.log(JSON.stringify(conditionPnl, null, 2));
  
  await clickhouse.close();
}

main().catch(console.error);
