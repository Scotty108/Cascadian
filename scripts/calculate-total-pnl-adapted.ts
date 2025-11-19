#!/usr/bin/env npx tsx
/**
 * Calculate Total P&L (Realized + Unrealized) - Adapted for Cascadian Schema
 *
 * This script adapts the unrealized P&L approach to work with our actual schema:
 * - vw_wallet_pnl_calculated (positions with realized P&L)
 * - market_candles_5m (current prices)
 *
 * Creates: vw_wallet_total_pnl (realized + unrealized combined)
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000 // 5 minutes
});

async function main() {
  console.log('\n💰 TOTAL P&L CALCULATION - ADAPTED FOR CASCADIAN SCHEMA\n');
  console.log('═'.repeat(100));

  try {
    // Step 1: Get latest prices from market_candles_5m
    console.log('\n📊 Step 1: Creating latest price view...\n');

    await ch.query({
      query: `
        CREATE OR REPLACE VIEW default.vw_latest_market_prices AS
        WITH latest_candles AS (
          SELECT
            market_id,
            outcome,
            close_price,
            timestamp,
            ROW_NUMBER() OVER (PARTITION BY market_id, outcome ORDER BY timestamp DESC) as rn
          FROM default.market_candles_5m
          WHERE close_price > 0
        )
        SELECT
          lower(replaceAll(market_id, '0x', '')) as condition_id_norm,
          outcome as outcome_index,
          close_price as current_price
        FROM latest_candles
        WHERE rn = 1
      `
    });

    console.log('  ✅ Created vw_latest_market_prices');

    // Step 2: Create enhanced P&L view with unrealized calculation
    console.log('\n📈 Step 2: Creating total P&L view (realized + unrealized)...\n');

    await ch.query({
      query: `
        CREATE OR REPLACE VIEW default.vw_wallet_total_pnl AS
        SELECT
          p.wallet,
          p.condition_id,
          p.outcome_index,
          p.net_shares,
          p.cost_basis,

          -- Realized P&L (from settled positions)
          p.realized_pnl_usd as realized_pnl,

          -- Unrealized P&L (from open positions using current prices)
          CASE
            WHEN p.payout_denominator > 0 THEN NULL  -- Already settled
            WHEN pr.current_price IS NOT NULL THEN
              (p.net_shares * pr.current_price) - p.cost_basis
            ELSE NULL  -- No current price available
          END as unrealized_pnl,

          -- Total P&L (realized + unrealized)
          COALESCE(p.realized_pnl_usd, 0) + COALESCE(unrealized_pnl, 0) as total_pnl,

          -- Price data
          pr.current_price,
          CASE
            WHEN p.cost_basis > 0 THEN p.cost_basis / p.net_shares
            ELSE NULL
          END as entry_price,

          -- Position metadata
          p.first_trade,
          p.last_trade,
          p.num_trades,
          p.payout_denominator,
          p.winning_outcome,

          -- Status
          CASE
            WHEN p.payout_denominator > 0 THEN 'settled'
            WHEN unrealized_pnl IS NOT NULL THEN 'open_with_price'
            ELSE 'open_no_price'
          END as position_status

        FROM default.vw_wallet_pnl_calculated p
        LEFT JOIN default.vw_latest_market_prices pr
          ON lower(replaceAll(p.condition_id, '0x', '')) = pr.condition_id_norm
          AND p.outcome_index = pr.outcome_index
        WHERE p.net_shares > 0.001  -- Filter dust positions
      `
    });

    console.log('  ✅ Created vw_wallet_total_pnl');

    // Step 3: Create wallet-level aggregates
    console.log('\n📋 Step 3: Creating wallet-level aggregate view...\n');

    await ch.query({
      query: `
        CREATE OR REPLACE VIEW default.vw_wallet_pnl_summary AS
        SELECT
          wallet,

          -- Realized P&L
          SUM(CASE WHEN position_status = 'settled' THEN realized_pnl ELSE 0 END) as total_realized_pnl,
          COUNT(CASE WHEN position_status = 'settled' THEN 1 END) as settled_positions,

          -- Unrealized P&L
          SUM(CASE WHEN position_status IN ('open_with_price', 'open_no_price') THEN unrealized_pnl ELSE 0 END) as total_unrealized_pnl,
          COUNT(CASE WHEN position_status = 'open_with_price' THEN 1 END) as open_positions_with_price,
          COUNT(CASE WHEN position_status = 'open_no_price' THEN 1 END) as open_positions_no_price,

          -- Total P&L
          total_realized_pnl + total_unrealized_pnl as total_pnl,

          -- Position counts
          COUNT(*) as total_positions,
          COUNT(DISTINCT condition_id) as unique_markets,

          -- Investment metrics
          SUM(cost_basis) as total_invested,
          CASE
            WHEN total_invested > 0 THEN (total_pnl / total_invested) * 100
            ELSE 0
          END as roi_percentage,

          -- Timestamps
          MIN(first_trade) as first_trade_timestamp,
          MAX(last_trade) as last_trade_timestamp

        FROM default.vw_wallet_total_pnl
        GROUP BY wallet
      `
    });

    console.log('  ✅ Created vw_wallet_pnl_summary');

    // Step 4: Test with our 3 wallets
    console.log('\n🧪 Step 4: Testing with 3 wallets...\n');

    const testWallets = [
      { address: '0x4ce73141dbfce41e65db3723e31059a730f0abad', polymarket: 332566.88 },
      { address: '0x9155e8cf81a3fb557639d23d43f1528675bcfcad', polymarket: 110012.87 },
      { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', polymarket: 95149.59 }
    ];

    console.log('═'.repeat(100));

    for (const wallet of testWallets) {
      const result = await ch.query({
        query: `
          SELECT
            wallet,
            ROUND(total_realized_pnl, 2) as realized,
            ROUND(total_unrealized_pnl, 2) as unrealized,
            ROUND(total_pnl, 2) as total,
            settled_positions,
            open_positions_with_price,
            open_positions_no_price,
            ROUND(roi_percentage, 2) as roi_pct
          FROM default.vw_wallet_pnl_summary
          WHERE lower(wallet) = lower('${wallet.address}')
        `,
        format: 'JSONEachRow'
      });

      const data = await result.json();

      if (data.length === 0) {
        console.log(`\n❌ ${wallet.address.substring(0, 10)}... - No data found`);
        continue;
      }

      const w = data[0];
      const diff = parseFloat(w.total) - wallet.polymarket;
      const accuracy = 100 - Math.abs(diff / wallet.polymarket * 100);

      console.log(`\n📊 ${wallet.address.substring(0, 10)}...`);
      console.log(`  Realized P&L:        $${parseFloat(w.realized).toLocaleString()}`);
      console.log(`  Unrealized P&L:      $${parseFloat(w.unrealized).toLocaleString()}`);
      console.log(`  ─────────────────────────────────`);
      console.log(`  Total P&L:           $${parseFloat(w.total).toLocaleString()}`);
      console.log(`  Polymarket shows:    $${wallet.polymarket.toLocaleString()}`);
      console.log(`  Difference:          $${diff.toLocaleString()} (${accuracy.toFixed(1)}% accurate)`);
      console.log(`  `);
      console.log(`  Positions: ${w.settled_positions} settled, ${w.open_positions_with_price} open (with price), ${w.open_positions_no_price} open (no price)`);
      console.log(`  ROI: ${parseFloat(w.roi_pct).toFixed(2)}%`);

      if (accuracy >= 95) {
        console.log(`  ✅ EXCELLENT MATCH`);
      } else if (accuracy >= 90) {
        console.log(`  ✅ GOOD MATCH`);
      } else if (accuracy >= 80) {
        console.log(`  ⚠️  ACCEPTABLE`);
      } else {
        console.log(`  ❌ NEEDS INVESTIGATION`);
      }
    }

    console.log('\n═'.repeat(100));
    console.log('\n✅ TOTAL P&L CALCULATION COMPLETE\n');
    console.log('Views created:');
    console.log('  - vw_latest_market_prices (current prices)');
    console.log('  - vw_wallet_total_pnl (position-level with realized + unrealized)');
    console.log('  - vw_wallet_pnl_summary (wallet-level aggregates)');
    console.log('\nQuery examples:');
    console.log('  SELECT * FROM vw_wallet_pnl_summary WHERE wallet = \'0x...\'');
    console.log('  SELECT * FROM vw_wallet_total_pnl WHERE wallet = \'0x...\' ORDER BY total_pnl DESC');
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('UNKNOWN_TABLE')) {
      console.error('\nThe required tables do not exist. Please ensure:');
      console.error('  - market_candles_5m table has data');
      console.error('  - vw_wallet_pnl_calculated view exists');
    }
    throw error;
  } finally {
    await ch.close();
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
