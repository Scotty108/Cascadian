#!/usr/bin/env npx tsx

/**
 * UNREALIZED P&L SYSTEM - STEP 5: API Query Examples
 *
 * Demonstrates common query patterns for frontend integration:
 * 1. Get wallet unrealized P&L
 * 2. Get top performers by unrealized P&L
 * 3. Get unrealized P&L by market
 * 4. Get combined realized + unrealized P&L (total P&L)
 * 5. Get portfolio summary (wallet intelligence)
 *
 * Use these patterns to build API endpoints in /src/app/api/
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

(async () => {
  const client = getClickHouseClient();

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('UNREALIZED P&L SYSTEM - API QUERY EXAMPLES');
  console.log('════════════════════════════════════════════════════════════════════\n');

  try {
    // 1. Get wallet unrealized P&L
    console.log('1. GET WALLET UNREALIZED P&L');
    console.log('   Use case: Display current portfolio value for a wallet\n');

    const walletQuery = await client.query({
      query: `
        SELECT
          wallet_address,
          ROUND(total_unrealized_pnl_usd, 2) as unrealized_pnl,
          positions_count,
          markets_count,
          ROUND(avg_unrealized_pnl_per_position, 2) as avg_pnl_per_position,
          ROUND(total_shares, 2) as total_shares,
          ROUND(total_cost_basis, 2) as cost_basis,
          ROUND(total_cost_basis + total_unrealized_pnl_usd, 2) as current_value,
          last_updated
        FROM wallet_unrealized_pnl
        ORDER BY total_unrealized_pnl_usd DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const walletData: any = await walletQuery.json();

    console.log('   Sample query:');
    console.log(`   SELECT * FROM wallet_unrealized_pnl WHERE wallet_address = '0x...'`);
    console.log('\n   Sample response:');
    console.log(JSON.stringify(walletData, null, 2));
    console.log('\n');

    // 2. Top performers by unrealized P&L
    console.log('2. TOP PERFORMERS BY UNREALIZED P&L');
    console.log('   Use case: Smart money leaderboard (unrealized gains)\n');

    const topPerformers = await client.query({
      query: `
        SELECT
          wallet_address,
          ROUND(total_unrealized_pnl_usd, 2) as unrealized_pnl,
          positions_count,
          markets_count,
          ROUND(total_unrealized_pnl_usd / NULLIF(total_cost_basis, 0) * 100, 2) as roi_pct
        FROM wallet_unrealized_pnl
        WHERE total_cost_basis > 1000  -- Min $1k invested
        ORDER BY total_unrealized_pnl_usd DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const topPerformersData: any = await topPerformers.json();

    console.log('   Sample query:');
    console.log(`   Top 10 wallets by unrealized P&L (min $1k invested)`);
    console.log('\n   Sample response:');
    console.log(JSON.stringify(topPerformersData, null, 2));
    console.log('\n');

    // 3. Unrealized P&L by market
    console.log('3. UNREALIZED P&L BY MARKET');
    console.log('   Use case: See which markets are profitable/unprofitable\n');

    const marketPnl = await client.query({
      query: `
        SELECT
          market_id,
          COUNT(*) as trades_count,
          COUNT(DISTINCT wallet_address) as unique_traders,
          ROUND(SUM(unrealized_pnl_usd), 2) as total_unrealized_pnl,
          ROUND(AVG(unrealized_pnl_usd), 2) as avg_unrealized_pnl_per_trade
        FROM trades_raw
        WHERE unrealized_pnl_usd IS NOT NULL
          AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY market_id
        ORDER BY total_unrealized_pnl DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const marketPnlData: any = await marketPnl.json();

    console.log('   Sample query:');
    console.log(`   Aggregate unrealized P&L per market`);
    console.log('\n   Sample response:');
    console.log(JSON.stringify(marketPnlData, null, 2));
    console.log('\n');

    // 4. Combined realized + unrealized P&L (TOTAL P&L)
    console.log('4. TOTAL P&L (REALIZED + UNREALIZED)');
    console.log('   Use case: Complete wallet intelligence dashboard\n');

    const totalPnl = await client.query({
      query: `
        SELECT
          wallet_address,
          ROUND(SUM(realized_pnl_usd), 2) as total_realized_pnl,
          ROUND(SUM(unrealized_pnl_usd), 2) as total_unrealized_pnl,
          ROUND(SUM(realized_pnl_usd) + SUM(unrealized_pnl_usd), 2) as total_pnl,
          COUNT(*) as total_trades,
          COUNT(DISTINCT market_id) as markets_traded
        FROM trades_raw
        WHERE wallet_address != ''
        GROUP BY wallet_address
        ORDER BY (SUM(realized_pnl_usd) + SUM(unrealized_pnl_usd)) DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const totalPnlData: any = await totalPnl.json();

    console.log('   Sample query:');
    console.log(`   Total P&L = Realized + Unrealized`);
    console.log('\n   Sample response:');
    console.log(JSON.stringify(totalPnlData, null, 2));
    console.log('\n');

    // 5. Portfolio summary (wallet intelligence)
    console.log('5. PORTFOLIO SUMMARY (WALLET INTELLIGENCE)');
    console.log('   Use case: Complete wallet profile with all metrics\n');

    // Pick a wallet for demo
    const demoWallet = totalPnlData[0].wallet_address;

    const portfolioSummary = await client.query({
      query: `
        WITH wallet_stats AS (
          SELECT
            wallet_address,
            SUM(realized_pnl_usd) as realized_pnl,
            SUM(unrealized_pnl_usd) as unrealized_pnl,
            COUNT(*) as total_trades,
            COUNT(DISTINCT market_id) as markets_traded,
            SUM(toFloat64(shares) * toFloat64(entry_price)) as total_invested
          FROM trades_raw
          WHERE wallet_address = '${demoWallet}'
          GROUP BY wallet_address
        )
        SELECT
          wallet_address,
          ROUND(realized_pnl, 2) as realized_pnl_usd,
          ROUND(unrealized_pnl, 2) as unrealized_pnl_usd,
          ROUND(realized_pnl + unrealized_pnl, 2) as total_pnl_usd,
          total_trades,
          markets_traded,
          ROUND(total_invested, 2) as total_invested_usd,
          ROUND((realized_pnl + unrealized_pnl) / NULLIF(total_invested, 0) * 100, 2) as roi_pct
        FROM wallet_stats
      `,
      format: 'JSONEachRow'
    });
    const portfolioData: any = await portfolioSummary.json();

    console.log(`   Sample query for wallet: ${demoWallet}`);
    console.log('\n   Sample response:');
    console.log(JSON.stringify(portfolioData, null, 2));
    console.log('\n');

    // 6. API endpoint suggestions
    console.log('6. SUGGESTED API ENDPOINTS\n');

    console.log('   GET /api/wallet/:address/pnl');
    console.log('   - Returns: realized, unrealized, total P&L for wallet\n');

    console.log('   GET /api/leaderboard/unrealized-pnl');
    console.log('   - Returns: Top wallets by unrealized P&L\n');

    console.log('   GET /api/market/:id/pnl');
    console.log('   - Returns: Aggregate unrealized P&L for market\n');

    console.log('   GET /api/wallet/:address/portfolio');
    console.log('   - Returns: Complete portfolio summary (realized + unrealized + ROI)\n');

    console.log('   GET /api/wallet/:address/positions');
    console.log('   - Returns: Individual positions with unrealized P&L per market\n');

    console.log('════════════════════════════════════════════════════════════════════');
    console.log('✅ API EXAMPLES COMPLETE');
    console.log('════════════════════════════════════════════════════════════════════\n');

    console.log('NEXT STEPS:');
    console.log('  1. Create API endpoints in /src/app/api/');
    console.log('  2. Connect to frontend dashboard components');
    console.log('  3. Add real-time updates via WebSocket (optional)');
    console.log('  4. Build portfolio intelligence visualizations\n');

    await client.close();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('\nFull error:', error);
    await client.close();
    process.exit(1);
  }
})();
