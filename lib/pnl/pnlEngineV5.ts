/**
 * PnL Engine V5 - Unified Wallet + Proxy Trades
 *
 * The systematic solution: CLOB trades can be under user wallet OR proxy addresses.
 * We detect proxy trades by:
 * 1. Finding ERC1155 transfers TO the user
 * 2. Looking for CLOB trades in those same tx_hashes under proxy addresses
 * 3. Including both user trades AND proxy trades in PnL calculation
 *
 * Known proxy addresses:
 * - 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e (Exchange Proxy)
 * - 0xc5d563a36ae78145c45a50134d48a1215220f80a (Neg Risk Adapter)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV5 {
  wallet: string;
  realized: { pnl: number; marketCount: number };
  syntheticRealized: { pnl: number; marketCount: number };
  unrealized: { pnl: number; marketCount: number };
  total: number;
  userTrades: number;
  proxyTrades: number;
}

const PROXY_ADDRESSES = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // Exchange Proxy
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Neg Risk Adapter
];

export async function getWalletPnLV5(wallet: string): Promise<PnLResultV5> {
  const w = wallet.toLowerCase();
  const proxyList = PROXY_ADDRESSES.map(p => `'${p}'`).join(',');

  const query = `
    WITH
    -- Step 1: Find tx_hashes where this wallet received ERC1155 transfers
    user_transfer_txs AS (
      SELECT DISTINCT lower(tx_hash) as tx_hash
      FROM pm_erc1155_transfers
      WHERE lower(to_address) = '${w}'
        AND is_deleted = 0
    ),

    -- Step 2: Get user's direct CLOB trades
    user_trades AS (
      SELECT
        lower(substring(event_id, 1, 66)) as tx_hash,
        m.condition_id as condition_id,
        m.outcome_index as outcome_index,
        t.side as side,
        sum(t.usdc_amount) / 1e6 as usdc,
        sum(t.token_amount) / 1e6 as tokens,
        0 as is_proxy
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY tx_hash, condition_id, outcome_index, side
    ),

    -- Step 3: Get proxy trades in the same tx_hashes as user's ERC1155 transfers
    proxy_trades AS (
      SELECT
        lower(substring(event_id, 1, 66)) as tx_hash,
        m.condition_id as condition_id,
        m.outcome_index as outcome_index,
        t.side as side,
        sum(t.usdc_amount) / 1e6 as usdc,
        sum(t.token_amount) / 1e6 as tokens,
        1 as is_proxy
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) IN (${proxyList})
        AND lower(substring(event_id, 1, 66)) IN (SELECT tx_hash FROM user_transfer_txs)
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY tx_hash, condition_id, outcome_index, side
    ),

    -- Step 4: Combine all trades
    all_trades AS (
      SELECT * FROM user_trades
      UNION ALL
      SELECT * FROM proxy_trades
    ),

    -- Step 5: Aggregate per outcome
    outcome_totals AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds,
        countIf(is_proxy = 0) as user_trade_count,
        countIf(is_proxy = 1) as proxy_trade_count
      FROM all_trades
      GROUP BY condition_id, outcome_index
    ),

    -- Step 6: Join with resolution/mark prices
    outcome_with_prices AS (
      SELECT
        o.condition_id as condition_id,
        o.outcome_index as outcome_index,
        o.bought as bought,
        o.sold as sold,
        o.buy_cost as buy_cost,
        o.sell_proceeds as sell_proceeds,
        o.user_trade_count as user_trade_count,
        o.proxy_trade_count as proxy_trade_count,
        r.norm_prices as resolution_prices,
        length(r.norm_prices) > 0 as has_resolution,
        mp.mark_price as mark_price
      FROM outcome_totals o
      LEFT JOIN pm_condition_resolutions_norm r ON lower(o.condition_id) = lower(r.condition_id)
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(o.condition_id) = lower(mp.condition_id)
        AND o.outcome_index = mp.outcome_index
    ),

    -- Step 7: Calculate PnL per outcome
    outcome_pnl AS (
      SELECT
        condition_id,
        outcome_index,
        bought,
        sold,
        buy_cost,
        sell_proceeds,
        user_trade_count,
        proxy_trade_count,
        -- Cap sells to bought amount
        CASE
          WHEN sold > bought AND sold > 0 THEN sell_proceeds * (bought / sold)
          ELSE sell_proceeds
        END as effective_sell,
        greatest(bought - sold, 0) as net_tokens,
        -- Status
        CASE
          WHEN has_resolution THEN 'realized'
          WHEN mark_price IS NOT NULL AND (mark_price <= 0.01 OR mark_price >= 0.99) THEN 'synthetic'
          WHEN mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as status,
        -- Payout price
        CASE
          WHEN has_resolution THEN arrayElement(resolution_prices, toUInt8(outcome_index + 1))
          WHEN mark_price IS NOT NULL THEN mark_price
          ELSE 0
        END as payout_price
      FROM outcome_with_prices
    ),

    -- Step 8: Final PnL
    final_pnl AS (
      SELECT
        condition_id,
        status,
        effective_sell + (net_tokens * payout_price) - buy_cost as pnl,
        user_trade_count,
        proxy_trade_count
      FROM outcome_pnl
      WHERE status != 'unknown'
    )

    -- Aggregate by status
    SELECT
      status,
      count() as market_count,
      round(sum(pnl), 2) as total_pnl,
      sum(user_trade_count) as user_trades,
      sum(proxy_trade_count) as proxy_trades
    FROM final_pnl
    GROUP BY status
    ORDER BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const pnlResult: PnLResultV5 = {
    wallet: w,
    realized: { pnl: 0, marketCount: 0 },
    syntheticRealized: { pnl: 0, marketCount: 0 },
    unrealized: { pnl: 0, marketCount: 0 },
    total: 0,
    userTrades: 0,
    proxyTrades: 0,
  };

  for (const row of rows) {
    const pnl = Number(row.total_pnl);
    const count = Number(row.market_count);
    pnlResult.userTrades += Number(row.user_trades || 0);
    pnlResult.proxyTrades += Number(row.proxy_trades || 0);

    switch (row.status) {
      case 'realized':
        pnlResult.realized = { pnl, marketCount: count };
        break;
      case 'synthetic':
        pnlResult.syntheticRealized = { pnl, marketCount: count };
        break;
      case 'unrealized':
        pnlResult.unrealized = { pnl, marketCount: count };
        break;
    }
  }

  pnlResult.total = pnlResult.realized.pnl + pnlResult.syntheticRealized.pnl + pnlResult.unrealized.pnl;

  return pnlResult;
}
