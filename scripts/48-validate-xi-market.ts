import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// Ground truth from Polymarket API
const GROUND_TRUTH = {
  market: 'Xi Jinping out in 2025?',
  condition_id: '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  cid_norm: 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  cost: 63443, // initialValue from API
  shares: 69983, // size from API
  current_value: 68408,
  cash_pnl: 4966
};

async function validateXiMarket() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🎯 STEP 3: One-Market Validation (Xi Jinping 2025)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Ground Truth from Polymarket API:');
  console.log(`  Market:        ${GROUND_TRUTH.market}`);
  console.log(`  Condition ID:  ${GROUND_TRUTH.condition_id}`);
  console.log(`  Initial Cost:  $${GROUND_TRUTH.cost.toLocaleString()}`);
  console.log(`  Net Shares:    ${GROUND_TRUTH.shares.toLocaleString()}`);
  console.log(`  Current Value: $${GROUND_TRUTH.current_value.toLocaleString()}`);
  console.log(`  Cash PnL:      $${GROUND_TRUTH.cash_pnl.toLocaleString()}\n`);

  try {
    // First, check if market exists in our view
    console.log('Checking if Xi market exists in vw_xcn_pnl_source...\n');

    const existsQuery = `
      SELECT count() AS trades
      FROM vw_xcn_pnl_source
      WHERE cid_norm = '${GROUND_TRUTH.cid_norm}'
    `;

    const existsResult = await clickhouse.query({ query: existsQuery, format: 'JSONEachRow' });
    const existsData = await existsResult.json<any[]>();
    const tradeCount = Number(existsData[0].trades);

    if (tradeCount === 0) {
      console.log('❌ Xi market NOT FOUND in vw_xcn_pnl_source');
      console.log('   This means the wallet has no trades in this market in our DB.\n');
      return { success: false, error: 'Market not found' };
    }

    console.log(`✅ Found ${tradeCount} trades in Xi market\n`);

    // Calculate PnL (trade-only, no settlement yet)
    console.log('Calculating trade-only PnL...\n');

    const pnlQuery = `
      SELECT
        sumIf(usd_value, trade_direction='BUY') AS buy_cash,
        sumIf(usd_value, trade_direction='SELL') AS sell_cash,
        sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
        sell_cash - buy_cash AS trade_pnl,
        count() AS trades,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM vw_xcn_pnl_source
      WHERE cid_norm = '${GROUND_TRUTH.cid_norm}'
    `;

    const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
    const pnlData = await pnlResult.json<any[]>();
    const result = pnlData[0];

    const buy_cash = Number(result.buy_cash);
    const sell_cash = Number(result.sell_cash);
    const net_shares = Number(result.net_shares);
    const trade_pnl = Number(result.trade_pnl);

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('DATABASE RESULTS');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log(`Trades:       ${Number(result.trades).toLocaleString()}`);
    console.log(`Buy Cash:     $${buy_cash.toLocaleString()}`);
    console.log(`Sell Cash:    $${sell_cash.toLocaleString()}`);
    console.log(`Net Shares:   ${net_shares.toLocaleString()}`);
    console.log(`Trade PnL:    $${trade_pnl.toLocaleString()}`);
    console.log(`Date Range:   ${result.first_trade} to ${result.last_trade}\n`);

    // Validation
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('VALIDATION');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const cost_match = Math.abs(buy_cash - GROUND_TRUTH.cost) / GROUND_TRUTH.cost < 0.05; // 5% tolerance
    const shares_match = Math.abs(net_shares - GROUND_TRUTH.shares) / GROUND_TRUTH.shares < 0.05;
    const pnl_match = Math.abs(trade_pnl - GROUND_TRUTH.cash_pnl) / Math.abs(GROUND_TRUTH.cash_pnl) < 0.50; // 50% tolerance for PnL

    console.log(`Cost (Buy Cash):  ${cost_match ? '✅' : '❌'} Expected $${GROUND_TRUTH.cost.toLocaleString()}, Got $${buy_cash.toLocaleString()} (${((buy_cash / GROUND_TRUTH.cost - 1) * 100).toFixed(1)}% diff)`);
    console.log(`Net Shares:       ${shares_match ? '✅' : '❌'} Expected ${GROUND_TRUTH.shares.toLocaleString()}, Got ${net_shares.toLocaleString()} (${((net_shares / GROUND_TRUTH.shares - 1) * 100).toFixed(1)}% diff)`);
    console.log(`Trade PnL:        ${pnl_match ? '✅' : '❌'} Expected $${GROUND_TRUTH.cash_pnl.toLocaleString()}, Got $${trade_pnl.toLocaleString()} (${((trade_pnl / GROUND_TRUTH.cash_pnl - 1) * 100).toFixed(1)}% diff)\n`);

    // Check outcome distribution
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('OUTCOME ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const outcomeQuery = `
      SELECT
        outcome_index_v3,
        trade_direction,
        count() AS trades,
        sum(shares) AS total_shares,
        sum(usd_value) AS total_usd
      FROM vw_xcn_pnl_source
      WHERE cid_norm = '${GROUND_TRUTH.cid_norm}'
      GROUP BY outcome_index_v3, trade_direction
      ORDER BY outcome_index_v3, trade_direction
    `;

    const outcomeResult = await clickhouse.query({ query: outcomeQuery, format: 'JSONEachRow' });
    const outcomeData = await outcomeResult.json<any[]>();

    console.log('Outcome | Direction | Trades | Shares       | USD Value');
    console.log('--------|-----------|--------|--------------|-------------');
    outcomeData.forEach(row => {
      const outcome = String(row.outcome_index_v3).padEnd(7);
      const dir = String(row.trade_direction).padEnd(9);
      const trades = Number(row.trades).toLocaleString().padStart(6);
      const shares = Number(row.total_shares).toLocaleString().padStart(12);
      const usd = '$' + Number(row.total_usd).toLocaleString().padStart(11);
      console.log(`${outcome} | ${dir} | ${trades} | ${shares} | ${usd}`);
    });
    console.log('');

    // Final verdict
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('VERDICT');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    if (cost_match && shares_match) {
      console.log('🟢 GREEN LIGHT: Cost and shares match Polymarket API!');
      console.log('   vw_xcn_pnl_source is validated for this market.\n');

      if (!pnl_match) {
        console.log('⚠️  Note: Trade PnL differs from API cash PnL');
        console.log('   This is expected if:');
        console.log('   - Market is unresolved (no settlement PnL)');
        console.log('   - API includes fees we don\'t have');
        console.log('   - Position still open (unrealized gains)\n');
      }

      console.log('Next step: Run Step 4 (collision check)\n');
      return { success: true, validated_market: GROUND_TRUTH.market };

    } else {
      console.log('🟡 YELLOW LIGHT: Mismatch detected');
      console.log('   Investigate discrepancies before proceeding.\n');
      return { success: false, error: 'Validation mismatch' };
    }

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    return { success: false, error: error.message };
  }
}

validateXiMarket().catch(console.error);
