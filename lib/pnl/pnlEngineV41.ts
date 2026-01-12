/**
 * PnL Engine V41 - Proportional CTF Attribution
 *
 * KEY INNOVATION: Properly attributes CTF events from exchange/adapter contracts
 * to individual wallets based on their share of each transaction's volume.
 *
 * PROBLEM SOLVED:
 * - V38 only finds CTF events where user_address = wallet (direct events)
 * - But most CTF events are recorded under exchange (0xd91e...) or NegRiskAdapter (0x4bfb...)
 * - These events ARE linked to user trades via tx_hash (embedded in event_id)
 * - One tx_hash can serve multiple traders (up to 28 observed)
 * - We attribute CTF amounts proportionally: (wallet_usdc / tx_total_usdc) * ctf_amount
 *
 * DATA FLOW:
 * 1. CLOB trades: pm_trader_events_v3 (event_id contains tx_hash)
 * 2. Direct CTF: pm_ctf_events WHERE user_address = wallet
 * 3. Attributed CTF: pm_ctf_events WHERE tx_hash IN wallet's trades, proportionally attributed
 *
 * @author Claude Code
 * @version 41.0.0
 * @created 2026-01-10
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV41 {
  wallet: string;
  realized_cash_pnl: number;
  realized_assumed_redeemed_pnl: number;
  total_pnl_mtm: number;
  stats: {
    clob_trades: number;
    direct_ctf_events: number;
    attributed_ctf_events: number;
    ctf_attribution_ratio: number;  // Avg attribution ratio (1.0 = solo trades)
    open_positions: number;
    resolved_positions: number;
  };
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Calculate PnL with proportional CTF attribution
 */
