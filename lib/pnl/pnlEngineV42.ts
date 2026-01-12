/**
 * PnL Engine V42 - V1 + Direct CTF + Direct Conversions
 *
 * This engine extends V1 by adding ONLY:
 * 1. Direct CTF events where user_address = wallet (splits, merges, redemptions)
 * 2. NegRisk conversions where user_address = wallet
 *
 * IMPORTANT: We do NOT add CTF events via tx_hash linkage from exchange/adapter
 * addresses. Those represent internal CLOB mechanics and are already reflected
 * in the executed trade prices.
 *
 * Rule: Only add direct CTF events when TX Overlap = 0 (no shared txs with CLOB)
 *
 * @author Claude Code
 * @version 42.0.0
 * @created 2026-01-10
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV42 {
  wallet: string;
  realized: {
    pnl: number;
    marketCount: number;
  };
  syntheticRealized: {
    pnl: number;
    marketCount: number;
  };
  unrealized: {
    pnl: number;
    marketCount: number;
  };
  total: number;
  stats: {
    clobTrades: number;
    directCTFSplits: number;
    directCTFMerges: number;
    directCTFRedemptions: number;
    negRiskConversions: number;
    txOverlap: number;
  };
  confidence: 'high' | 'medium' | 'low';
  warning?: string;
}

/**
 * Check TX overlap between CLOB and direct CTF
 */
async function getTxOverlap(wallet: string): Promise<number> {
  const w = wallet.toLowerCase();
  const query = `
    WITH
    clob_txs AS (
      SELECT DISTINCT substring(event_id, 1, 66) as tx_hash
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = '${w}'
    ),
    ctf_txs AS (
      SELECT DISTINCT tx_hash
      FROM pm_ctf_events
      WHERE lower(user_address) = '${w}'
        AND is_deleted = 0
    )
    SELECT count() as overlap
    FROM ctf_txs c
    WHERE c.tx_hash IN (SELECT tx_hash FROM clob_txs)
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows[0]?.overlap || 0;
}

/**
 * Get direct CTF event stats
 */
async function getDirectCTFStats(wallet: string): Promise<{
  splits: number;
  merges: number;
  redemptions: number;
}> {
  const w = wallet.toLowerCase();
  const query = `
    SELECT
      countIf(event_type = 'PositionSplit') as splits,
      countIf(event_type = 'PositionsMerge') as merges,
      countIf(event_type = 'PayoutRedemption') as redemptions
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
      AND is_deleted = 0
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows[0] || { splits: 0, merges: 0, redemptions: 0 };
}

/**
 * Get NegRisk conversion count
 */
