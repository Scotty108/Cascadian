#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const WALLET = (process.argv[2] || '0x4ce73141dbfce41e65db3723e31059a730f0abad').toLowerCase();
const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function run(query: string) {
  const result = await client.query({ query, format: 'JSONEachRow' });
  return result.json<any>();
}

async function main() {
  console.log(`Tracing wallet data for ${WALLET}`);

  const tradesSummary = await run(`
    WITH '${WALLET}' AS target
    SELECT
      count() AS trade_count,
      uniq(market_cid) AS markets,
      uniq(token_cid) AS tokens,
      min(ts) AS first_trade,
      max(ts) AS last_trade,
      sum(d_cash) AS net_cash,
      sum(d_shares) AS net_shares
    FROM cascadian_clean.vw_trades_ledger
    WHERE lower(wallet) = lower(target)
  `);
  console.log('\nTrades summary:', tradesSummary[0]);

  const resolutionCoverage = await run(`
    WITH trades AS (
      SELECT lower(market_cid) AS cid
      FROM cascadian_clean.vw_trades_ledger
      WHERE lower(wallet) = lower('${WALLET}')
      GROUP BY cid
    )
    SELECT
      count() AS wallet_conditions,
      sum(has_resolution) AS with_resolution,
      sum(1 - has_resolution) AS without_resolution
    FROM (
      SELECT
        cid,
        if(res.condition_id_norm IS NULL, 0, 1) AS has_resolution
      FROM trades t
      LEFT JOIN default.market_resolutions_final res
        ON res.condition_id_norm = replaceAll(cid, '0x', '')
    )
  `);
  console.log('\nResolution coverage:', resolutionCoverage[0]);

  const openPositions = await run(`
    SELECT
      count() AS open_positions,
      countIf(midprice > 0) AS positions_with_midprice,
      sum(unrealized_pnl_usd) AS unrealized_pnl,
      sumIf(unrealized_pnl_usd, midprice = 0) AS unrealized_without_midprice
    FROM cascadian_clean.vw_positions_open
    WHERE lower(wallet) = lower('${WALLET}')
  `);
  console.log('\nOpen positions summary:', openPositions[0]);

  const closedPositions = await run(`
    SELECT realized_pnl, trade_count, markets_traded
    FROM cascadian_clean.vw_wallet_pnl_closed
    WHERE lower(wallet) = lower('${WALLET}')
  `);
  console.log('\nClosed positions summary:', closedPositions[0] || 'no row');

  const pnlView = await run(`
    SELECT
      total_pnl,
      realized_pnl,
      total_pnl - realized_pnl AS implied_unrealized
    FROM (
      SELECT
        sum(total_pnl) AS total_pnl,
        sum(realized_pnl) AS realized_pnl
      FROM (
        SELECT
          coalesce(total_pnl, 0) AS total_pnl,
          coalesce(realized_profit, 0) - coalesce(realized_loss, 0) AS realized_pnl
        FROM cascadian_clean.vw_wallet_pnl
        WHERE lower(wallet) = lower('${WALLET}')
      )
    )
  `);
  console.log('\nWallet P&L view (aggregated from vw_wallet_pnl):', pnlView[0] || 'no row');

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
