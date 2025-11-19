#!/usr/bin/env npx tsx
/**
 * FIX: Polymarket-style P&L calculation
 *
 * KEY INSIGHT: Polymarket calculates "realized" P&L on EVERY sell,
 * not just when positions are fully closed to zero shares.
 *
 * Realized P&L = All cash from sells - All cash paid for buys
 * Unrealized P&L = (Current shares * current price) - remaining cost basis
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('FIXING P&L CALCULATION - POLYMARKET METHOD');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // The key insight: Realized P&L is simply net cash flow from ALL trades
  // Not just from "closed" positions!

  console.log('Creating corrected trading P&L view...');
  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_polymarket_style AS
      SELECT
        wallet,
        market_cid,
        outcome,
        /* Current position */
        sum(d_shares) AS current_shares,
        /* Net cash flow = realized P&L in Polymarket's terms
           Positive d_cash = received from sells
           Negative d_cash = paid for buys
           Sum = net P&L from all trading activity */
        sum(d_cash) AS realized_pnl_usd,
        /* Average cost per share of remaining position */
        if(sum(d_shares) != 0,
           -sum(d_cash) / nullIf(sum(d_shares), 0),
           0.0) AS avg_cost_per_share,
        /* Position status */
        if(abs(sum(d_shares)) < 0.01, 'CLOSED', 'OPEN') AS status
      FROM cascadian_clean.vw_trades_ledger
      GROUP BY wallet, market_cid, outcome
    `
  });
  console.log('✓ Created vw_trading_pnl_polymarket_style\n');

  console.log('Creating wallet-level summary...');
  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_polymarket_style AS
      WITH trading AS (
        SELECT
          wallet,
          sum(realized_pnl_usd) AS trading_realized_pnl,
          countIf(status = 'CLOSED') AS closed_positions,
          countIf(status = 'OPEN') AS open_positions
        FROM cascadian_clean.vw_trading_pnl_polymarket_style
        GROUP BY wallet
      ),
      unreal AS (
        SELECT
          wallet,
          sum(unrealized_pnl_usd) AS unrealized_pnl
        FROM cascadian_clean.vw_positions_open
        GROUP BY wallet
      ),
      redeem AS (
        SELECT
          wallet,
          sum(redemption_pnl_usd) AS redemption_pnl
        FROM cascadian_clean.vw_redemption_pnl
        GROUP BY wallet
      )
      SELECT
        coalesce(t.wallet, u.wallet, r.wallet) AS wallet,
        coalesce(t.trading_realized_pnl, 0.0) AS trading_realized_pnl,
        coalesce(r.redemption_pnl, 0.0) AS redemption_pnl,
        coalesce(t.trading_realized_pnl, 0.0) + coalesce(r.redemption_pnl, 0.0) AS total_realized_pnl,
        coalesce(u.unrealized_pnl, 0.0) AS unrealized_pnl,
        coalesce(t.trading_realized_pnl, 0.0) + coalesce(r.redemption_pnl, 0.0) + coalesce(u.unrealized_pnl, 0.0) AS total_pnl,
        coalesce(t.closed_positions, 0) AS closed_positions,
        coalesce(t.open_positions, 0) AS open_positions
      FROM trading t
      FULL OUTER JOIN unreal u ON u.wallet = t.wallet
      FULL OUTER JOIN redeem r ON r.wallet = coalesce(t.wallet, u.wallet)
      ORDER BY total_realized_pnl DESC
    `
  });
  console.log('✓ Created vw_wallet_pnl_polymarket_style\n');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('FIXED! Now testing with sample wallets...');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const TEST_WALLETS = [
    { address: '0x4ce73141dbfce41e65db3723e31059a730f0abad', polymarket: 332563 },
    { address: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', polymarket: 114087 },
    { address: '0x1f0a343513aa6060488fabe96960e6d1e177f7aa', polymarket: 101576 },
  ];

  console.log('┌─────────────────┬──────────────┬──────────────┬──────────────┐');
  console.log('│ Wallet          │ Polymarket   │ Our Realized │ Difference   │');
  console.log('├─────────────────┼──────────────┼──────────────┼──────────────┤');

  for (const wallet of TEST_WALLETS) {
    const result = await ch.query({
      query: `
        SELECT
          trading_realized_pnl,
          redemption_pnl,
          total_realized_pnl,
          unrealized_pnl,
          total_pnl
        FROM cascadian_clean.vw_wallet_pnl_polymarket_style
        WHERE lower(wallet) = lower('${wallet.address}')
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });

    const data = await result.json<any[]>();

    if (data.length > 0) {
      const p = data[0];
      const ourRealized = parseFloat(p.total_realized_pnl);
      const diff = ourRealized - wallet.polymarket;
      const pct = (diff / wallet.polymarket) * 100;

      const addrShort = wallet.address.substring(0, 17) + '...';
      const polyStr = `$${wallet.polymarket.toLocaleString()}`;
      const ourStr = `$${ourRealized.toFixed(0)}`;
      const diffStr = `${diff >= 0 ? '+' : ''}$${diff.toFixed(0)} (${pct.toFixed(1)}%)`;

      console.log(
        `│ ${addrShort.padEnd(15)} │ ${polyStr.padStart(12)} │ ${ourStr.padStart(12)} │ ${diffStr.padStart(12)} │`
      );
    }
  }

  console.log('└─────────────────┴──────────────┴──────────────┴──────────────┘');
  console.log('');

  await ch.close();
}

main().catch(console.error);