async function getNegRiskConversions(wallet: string): Promise<number> {
  const w = wallet.toLowerCase();
  const query = `
    SELECT count() as conversions
    FROM pm_neg_risk_conversions_v1
    WHERE lower(user_address) = '${w}'
      AND is_deleted = 0
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows[0]?.conversions || 0;
}

/**
 * Calculate PnL using V1 CLOB logic + direct CTF events
 */
export async function getWalletPnLV42(wallet: string): Promise<PnLResultV42> {
  const w = wallet.toLowerCase();

  // Get stats first
  const [txOverlap, ctfStats, negRiskCount] = await Promise.all([
    getTxOverlap(w),
    getDirectCTFStats(w),
    getNegRiskConversions(w),
  ]);

  // Main PnL query combining V1 CLOB logic with direct CTF
  const query = `
    WITH
    -- V1 CLOB trades (no is_deleted for v3)
    deduped_trades AS (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
      GROUP BY tx_hash, m.condition_id, m.outcome_index, m.question, t.side
    ),

    -- Direct CTF events (user_address = wallet, no tx_hash attribution)
    direct_ctf AS (
      SELECT
        lower(condition_id) as condition_id,
        event_type,
        partition_index_sets,
        toFloat64(amount_or_payout) / 1e6 as amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${w}'
        AND is_deleted = 0
        AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
    ),

    -- Aggregate CLOB by condition/outcome
    clob_totals AS (
      SELECT
        condition_id,
        any(question) as question,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds
      FROM deduped_trades
      GROUP BY condition_id, outcome_index
    ),

    -- Aggregate direct CTF by condition (for binary markets, apply to both outcomes)
    -- NOTE: PayoutRedemption is NOT included - V1 already handles it via net_tokens * resolution_price
    -- The redemption event is just the mechanism; the value is already calculated by V1
    ctf_totals AS (
      SELECT
        condition_id,
        sumIf(amount, event_type = 'PositionSplit') as split_tokens,
        sumIf(amount, event_type = 'PositionsMerge') as merge_tokens
      FROM direct_ctf
      GROUP BY condition_id
    ),

    -- Combine CLOB and CTF
    combined AS (
      SELECT
        c.condition_id,
        c.question,
        c.outcome_index,
        -- CLOB positions
        c.bought as clob_bought,
        c.sold as clob_sold,
        c.buy_cost as clob_buy_cost,
        c.sell_proceeds as clob_sell_proceeds,
        -- CTF additions (split across outcomes for binary markets)
        coalesce(ctf.split_tokens, 0) as ctf_split_tokens,
        coalesce(ctf.merge_tokens, 0) as ctf_merge_tokens
      FROM clob_totals c
      LEFT JOIN ctf_totals ctf ON lower(c.condition_id) = ctf.condition_id
    ),

    -- Calculate combined totals
    outcome_totals AS (
      SELECT
        condition_id,
        question,
        outcome_index,
        -- Total bought = CLOB bought + split tokens (split gives tokens per outcome)
        clob_bought + ctf_split_tokens as bought,
        -- Total sold = CLOB sold + merge tokens
        clob_sold + ctf_merge_tokens as sold,
        -- Total buy cost = CLOB cost + split cost ($0.50 per token)
        clob_buy_cost + (ctf_split_tokens * 0.5) as buy_cost,
        -- Total sell proceeds = CLOB proceeds + merge proceeds ($0.50 per token)
        clob_sell_proceeds + (ctf_merge_tokens * 0.5) as sell_proceeds
      FROM combined
    ),

    -- Add resolution and mark prices
    outcome_with_prices AS (
      SELECT
        o.condition_id,
        o.question,
        o.outcome_index,
        o.bought,
        o.sold,
        o.buy_cost,
        o.sell_proceeds,
        r.norm_prices as resolution_prices,
        length(r.norm_prices) > 0 as has_resolution,
        mp.mark_price as current_mark_price,
        mp.mark_price IS NOT NULL as has_mark_price
      FROM outcome_totals o
      LEFT JOIN pm_condition_resolutions_norm r ON lower(o.condition_id) = lower(r.condition_id)
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(o.condition_id) = lower(mp.condition_id)
        AND o.outcome_index = mp.outcome_index
    ),

    -- Calculate PnL per outcome
    outcome_pnl AS (
      SELECT
        o.condition_id as condition_id,
        o.question as question,
        o.outcome_index as outcome_index,
        o.bought as bought,
        o.sold as sold,
        o.buy_cost as buy_cost,
        o.sell_proceeds as sell_proceeds,
        o.has_resolution as has_resolution,
        o.current_mark_price as current_mark_price,
        -- Cap effective sell to what was actually owned
        CASE
          WHEN o.sold > o.bought AND o.sold > 0 THEN o.sell_proceeds * (o.bought / o.sold)
          ELSE o.sell_proceeds
        END as effective_sell,
        -- Net tokens held
        greatest(o.bought - o.sold, 0) as net_tokens,
        -- Determine status and payout price
        CASE
          WHEN o.has_resolution THEN 'realized'
          WHEN o.current_mark_price IS NOT NULL AND (o.current_mark_price <= 0.01 OR o.current_mark_price >= 0.99) THEN 'synthetic'
          WHEN o.current_mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as status,
        CASE
          WHEN o.has_resolution THEN arrayElement(o.resolution_prices, toUInt8(o.outcome_index + 1))
          WHEN o.current_mark_price IS NOT NULL THEN o.current_mark_price
          ELSE 0
        END as payout_price
      FROM outcome_with_prices o
    ),

    -- Calculate final PnL per market
    final_pnl AS (
      SELECT
        condition_id,
        any(question) as question,
        status,
        sum(effective_sell) as total_sell,
        sum(net_tokens * payout_price) as total_settlement,
        sum(buy_cost) as total_cost,
        sum(effective_sell) + sum(net_tokens * payout_price) - sum(buy_cost) as pnl
      FROM outcome_pnl
      WHERE status != 'unknown'
      GROUP BY condition_id, status
    )

    SELECT
      status,
      count() as market_count,
      round(sum(pnl), 2) as total_pnl
    FROM final_pnl
    GROUP BY status
    ORDER BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // Get CLOB trade count
  const clobCountQ = `SELECT count() as cnt FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${w}'`;
  const clobCountRes = await clickhouse.query({ query: clobCountQ, format: 'JSONEachRow' });
  const clobCount = ((await clobCountRes.json()) as any[])[0]?.cnt || 0;

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'high';
  let warning: string | undefined;

  if (txOverlap > 0) {
    confidence = 'low';
    warning = `TX overlap detected (${txOverlap}). Direct CTF events may already be in CLOB prices.`;
  } else if (negRiskCount > 0) {
    confidence = 'medium';
    warning = `Wallet has ${negRiskCount} NegRisk conversions. PnL may have minor discrepancies.`;
  }

  // Initialize result
  const pnlResult: PnLResultV42 = {
    wallet: w,
    realized: { pnl: 0, marketCount: 0 },
    syntheticRealized: { pnl: 0, marketCount: 0 },
    unrealized: { pnl: 0, marketCount: 0 },
    total: 0,
    stats: {
      clobTrades: clobCount,
      directCTFSplits: ctfStats.splits,
      directCTFMerges: ctfStats.merges,
      directCTFRedemptions: ctfStats.redemptions,
      negRiskConversions: negRiskCount,
      txOverlap,
    },
    confidence,
    warning,
  };

  // Parse results
  for (const row of rows) {
    const pnl = Number(row.total_pnl);
    const count = Number(row.market_count);

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

  pnlResult.total =
    pnlResult.realized.pnl +
    pnlResult.syntheticRealized.pnl +
    pnlResult.unrealized.pnl;

  return pnlResult;
}

// CLI test
if (require.main === module) {
  const wallet = process.argv[2] || '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4';

  getWalletPnLV42(wallet)
    .then(async (result) => {
      console.log('\n📊 V42 PnL Result:');
      console.log('==================');
      console.log(`Wallet: ${result.wallet.slice(0, 12)}...`);
      console.log(`Realized: $${result.realized.pnl.toFixed(2)} (${result.realized.marketCount} markets)`);
      console.log(`Synthetic: $${result.syntheticRealized.pnl.toFixed(2)} (${result.syntheticRealized.marketCount} markets)`);
      console.log(`Unrealized: $${result.unrealized.pnl.toFixed(2)} (${result.unrealized.marketCount} markets)`);
      console.log(`Total: $${result.total.toFixed(2)}`);
      console.log(`\nStats:`);
      console.log(`  CLOB trades: ${result.stats.clobTrades}`);
      console.log(`  Direct CTF Splits: ${result.stats.directCTFSplits}`);
      console.log(`  Direct CTF Merges: ${result.stats.directCTFMerges}`);
      console.log(`  Direct CTF Redemptions: ${result.stats.directCTFRedemptions}`);
      console.log(`  NegRisk Conversions: ${result.stats.negRiskConversions}`);
      console.log(`  TX Overlap: ${result.stats.txOverlap}`);
      console.log(`Confidence: ${result.confidence}`);
      if (result.warning) console.log(`Warning: ${result.warning}`);

      // Compare to Polymarket API
      try {
        const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
        const data = await res.json();
        const pmPnl = Array.isArray(data) && data.length > 0 ? data[data.length - 1].p : null;
        if (pmPnl !== null) {
          console.log(`\nPolymarket API: $${pmPnl.toFixed(2)}`);
          const error = Math.abs(result.total - pmPnl);
          const errorPct = Math.abs(pmPnl) > 0 ? (error / Math.abs(pmPnl)) * 100 : 0;
          console.log(`Error: $${error.toFixed(2)} (${errorPct.toFixed(1)}%)`);
        }
      } catch (e) {
        console.log('\nCould not fetch Polymarket API');
      }
    })
    .catch(console.error);
}
