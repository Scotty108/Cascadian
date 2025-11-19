#!/usr/bin/env npx tsx
/**
 * Simple Total P&L - Works with existing Cascadian schema
 *
 * Uses:
 * - vw_wallet_pnl_calculated (positions with realized P&L)
 * - fact_trades_clean (for latest trade prices as proxy for current price)
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000
});

async function main() {
  console.log('\n💰 SIMPLE TOTAL P&L CALCULATION\n');
  console.log('═'.repeat(100));

  try {
    // Create a view with latest trade price per condition/outcome as proxy for current price
    console.log('\n📊 Creating latest price view from recent trades...\n');

    await ch.query({
      query: `
        CREATE OR REPLACE VIEW default.vw_latest_trade_prices AS
        WITH latest_trades AS (
          SELECT
            lower(replaceAll(cid, '0x', '')) as condition_id_norm,
            outcome_index,
            price,
            block_time,
            ROW_NUMBER() OVER (PARTITION BY condition_id_norm, outcome_index ORDER BY block_time DESC) as rn
          FROM default.fact_trades_clean
          WHERE price > 0
            AND block_time >= now() - INTERVAL 30 DAY  -- Only recent trades
        )
        SELECT
          condition_id_norm,
          outcome_index,
          price as latest_price,
          block_time as last_trade_time
        FROM latest_trades
        WHERE rn = 1
      `
    });

    console.log('  ✅ Created vw_latest_trade_prices (using 30-day recent trades)');

    // Create enhanced total P&L view
    console.log('\n📈 Creating total P&L view...\n');

    await ch.query({
      query: `
        CREATE OR REPLACE VIEW default.vw_wallet_total_pnl AS
        SELECT
          p.wallet,
          p.condition_id,
          p.outcome_index,
          p.net_shares,
          p.cost_basis,

          -- Entry price (average)
          CASE
            WHEN toFloat64(p.net_shares) > 0 THEN toFloat64(p.cost_basis) / toFloat64(p.net_shares)
            ELSE 0
          END as entry_price,

          -- Realized P&L (settled positions)
          p.realized_pnl_usd as realized_pnl,

          -- Current price (from recent trades)
          toFloat64(lp.latest_price) as current_price,
          lp.last_trade_time,

          -- Unrealized P&L (open positions valued at current price)
          CASE
            WHEN p.payout_denominator > 0 THEN NULL  -- Already settled
            WHEN lp.latest_price IS NOT NULL AND toFloat64(p.net_shares) > 0 THEN
              (toFloat64(p.net_shares) * toFloat64(lp.latest_price)) - toFloat64(p.cost_basis)
            ELSE NULL
          END as unrealized_pnl,

          -- Total P&L
          COALESCE(p.realized_pnl_usd, 0) + COALESCE(unrealized_pnl, 0) as total_pnl,

          -- Metadata
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
          END as status

        FROM default.vw_wallet_pnl_calculated p
        LEFT JOIN default.vw_latest_trade_prices lp
          ON lower(replaceAll(p.condition_id, '0x', '')) = lp.condition_id_norm
          AND p.outcome_index = lp.outcome_index
        WHERE toFloat64(p.net_shares) > 0.001  -- Filter dust
      `
    });

    console.log('  ✅ Created vw_wallet_total_pnl');

    // Create wallet summary
    console.log('\n📋 Creating wallet summary view...\n');

    await ch.query({
      query: `
        CREATE OR REPLACE VIEW default.vw_wallet_pnl_summary AS
        SELECT
          wallet,

          -- Realized P&L
          SUM(CASE WHEN status = 'settled' THEN realized_pnl ELSE 0 END) as total_realized_pnl,
          COUNT(CASE WHEN status = 'settled' THEN 1 END) as settled_positions,

          -- Unrealized P&L
          SUM(CASE WHEN status IN ('open_with_price', 'open_no_price') THEN COALESCE(unrealized_pnl, 0) ELSE 0 END) as total_unrealized_pnl,
          COUNT(CASE WHEN status = 'open_with_price' THEN 1 END) as open_with_price,
          COUNT(CASE WHEN status = 'open_no_price' THEN 1 END) as open_no_price,

          -- Total
          total_realized_pnl + total_unrealized_pnl as total_pnl,

          -- Stats
          COUNT(*) as total_positions,
          COUNT(DISTINCT condition_id) as unique_markets,
          SUM(toFloat64(cost_basis)) as total_invested,
          CASE
            WHEN total_invested > 0 THEN (total_pnl / total_invested) * 100
            ELSE 0
          END as roi_pct,

          MIN(first_trade) as first_trade,
          MAX(last_trade) as last_trade

        FROM default.vw_wallet_total_pnl
        GROUP BY wallet
      `
    });

    console.log('  ✅ Created vw_wallet_pnl_summary');

    // Test with 3 wallets
    console.log('\n🧪 Testing with 3 wallets...\n');
    console.log('═'.repeat(100));

    const testWallets = [
      { address: '0x4ce73141dbfce41e65db3723e31059a730f0abad', polymarket: 332566.88, name: 'Wallet #1' },
      { address: '0x9155e8cf81a3fb557639d23d43f1528675bcfcad', polymarket: 110012.87, name: 'Wallet #2' },
      { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', polymarket: 95149.59, name: 'Wallet #3' }
    ];

    for (const wallet of testWallets) {
      const result = await ch.query({
        query: `
          SELECT
            wallet,
            ROUND(total_realized_pnl, 2) as realized,
            ROUND(total_unrealized_pnl, 2) as unrealized,
            ROUND(total_pnl, 2) as total,
            settled_positions,
            open_with_price,
            open_no_price,
            total_positions,
            ROUND(roi_pct, 2) as roi
          FROM default.vw_wallet_pnl_summary
          WHERE lower(wallet) = lower('${wallet.address}')
        `,
        format: 'JSONEachRow'
      });

      const data = await result.json();

      if (data.length === 0) {
        console.log(`\n❌ ${wallet.name} (${wallet.address.substring(0, 10)}...)`);
        console.log(`   No data found`);
        continue;
      }

      const w = data[0];
      const diff = parseFloat(w.total) - wallet.polymarket;
      const accuracy = 100 - Math.abs(diff / wallet.polymarket * 100);

      console.log(`\n📊 ${wallet.name} (${wallet.address.substring(0, 10)}...)`);
      console.log(`   Realized P&L:        $${parseFloat(w.realized).toLocaleString()}`);
      console.log(`   Unrealized P&L:      $${parseFloat(w.unrealized).toLocaleString()}`);
      console.log(`   ─────────────────────────────────────`);
      console.log(`   Total P&L:           $${parseFloat(w.total).toLocaleString()}`);
      console.log(`   Polymarket shows:    $${wallet.polymarket.toLocaleString()}`);
      console.log(`   Difference:          $${diff.toLocaleString()}`);
      console.log(`   Accuracy:            ${accuracy.toFixed(1)}%`);
      console.log(``);
      console.log(`   Positions: ${w.settled_positions} settled, ${w.open_with_price} open (priced), ${w.open_no_price} open (no price)`);
      console.log(`   Total: ${w.total_positions} positions`);
      console.log(`   ROI: ${parseFloat(w.roi).toFixed(2)}%`);

      if (accuracy >= 95) {
        console.log(`   ✅ EXCELLENT MATCH`);
      } else if (accuracy >= 90) {
        console.log(`   ✅ GOOD MATCH`);
      } else if (accuracy >= 80) {
        console.log(`   ⚠️  ACCEPTABLE`);
      } else if (accuracy >= 50) {
        console.log(`   ⚠️  PARTIAL MATCH - May need price data update`);
      } else {
        console.log(`   ❌ NEEDS INVESTIGATION`);
      }
    }

    console.log('\n═'.repeat(100));
    console.log('\n✅ TOTAL P&L CALCULATION COMPLETE\n');
    console.log('Views created:');
    console.log('  - vw_latest_trade_prices (proxy for current prices using recent trades)');
    console.log('  - vw_wallet_total_pnl (position-level with realized + unrealized)');
    console.log('  - vw_wallet_pnl_summary (wallet-level aggregates)');
    console.log('\nQuery examples:');
    console.log('  SELECT * FROM vw_wallet_pnl_summary WHERE wallet = \'0x...\'');
    console.log('  SELECT * FROM vw_wallet_total_pnl WHERE wallet = \'0x...\' ORDER BY total_pnl DESC');
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await ch.close();
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
