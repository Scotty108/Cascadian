#!/usr/bin/env npx tsx
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
  console.log('Fixing remaining views...\n');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_unified AS
      WITH agg AS (
        SELECT
          wallet,
          sum(trading_realized_pnl) AS trading_sum,
          sum(redemption_pnl) AS redemption_sum,
          sum(unrealized_pnl) AS unrealized_sum,
          countIf(abs(trading_realized_pnl) > 0.01) AS closed_cnt,
          countIf(abs(unrealized_pnl) > 0.01) AS open_cnt,
          countIf(abs(redemption_pnl) > 0.01) AS redeemed_cnt
        FROM cascadian_clean.vw_market_pnl_unified
        GROUP BY wallet
      )
      SELECT
        wallet,
        trading_sum AS trading_realized_pnl,
        redemption_sum AS redemption_pnl,
        trading_sum + redemption_sum AS total_realized_pnl,
        unrealized_sum AS unrealized_pnl,
        trading_sum + redemption_sum + unrealized_sum AS total_pnl,
        closed_cnt AS closed_positions,
        open_cnt AS open_positions,
        redeemed_cnt AS redeemed_positions
      FROM agg
      ORDER BY total_pnl DESC
    `
  });
  console.log('✓ Fixed vw_wallet_pnl_unified');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_closed AS
      SELECT
        wallet,
        total_realized_pnl AS closed_pnl,
        closed_positions + redeemed_positions AS total_closed_positions
      FROM cascadian_clean.vw_wallet_pnl_unified
      ORDER BY closed_pnl DESC
    `
  });
  console.log('✓ Fixed vw_wallet_pnl_closed');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_all AS
      SELECT
        wallet,
        total_realized_pnl AS realized_pnl,
        unrealized_pnl,
        total_pnl AS all_pnl,
        closed_positions + redeemed_positions AS closed_positions,
        open_positions
      FROM cascadian_clean.vw_wallet_pnl_unified
      ORDER BY all_pnl DESC
    `
  });
  console.log('✓ Fixed vw_wallet_pnl_all');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_pnl_coverage_metrics AS
      SELECT
        (SELECT count(DISTINCT condition_id_norm) FROM default.market_resolutions_final WHERE payout_denominator > 0) AS resolved_markets,
        (SELECT uniqExact(concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00'))
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '' AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) AS traded_markets,
        (SELECT count(*) FROM cascadian_clean.midprices_latest) AS prices_available,
        (SELECT count(DISTINCT concat(market_cid, '-', toString(outcome)))
         FROM cascadian_clean.vw_positions_open) AS open_positions_needing_prices,
        (SELECT sum(total_realized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_realized_pnl,
        (SELECT sum(unrealized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_unrealized_pnl,
        (SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) AS total_all_pnl,
        round((SELECT sum(total_realized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) /
              nullIf((SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified), 0) * 100, 2) AS realized_pct,
        round((SELECT sum(unrealized_pnl) FROM cascadian_clean.vw_wallet_pnl_unified) /
              nullIf((SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl_unified), 0) * 100, 2) AS unrealized_pct
    `
  });
  console.log('✓ Fixed vw_pnl_coverage_metrics');

  await ch.close();
  console.log('');
  console.log('✅ ALL VIEWS FIXED SUCCESSFULLY');
}

main().catch(console.error);