export async function getWalletPnLV41(wallet: string): Promise<PnLResultV41> {
  const w = wallet.toLowerCase();

  // Single comprehensive query combining all sources
  const query = `
    WITH
    -- 1. Get wallet's CLOB trades with tx_hash
    wallet_fills AS (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        sum(t.usdc_amount) / 1e6 as usdc,
        sum(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
      GROUP BY substring(event_id, 1, 66), lower(m.condition_id), m.outcome_index, t.side
    ),

    -- 2. Get total USDC per tx_hash (for attribution ratio)
    tx_totals AS (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        sum(usdc_amount) / 1e6 as total_usdc
      FROM pm_trader_events_v3
      WHERE substring(event_id, 1, 66) IN (SELECT DISTINCT tx_hash FROM wallet_fills)
      GROUP BY substring(event_id, 1, 66)
    ),

    -- 3. Wallet USDC per tx_hash (for attribution)
    wallet_tx_usdc AS (
      SELECT
        tx_hash,
        sum(usdc) as wallet_usdc
      FROM wallet_fills
      GROUP BY tx_hash
    ),

    -- 4. Attribution ratio per tx_hash
    attribution_ratios AS (
      SELECT
        w.tx_hash,
        w.wallet_usdc / t.total_usdc as ratio
      FROM wallet_tx_usdc w
      JOIN tx_totals t ON w.tx_hash = t.tx_hash
    ),

    -- 5. Direct CTF events (user_address = wallet)
    direct_ctf AS (
      SELECT
        lower(condition_id) as condition_id,
        event_type,
        toFloat64(amount_or_payout) / 1e6 as amount,
        1.0 as ratio  -- Full attribution for direct events
      FROM pm_ctf_events
      WHERE lower(user_address) = '${w}'
        AND is_deleted = 0
        AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
    ),

    -- 6. Attributed CTF events (via tx_hash)
    attributed_ctf AS (
      SELECT
        lower(c.condition_id) as condition_id,
        c.event_type,
        toFloat64(c.amount_or_payout) / 1e6 * a.ratio as amount,
        a.ratio as ratio
      FROM pm_ctf_events c
      JOIN attribution_ratios a ON c.tx_hash = a.tx_hash
      WHERE c.is_deleted = 0
        AND c.event_type IN ('PositionSplit', 'PositionsMerge')
        AND lower(c.user_address) != '${w}'  -- Exclude direct (already counted)
    ),

    -- 7. Combine CTF events
    all_ctf AS (
      SELECT condition_id, event_type, amount, ratio FROM direct_ctf
      UNION ALL
      SELECT condition_id, event_type, amount, ratio FROM attributed_ctf
    ),

    -- 8. Aggregate CTF by condition
    ctf_agg AS (
      SELECT
        condition_id,
        sumIf(amount, event_type = 'PositionSplit') as split_tokens,
        sumIf(amount, event_type = 'PositionsMerge') as merge_tokens,
        sumIf(amount, event_type = 'PayoutRedemption') as redemption_usdc,
        avg(ratio) as avg_ratio,
        count() as ctf_count
      FROM all_ctf
      GROUP BY condition_id
    ),

    -- 9. CLOB aggregated by condition/outcome
    clob_agg AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(usdc, side = 'buy') as buy_cost,
        sumIf(tokens, side = 'buy') as buy_tokens,
        sumIf(usdc, side = 'sell') as sell_proceeds,
        sumIf(tokens, side = 'sell') as sell_tokens,
        count() as trade_count
      FROM wallet_fills
      GROUP BY condition_id, outcome_index
    ),

    -- 10. Resolutions
    resolutions AS (
      SELECT lower(condition_id) as condition_id, norm_prices
      FROM pm_condition_resolutions_norm
      WHERE is_deleted = 0 AND length(norm_prices) > 0
    ),

    -- 11. Mark prices
    mark_prices AS (
      SELECT
        lower(condition_id) as condition_id,
        outcome_index,
        mark_price
      FROM pm_latest_mark_price_v1
      WHERE mark_price IS NOT NULL
    ),

    -- 12. Calculate per-position PnL
    position_pnl AS (
      SELECT
        c.condition_id,
        c.outcome_index,
        c.trade_count,
        -- CLOB totals
        c.buy_cost,
        c.buy_tokens,
        c.sell_proceeds,
        c.sell_tokens,
        -- CTF additions (split evenly across outcomes for binary markets)
        coalesce(ctf.split_tokens, 0) / 2 as ctf_buy_tokens,  -- Split gives tokens per outcome
        coalesce(ctf.split_tokens, 0) / 2 * 0.5 as ctf_buy_cost,  -- At $0.50
        coalesce(ctf.merge_tokens, 0) / 2 as ctf_sell_tokens,
        coalesce(ctf.merge_tokens, 0) / 2 * 0.5 as ctf_sell_proceeds,
        coalesce(ctf.avg_ratio, 1) as avg_ratio,
        coalesce(ctf.ctf_count, 0) as ctf_count,
        -- Combined totals
        c.buy_tokens + coalesce(ctf.split_tokens, 0) / 2 as total_buy_tokens,
        c.buy_cost + coalesce(ctf.split_tokens, 0) / 2 * 0.5 as total_buy_cost,
        c.sell_tokens + coalesce(ctf.merge_tokens, 0) / 2 as total_sell_tokens,
        c.sell_proceeds + coalesce(ctf.merge_tokens, 0) / 2 * 0.5 as total_sell_proceeds,
        -- Resolution
        r.norm_prices[c.outcome_index + 1] as resolution_price,
        length(r.norm_prices) > 0 as is_resolved,
        -- Mark price
        mp.mark_price as mark_price
      FROM clob_agg c
      LEFT JOIN ctf_agg ctf ON c.condition_id = ctf.condition_id
      LEFT JOIN resolutions r ON c.condition_id = r.condition_id
      LEFT JOIN mark_prices mp ON c.condition_id = mp.condition_id AND c.outcome_index = mp.outcome_index
    ),

    -- 13. Apply sell capping and calculate final PnL
    final_pnl AS (
      SELECT
        trade_count,
        ctf_count,
        avg_ratio,
        is_resolved,
        -- Cap sells to buys
        least(total_sell_tokens, total_buy_tokens) as effective_sell_tokens,
        greatest(total_buy_tokens - total_sell_tokens, 0) as net_tokens,
        total_buy_cost,
        -- Proportional sell proceeds
        CASE WHEN total_sell_tokens > 0
             THEN total_sell_proceeds * (least(total_sell_tokens, total_buy_tokens) / total_sell_tokens)
             ELSE 0 END as effective_sell_proceeds,
        resolution_price,
        mark_price
      FROM position_pnl
    )

    SELECT
      -- Realized cash PnL (sells - buys)
      round(sum(effective_sell_proceeds - total_buy_cost), 2) as realized_cash_pnl,
      -- Realized + assumed redemption
      round(sum(effective_sell_proceeds - total_buy_cost +
                CASE WHEN is_resolved THEN net_tokens * coalesce(resolution_price, 0) ELSE 0 END), 2) as realized_assumed_pnl,
      -- Total with unrealized
      round(sum(effective_sell_proceeds - total_buy_cost +
                CASE
                  WHEN is_resolved THEN net_tokens * coalesce(resolution_price, 0)
                  ELSE net_tokens * coalesce(mark_price, 0.5)
                END), 2) as total_pnl_mtm,
      -- Stats
      sum(trade_count) as clob_trades,
      sum(ctf_count) as ctf_events,
      avg(avg_ratio) as avg_attribution_ratio,
      countIf(net_tokens > 0 AND NOT is_resolved) as open_positions,
      countIf(is_resolved) as resolved_positions
    FROM final_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const row = rows[0] || {};

  // Determine confidence
  const avgRatio = Number(row.avg_attribution_ratio) || 1;
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (avgRatio < 0.5) {
    confidence = 'low';  // Heavy shared transactions
  } else if (avgRatio < 0.9) {
    confidence = 'medium';
  }

  return {
    wallet: w,
    realized_cash_pnl: Number(row.realized_cash_pnl) || 0,
    realized_assumed_redeemed_pnl: Number(row.realized_assumed_pnl) || 0,
    total_pnl_mtm: Number(row.total_pnl_mtm) || 0,
    stats: {
      clob_trades: Number(row.clob_trades) || 0,
      direct_ctf_events: 0,  // Would need separate query
      attributed_ctf_events: Number(row.ctf_events) || 0,
      ctf_attribution_ratio: Number(row.avg_attribution_ratio) || 1,
      open_positions: Number(row.open_positions) || 0,
      resolved_positions: Number(row.resolved_positions) || 0,
    },
    confidence,
  };
}

// CLI test
if (require.main === module) {
  const wallet = process.argv[2] || '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4';

  getWalletPnLV41(wallet)
    .then(async (result) => {
      console.log('\n📊 V41 PnL Result:');
      console.log('==================');
      console.log(`Wallet: ${result.wallet.slice(0, 12)}...`);
      console.log(`Realized Cash PnL: $${result.realized_cash_pnl.toFixed(2)}`);
      console.log(`Realized + Assumed: $${result.realized_assumed_redeemed_pnl.toFixed(2)}`);
      console.log(`Total PnL (MTM): $${result.total_pnl_mtm.toFixed(2)}`);
      console.log(`\nStats:`);
      console.log(`  CLOB trades: ${result.stats.clob_trades}`);
      console.log(`  Attributed CTF: ${result.stats.attributed_ctf_events}`);
      console.log(`  Attribution ratio: ${(result.stats.ctf_attribution_ratio * 100).toFixed(1)}%`);
      console.log(`  Open positions: ${result.stats.open_positions}`);
      console.log(`  Resolved positions: ${result.stats.resolved_positions}`);
      console.log(`Confidence: ${result.confidence}`);

      // Compare to Polymarket API
      try {
        const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
        const data = await res.json();
        const pmPnl = Array.isArray(data) && data.length > 0 ? data[data.length - 1].p : null;
        if (pmPnl !== null) {
          console.log(`\nPolymarket API: $${pmPnl.toFixed(2)}`);
          const error = Math.abs(result.total_pnl_mtm - pmPnl);
          const errorPct = Math.abs(pmPnl) > 0 ? (error / Math.abs(pmPnl)) * 100 : 0;
          console.log(`Error: $${error.toFixed(2)} (${errorPct.toFixed(1)}%)`);
        }
      } catch (e) {
        console.log('\nCould not fetch Polymarket API');
      }
    })
    .catch(console.error);
}
