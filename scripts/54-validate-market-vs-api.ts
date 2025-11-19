import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Using 2nd market from top list (1st has empty cid_norm)
const VALIDATION_MARKET_CID = 'c007c362e141a1ca09695be93d8d93cc44a6f93d0cbd735c7f4c0e8f1fc46e45';

async function validateMarketVsAPI() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 VALIDATING MARKET AGAINST POLYMARKET API');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log(`Wallet:       ${XCN_WALLET}`);
  console.log(`Market CID:   ${VALIDATION_MARKET_CID}\n`);

  try {
    // Step 1: Calculate PnL from canonical view
    console.log('STEP 1: Calculating PnL from canonical view...\n');

    const dbQuery = `
      SELECT
        count() AS total_trades,
        sum(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END) AS buy_cash,
        sum(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) AS sell_cash,
        sum(CASE WHEN trade_direction = 'BUY' THEN shares ELSE 0 END) AS buy_shares,
        sum(CASE WHEN trade_direction = 'SELL' THEN shares ELSE 0 END) AS sell_shares,
        uniq(outcome_index_v2) AS outcomes,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = '${XCN_WALLET.toLowerCase()}'
        AND cid_norm = '${VALIDATION_MARKET_CID}'
    `;

    const dbResult = await clickhouse.query({ query: dbQuery, format: 'JSONEachRow' });
    const dbData = await dbResult.json<any[]>();
    const db = dbData[0];

    const cost = Number(db.buy_cash);
    const proceeds = Number(db.sell_cash);
    const net_shares = Number(db.buy_shares) - Number(db.sell_shares);
    const trade_pnl = proceeds - cost;

    console.log('Database (Canonical View):');
    console.log(`  Total trades:    ${Number(db.total_trades).toLocaleString()}`);
    console.log(`  Buy cash:        $${cost.toLocaleString()}`);
    console.log(`  Sell cash:       $${proceeds.toLocaleString()}`);
    console.log(`  Net shares:      ${net_shares.toLocaleString()}`);
    console.log(`  Trade PnL:       $${trade_pnl.toLocaleString()}`);
    console.log(`  Outcomes:        ${db.outcomes}`);
    console.log(`  Date range:      ${db.first_trade} to ${db.last_trade}\n`);

    // Step 2: Fetch from Polymarket API
    console.log('STEP 2: Fetching from Polymarket API...\n');

    const apiUrl = `https://data-api.polymarket.com/positions?user=${XCN_WALLET}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      console.log(`❌ API request failed: ${response.status} ${response.statusText}\n`);
      return { success: false, error: 'API request failed' };
    }

    const apiData = await response.json();
    console.log(`Fetched ${apiData.length} positions from Polymarket API\n`);

    // Find our market
    const targetConditionId = '0x' + VALIDATION_MARKET_CID;
    const position = apiData.find((p: any) =>
      p.conditionId?.toLowerCase() === targetConditionId.toLowerCase()
    );

    if (!position) {
      console.log(`⚠️  Market ${VALIDATION_MARKET_CID.substring(0, 16)}... not found in API positions\n`);
      console.log('This could mean:');
      console.log('1. Position was closed (no current holdings)');
      console.log('2. Market is old and not in recent data');
      console.log('3. Condition ID format mismatch\n');

      console.log('Available markets in API (first 10):');
      apiData.slice(0, 10).forEach((p: any, i: number) => {
        const cid = p.conditionId?.replace(/^0x/, '') || 'unknown';
        console.log(`${(i+1).toString().padStart(2)}. ${cid.substring(0, 16)}... - ${p.market || 'Unknown'}`);
      });
      console.log('');

      // Try to find by searching partial CID
      const partial = VALIDATION_MARKET_CID.substring(0, 16);
      const partialMatch = apiData.find((p: any) =>
        p.conditionId?.toLowerCase().includes(partial.toLowerCase())
      );

      if (partialMatch) {
        console.log(`Found partial match: ${partialMatch.market}`);
        console.log(`Full CID: ${partialMatch.conditionId}\n`);
      }

      return {
        success: false,
        error: 'Market not in current API positions',
        db_stats: {
          trades: Number(db.total_trades),
          cost,
          net_shares,
          trade_pnl
        }
      };
    }

    // Step 3: Compare
    console.log('STEP 3: Comparing database vs API...\n');

    console.log('Polymarket API:');
    console.log(`  Market:          ${position.market}`);
    console.log(`  Outcome:         ${position.outcome}`);
    console.log(`  Size (shares):   ${position.size?.toLocaleString()}`);
    console.log(`  Initial cost:    $${position.initialValue?.toLocaleString()}`);
    console.log(`  Current value:   $${position.value?.toLocaleString()}`);
    console.log(`  Cash PnL:        $${position.pnl?.toLocaleString()}\n`);

    // Validation
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('VALIDATION');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const api_cost = position.initialValue || 0;
    const api_shares = position.size || 0;
    const api_pnl = position.pnl || 0;

    const cost_tolerance = 0.10; // 10%
    const shares_tolerance = 0.10; // 10%

    const cost_match = Math.abs(cost - api_cost) / Math.max(api_cost, 1) < cost_tolerance;
    const shares_match = Math.abs(net_shares - api_shares) / Math.max(Math.abs(api_shares), 1) < shares_tolerance;

    const cost_diff_pct = api_cost > 0 ? ((cost / api_cost - 1) * 100).toFixed(1) : 'N/A';
    const shares_diff_pct = api_shares > 0 ? ((net_shares / api_shares - 1) * 100).toFixed(1) : 'N/A';

    console.log(`Cost:       ${cost_match ? '✅' : '❌'} DB: $${cost.toLocaleString()} vs API: $${api_cost.toLocaleString()} (${cost_diff_pct}% diff)`);
    console.log(`Shares:     ${shares_match ? '✅' : '❌'} DB: ${net_shares.toLocaleString()} vs API: ${api_shares.toLocaleString()} (${shares_diff_pct}% diff)`);
    console.log(`PnL:        ℹ️  DB: $${trade_pnl.toLocaleString()} vs API: $${api_pnl.toLocaleString()} (trade-only vs total)\n`);

    if (cost_match && shares_match) {
      console.log('🟢 VALIDATION PASSED: Cost and shares match within 10% tolerance\n');
      return {
        success: true,
        market: position.market,
        validated: true
      };
    } else {
      console.log('🟡 VALIDATION FAILED: Mismatch exceeds tolerance\n');
      return {
        success: false,
        error: 'Validation mismatch',
        details: {
          cost_diff: cost - api_cost,
          shares_diff: net_shares - api_shares
        }
      };
    }

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    console.error(error);
    return { success: false, error: error.message };
  }
}

validateMarketVsAPI().catch(console.error);
