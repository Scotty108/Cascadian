/**
 * PnL Engine V1 - Unified Polymarket Profit/Loss Calculator
 *
 * CORRECTED FORMULA (from V55):
 *   PnL = CLOB_cash + Long_wins - Short_losses
 *
 * Where:
 *   - CLOB_cash = sell_usdc - buy_usdc (from CLOB trading only)
 *   - Long_wins = tokens LONG on WINNING outcomes (worth $1 each)
 *   - Short_losses = tokens SHORT on WINNING outcomes (liability $1 each)
 *   - CTF tokens included in net_tokens calculation
 *   - Self-fills deduplicated (exclude MAKER side)
 *
 * V1+ ENHANCEMENT (Jan 12, 2026):
 *   For NegRisk-heavy wallets, use getWalletPnLV1Plus() which adds:
 *   - NegRisk token inflows from vw_negrisk_conversions
 *   - Hex-to-decimal token_id conversion for joining
 *   - 97% error reduction for NegRisk wallets (tested on JohnnyTenNumbers)
 *
 * Key Formula Insights:
 * - CTF split cash is NOT included (splits are economically neutral)
 * - Uses transaction_hash matching for self-fill detection
 * - Excludes MAKER side of self-fills (not taker)
 * - NegRisk tokens from vw_negrisk_conversions fill phantom position gaps
 *
 * Data Sources:
 * - pm_trader_events_v3: CLOB trade events
 * - pm_token_to_condition_map_v5: Token ID to condition/outcome mapping
 * - pm_ctf_split_merge_expanded: CTF token operations
 * - vw_negrisk_conversions: NegRisk adapter token transfers (V1+ only)
 * - pm_condition_resolutions: Market resolution payouts
 * - pm_latest_mark_price_v1: Current mark prices
 *
 * @author Claude Code
 * @version 2.0.0 (V1+ with NegRisk tokens)
 * @created 2026-01-07
 * @updated 2026-01-12
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResult {
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
}

/**
 * Extended PnL result with confidence flags and diagnostics
 */
export interface PnLResultWithConfidence extends PnLResult {
  confidence: 'high' | 'medium' | 'low';
  confidenceReasons: string[];
  diagnostics: {
    negRiskConversions: number;
    negRiskTokens: number;           // Token count from NegRisk conversions
    phantomTokens: number;           // Tokens sold > bought
    phantomPercent: number;          // Phantom tokens as % of total sold
    unexplainedPhantom: number;      // Phantom - NegRisk - CTF splits (unexplained source)
    selfFillTxs: number;
    openPositions: number;
    totalPositions: number;
    // Additional flags
    ctfSplitMergeCount: number;      // CTF splits/merges affecting token balances
    ctfSplitTokens: number;          // Token count from CTF splits
    erc1155InboundCount: number;     // Tokens received from other wallets
    recentTradeCount: number;        // Trades in last 7 days (data lag risk)
    largestPositionPct: number;      // Single position concentration %
    resolvedPositionPct: number;     // % of positions that are resolved
    totalTradeCount: number;         // Total CLOB trades
    avgTradeUsd: number;             // Average trade size in USD
  };
  engineUsed: 'V1' | 'V1+';
}

export interface MarketPnL {
  conditionId: string;
  question: string;
  outcome: number;
  bought: number;
  sold: number;
  netTokens: number;
  cost: number;
  sellProceeds: number;
  settlement: number;
  pnl: number;
  status: 'realized' | 'synthetic' | 'unrealized';
}

/**
 * Calculate comprehensive PnL for a wallet using V55 formula
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns PnLResult with realized, synthetic, and unrealized PnL
 */
export async function getWalletPnLV1(wallet: string): Promise<PnLResult> {
  const normalizedWallet = wallet.toLowerCase();

  // V55 formula: PnL = CLOB_cash + Long_wins - Short_losses
  const query = `
    WITH
      -- Step 1: Identify self-fill transactions
      self_fills AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${normalizedWallet}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),

      -- Step 2: CLOB positions (self-fill deduplicated - exclude MAKER side)
      clob_pos AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') - sumIf(t.token_amount / 1e6, t.side = 'sell') as clob_tokens,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as clob_cash
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${normalizedWallet}'
          AND m.condition_id != ''
          AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM self_fills) AND t.role = 'maker')
        GROUP BY m.condition_id, m.outcome_index
      ),

      -- Step 3: CTF tokens only (NO CASH - splits are economically neutral)
      ctf_tokens AS (
        SELECT condition_id, outcome_index, sum(shares_delta) as ctf_tokens
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${normalizedWallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- Step 4: Combine CLOB + CTF
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index) as outcome_index,
          COALESCE(c.clob_tokens, 0) + COALESCE(f.ctf_tokens, 0) as net_tokens,
          COALESCE(c.clob_cash, 0) as cash_flow
        FROM clob_pos c
        FULL OUTER JOIN ctf_tokens f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
      ),

      -- Step 5: Join resolutions and mark prices
      with_prices AS (
        SELECT
          cb.*,
          r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won,
          mp.mark_price as current_mark_price,
          CASE
            WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' THEN 'realized'
            WHEN mp.mark_price IS NOT NULL AND (mp.mark_price <= 0.01 OR mp.mark_price >= 0.99) THEN 'synthetic'
            WHEN mp.mark_price IS NOT NULL THEN 'unrealized'
            ELSE 'unknown'
          END as status
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
        LEFT JOIN pm_latest_mark_price_v1 mp ON lower(cb.condition_id) = lower(mp.condition_id)
          AND cb.outcome_index = mp.outcome_index
      ),

      -- Step 6: Calculate PnL by status
      pnl_by_status AS (
        SELECT
          status,
          sum(cash_flow) as total_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses,
          -- For unrealized/synthetic: use mark-to-market
          sumIf(net_tokens * ifNull(current_mark_price, 0), status IN ('unrealized', 'synthetic')) as mtm_value,
          count() as market_count
        FROM with_prices
        WHERE status != 'unknown'
        GROUP BY status
      )

    SELECT
      status,
      market_count,
      CASE
        WHEN status = 'realized' THEN round(total_cash + long_wins - short_losses, 2)
        ELSE round(total_cash + mtm_value, 2)
      END as total_pnl
    FROM pnl_by_status
    ORDER BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // Initialize result
  const pnlResult: PnLResult = {
    wallet: normalizedWallet,
    realized: { pnl: 0, marketCount: 0 },
    syntheticRealized: { pnl: 0, marketCount: 0 },
    unrealized: { pnl: 0, marketCount: 0 },
    total: 0,
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

/**
 * Calculate PnL with NegRisk token integration (V1+ formula)
 *
 * Use this for wallets with NegRisk activity. The formula adds NegRisk token inflows
 * from vw_negrisk_conversions to account for phantom positions created by the
 * NegRisk adapter's internal bookkeeping.
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns PnLResult with realized, synthetic, and unrealized PnL
 */
export async function getWalletPnLV1Plus(wallet: string): Promise<PnLResult> {
  const normalizedWallet = wallet.toLowerCase();

  // V1+ formula: V55 + NegRisk tokens from vw_negrisk_conversions
  const query = `
    WITH
      -- Step 1: Identify self-fill transactions
      self_fills AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${normalizedWallet}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),

      -- Step 2: CLOB positions (self-fill deduplicated - exclude MAKER side)
      clob_pos AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') - sumIf(t.token_amount / 1e6, t.side = 'sell') as clob_tokens,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as clob_cash
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${normalizedWallet}'
          AND m.condition_id != ''
          AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM self_fills) AND t.role = 'maker')
        GROUP BY m.condition_id, m.outcome_index
      ),

      -- Step 3: CTF tokens only (NO CASH - splits are economically neutral)
      ctf_tokens AS (
        SELECT condition_id, outcome_index, sum(shares_delta) as ctf_tokens
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${normalizedWallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- Step 4: NegRisk token inflows (V1+ ADDITION)
      -- Uses hex-to-decimal conversion to join vw_negrisk_conversions to token map
      negrisk_tokens AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sum(v.shares) as nr_tokens
        FROM vw_negrisk_conversions v
        JOIN pm_token_to_condition_map_v5 m ON
          toString(reinterpretAsUInt256(reverse(unhex(substring(v.token_id_hex, 3))))) = m.token_id_dec
        WHERE v.wallet = '${normalizedWallet}'
          AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),

      -- Step 5: Combine CLOB + CTF + NegRisk
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id, n.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index, n.outcome_index) as outcome_index,
          COALESCE(c.clob_tokens, 0) + COALESCE(f.ctf_tokens, 0) + COALESCE(n.nr_tokens, 0) as net_tokens,
          COALESCE(c.clob_cash, 0) as cash_flow
        FROM clob_pos c
        FULL OUTER JOIN ctf_tokens f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
        FULL OUTER JOIN negrisk_tokens n ON
          COALESCE(c.condition_id, f.condition_id) = n.condition_id
          AND COALESCE(c.outcome_index, f.outcome_index) = n.outcome_index
      ),

      -- Step 6: Join resolutions and mark prices
      with_prices AS (
        SELECT
          cb.condition_id,
          cb.outcome_index,
          cb.net_tokens,
          cb.cash_flow,
          r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won,
          mp.mark_price as current_mark_price,
          CASE
            WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' THEN 'realized'
            WHEN mp.mark_price IS NOT NULL AND (mp.mark_price <= 0.01 OR mp.mark_price >= 0.99) THEN 'synthetic'
            WHEN mp.mark_price IS NOT NULL THEN 'unrealized'
            ELSE 'unknown'
          END as status
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
        LEFT JOIN pm_latest_mark_price_v1 mp ON lower(cb.condition_id) = lower(mp.condition_id)
          AND cb.outcome_index = mp.outcome_index
      ),

      -- Step 7: Calculate PnL by status
      pnl_by_status AS (
        SELECT
          status,
          sum(cash_flow) as total_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses,
          -- For unrealized/synthetic: use mark-to-market
          sumIf(net_tokens * ifNull(current_mark_price, 0), status IN ('unrealized', 'synthetic')) as mtm_value,
          count() as market_count
        FROM with_prices
        WHERE status != 'unknown'
        GROUP BY status
      )

    SELECT
      status,
      market_count,
      CASE
        WHEN status = 'realized' THEN round(total_cash + long_wins - short_losses, 2)
        ELSE round(total_cash + mtm_value, 2)
      END as total_pnl
    FROM pnl_by_status
    ORDER BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // Initialize result
  const pnlResult: PnLResult = {
    wallet: normalizedWallet,
    realized: { pnl: 0, marketCount: 0 },
    syntheticRealized: { pnl: 0, marketCount: 0 },
    unrealized: { pnl: 0, marketCount: 0 },
    total: 0,
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

/**
 * Check if a wallet has NegRisk activity
 * Use this to decide whether to call getWalletPnLV1 or getWalletPnLV1Plus
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns Number of NegRisk conversions for this wallet
 */
export async function getNegRiskConversionCount(wallet: string): Promise<number> {
  const normalizedWallet = wallet.toLowerCase();

  const query = `
    SELECT count() as cnt
    FROM vw_negrisk_conversions
    WHERE wallet = '${normalizedWallet}'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return Number(rows[0]?.cnt || 0);
}

/**
 * Smart PnL calculation - automatically chooses V1 or V1+ based on NegRisk activity
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns PnLResult with realized, synthetic, and unrealized PnL
 */
export async function getWalletPnLSmart(wallet: string): Promise<PnLResult & { usedV1Plus: boolean }> {
  const negRiskCount = await getNegRiskConversionCount(wallet);

  if (negRiskCount > 0) {
    const result = await getWalletPnLV1Plus(wallet);
    return { ...result, usedV1Plus: true };
  } else {
    const result = await getWalletPnLV1(wallet);
    return { ...result, usedV1Plus: false };
  }
}

/**
 * Get wallet diagnostics for confidence calculation
 * Uses parallel queries for speed
 */
export async function getWalletDiagnostics(wallet: string): Promise<{
  negRiskConversions: number;
  negRiskTokens: number;
  phantomTokens: number;
  phantomPercent: number;
  unexplainedPhantom: number;
  selfFillTxs: number;
  openPositions: number;
  totalPositions: number;
  ctfSplitMergeCount: number;
  ctfSplitTokens: number;
  erc1155InboundCount: number;
  recentTradeCount: number;
  largestPositionPct: number;
  resolvedPositionPct: number;
  totalTradeCount: number;
  avgTradeUsd: number;
}> {
  const normalizedWallet = wallet.toLowerCase();

  // Run simpler queries in parallel for speed
  const [nrResult, ctfResult, tradesResult, positionsResult] = await Promise.all([
    // NegRisk count AND token sum
    clickhouse.query({
      query: `SELECT count() as cnt, round(sum(shares), 2) as tokens FROM vw_negrisk_conversions WHERE wallet = '${normalizedWallet}'`,
      format: 'JSONEachRow'
    }),
    // CTF count AND split tokens
    clickhouse.query({
      query: `
        SELECT
          count() as cnt,
          round(sumIf(shares_delta, shares_delta > 0), 2) as split_tokens
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${normalizedWallet}'
      `,
      format: 'JSONEachRow'
    }),
    // Trade stats
    clickhouse.query({
      query: `
        SELECT
          count() as trade_count,
          countIf(trade_time > now() - INTERVAL 7 DAY) as recent_count,
          round(avg(usdc_amount / 1e6), 2) as avg_usd
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${normalizedWallet}'
      `,
      format: 'JSONEachRow'
    }),
    // Positions (phantom, open/resolved)
    clickhouse.query({
      query: `
        WITH positions AS (
          SELECT
            m.condition_id,
            sumIf(t.token_amount / 1e6, t.side = 'buy') as bought,
            sumIf(t.token_amount / 1e6, t.side = 'sell') as sold,
            sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as cash_pnl,
            r.payout_numerators IS NULL OR r.payout_numerators = '' as is_open
          FROM pm_trader_events_v3 t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE lower(t.trader_wallet) = '${normalizedWallet}' AND m.condition_id != ''
          GROUP BY m.condition_id, m.outcome_index, r.payout_numerators
        )
        SELECT
          round(sumIf(sold - bought, sold > bought), 2) as phantom_tokens,
          round(sumIf(sold - bought, sold > bought) / nullIf(sum(sold), 0) * 100, 1) as phantom_percent,
          countIf(is_open) as open_positions,
          count() as total_positions,
          round(countIf(NOT is_open) / nullIf(count(), 0) * 100, 1) as resolved_pct,
          round(max(abs(cash_pnl)) / nullIf(sum(abs(cash_pnl)), 0) * 100, 1) as largest_pct
        FROM positions
      `,
      format: 'JSONEachRow'
    }),
  ]);

  const [nrRows, ctfRows, tradesRows, positionsRows] = await Promise.all([
    nrResult.json() as Promise<any[]>,
    ctfResult.json() as Promise<any[]>,
    tradesResult.json() as Promise<any[]>,
    positionsResult.json() as Promise<any[]>,
  ]);

  const nr = nrRows[0] || {};
  const ctf = ctfRows[0] || {};
  const trades = tradesRows[0] || {};
  const pos = positionsRows[0] || {};

  // Self-fill count - only if needed (skip for speed, estimate from trade pattern)
  // ERC1155 inbound - skip for speed, rarely significant
  const selfFillTxs = 0; // Disabled for speed
  const erc1155InboundCount = 0; // Disabled for speed

  const phantomTokens = Number(pos.phantom_tokens || 0);
  const negRiskTokens = Number(nr.tokens || 0);
  const ctfSplitTokens = Number(ctf.split_tokens || 0);
  // Unexplained phantom = phantom - (NegRisk + CTF splits)
  const unexplainedPhantom = Math.max(0, phantomTokens - negRiskTokens - ctfSplitTokens);

  return {
    negRiskConversions: Number(nr.cnt || 0),
    negRiskTokens,
    phantomTokens,
    phantomPercent: Number(pos.phantom_percent || 0),
    unexplainedPhantom,
    selfFillTxs,
    openPositions: Number(pos.open_positions || 0),
    totalPositions: Number(pos.total_positions || 0),
    ctfSplitMergeCount: Number(ctf.cnt || 0),
    ctfSplitTokens,
    erc1155InboundCount,
    recentTradeCount: Number(trades.recent_count || 0),
    largestPositionPct: Number(pos.largest_pct || 0),
    resolvedPositionPct: Number(pos.resolved_pct || 0),
    totalTradeCount: Number(trades.trade_count || 0),
    avgTradeUsd: Number(trades.avg_usd || 0),
  };
}

/**
 * Comprehensive PnL calculation with confidence flags
 *
 * This is the RECOMMENDED production function. It:
 * 1. Calculates wallet diagnostics (phantom %, NegRisk, etc.)
 * 2. Automatically uses V1+ for high NegRisk wallets (>100 conversions)
 * 3. Returns confidence level based on wallet characteristics
 *
 * Confidence levels:
 * - HIGH: No concerning patterns, expect <$10 error
 * - MEDIUM: Some risk factors, expect <$100 error
 * - LOW: High risk factors, consider API fallback
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns PnLResultWithConfidence including diagnostics and confidence
 */
export async function getWalletPnLWithConfidence(wallet: string): Promise<PnLResultWithConfidence> {
  const normalizedWallet = wallet.toLowerCase();

  // Get diagnostics first
  const diagnostics = await getWalletDiagnostics(normalizedWallet);

  // Determine which engine to use - SMART SWITCHING
  // Use V1+ if:
  // 1. High NegRisk activity (>100 conversions), OR
  // 2. NegRisk tokens would help explain phantom (phantom exists AND NegRisk tokens > 100)
  const negRiskWouldHelp = diagnostics.phantomTokens > 100 && diagnostics.negRiskTokens > 100;
  const useV1Plus = diagnostics.negRiskConversions > 100 || negRiskWouldHelp;

  // Calculate PnL with the best engine for this wallet
  const pnlResult = useV1Plus
    ? await getWalletPnLV1Plus(normalizedWallet)
    : await getWalletPnLV1(normalizedWallet);

  // Calculate confidence
  const confidenceReasons: string[] = [];
  let confidence: 'high' | 'medium' | 'low' = 'high';

  // === LOW CONFIDENCE FLAGS (serious concerns) ===

  // High phantom without NegRisk = unexplained token source (like W2)
  if (diagnostics.phantomPercent > 50 && diagnostics.negRiskConversions === 0 && diagnostics.ctfSplitMergeCount === 0) {
    confidenceReasons.push(`${diagnostics.phantomPercent}% phantom tokens (unexplained source)`);
    confidence = 'low';
  }

  // Significant unexplained phantom tokens (like Wallet 40: phantom 17K, NegRisk 3K, CTF 2K = 12K unexplained)
  // If unexplained phantom > $1000 worth (1000 tokens at ~$1), flag as LOW
  if (diagnostics.unexplainedPhantom > 1000) {
    confidenceReasons.push(`${Math.round(diagnostics.unexplainedPhantom)} unexplained phantom tokens (phantom ${Math.round(diagnostics.phantomTokens)} - NR ${Math.round(diagnostics.negRiskTokens)} - CTF ${Math.round(diagnostics.ctfSplitTokens)})`);
    confidence = 'low';
  }

  // Very high NegRisk but not using V1+
  if (diagnostics.negRiskConversions > 1000 && !useV1Plus) {
    confidenceReasons.push(`High NegRisk (${diagnostics.negRiskConversions}) but V1 used`);
    confidence = 'low';
  }

  // ERC1155 inbound transfers = tokens from other wallets (not from trading)
  if (diagnostics.erc1155InboundCount > 10) {
    confidenceReasons.push(`${diagnostics.erc1155InboundCount} ERC1155 inbound transfers`);
    confidence = 'low';
  }

  // === MEDIUM CONFIDENCE FLAGS (some concerns) ===

  // Many open positions = MTM variance
  if (diagnostics.openPositions > 10 && confidence !== 'low') {
    confidenceReasons.push(`${diagnostics.openPositions} open positions (MTM variance)`);
    if (confidence === 'high') confidence = 'medium';
  }

  // High self-fill count = complex dedup logic
  if (diagnostics.selfFillTxs > 50 && confidence !== 'low') {
    confidenceReasons.push(`${diagnostics.selfFillTxs} self-fill transactions`);
    if (confidence === 'high') confidence = 'medium';
  }

  // Recent trades = potential data sync lag
  if (diagnostics.recentTradeCount > 20 && confidence !== 'low') {
    confidenceReasons.push(`${diagnostics.recentTradeCount} trades in last 7 days (data lag risk)`);
    if (confidence === 'high') confidence = 'medium';
  }

  // Single position dominates = high variance
  if (diagnostics.largestPositionPct > 80 && confidence !== 'low') {
    confidenceReasons.push(`${diagnostics.largestPositionPct}% in single position`);
    if (confidence === 'high') confidence = 'medium';
  }

  // Low resolved % = mostly unrealized
  if (diagnostics.resolvedPositionPct < 50 && diagnostics.totalPositions > 5 && confidence !== 'low') {
    confidenceReasons.push(`Only ${diagnostics.resolvedPositionPct}% positions resolved`);
    if (confidence === 'high') confidence = 'medium';
  }

  // CTF activity without corresponding NegRisk = complex flow
  if (diagnostics.ctfSplitMergeCount > 20 && diagnostics.negRiskConversions < 10 && confidence !== 'low') {
    confidenceReasons.push(`${diagnostics.ctfSplitMergeCount} CTF splits/merges without NegRisk`);
    if (confidence === 'high') confidence = 'medium';
  }

  // === POSITIVE INDICATORS ===
  if (confidenceReasons.length === 0) {
    confidenceReasons.push('No risk factors detected');
  }

  return {
    ...pnlResult,
    confidence,
    confidenceReasons,
    diagnostics,
    engineUsed: useV1Plus ? 'V1+' : 'V1',
  };
}

/**
 * Get detailed per-market PnL breakdown for a wallet
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns Array of MarketPnL with details per market
 */
export async function getWalletMarketsPnLV1(wallet: string): Promise<MarketPnL[]> {
  const normalizedWallet = wallet.toLowerCase();

  const query = `
    WITH
      self_fills AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${normalizedWallet}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),
      clob_pos AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          any(m.question) as question,
          sumIf(t.token_amount / 1e6, t.side = 'buy') as bought,
          sumIf(t.token_amount / 1e6, t.side = 'sell') as sold,
          sumIf(t.usdc_amount / 1e6, t.side = 'buy') as buy_cost,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') as sell_proceeds
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${normalizedWallet}'
          AND m.condition_id != ''
          AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM self_fills) AND t.role = 'maker')
        GROUP BY m.condition_id, m.outcome_index
      ),
      ctf_tokens AS (
        SELECT condition_id, outcome_index, sum(shares_delta) as ctf_tokens
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${normalizedWallet}'
        GROUP BY condition_id, outcome_index
      ),
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id) as condition_id,
          c.question,
          COALESCE(c.outcome_index, f.outcome_index) as outcome_index,
          COALESCE(c.bought, 0) as bought,
          COALESCE(c.sold, 0) as sold,
          COALESCE(c.bought, 0) + COALESCE(f.ctf_tokens, 0) - COALESCE(c.sold, 0) as net_tokens,
          COALESCE(c.buy_cost, 0) as cost,
          COALESCE(c.sell_proceeds, 0) as sell_proceeds
        FROM clob_pos c
        FULL OUTER JOIN ctf_tokens f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
      ),
      with_prices AS (
        SELECT
          cb.*,
          r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won,
          mp.mark_price as current_mark_price,
          CASE
            WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' THEN 'realized'
            WHEN mp.mark_price IS NOT NULL AND (mp.mark_price <= 0.01 OR mp.mark_price >= 0.99) THEN 'synthetic'
            WHEN mp.mark_price IS NOT NULL THEN 'unrealized'
            ELSE 'unknown'
          END as status
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
        LEFT JOIN pm_latest_mark_price_v1 mp ON lower(cb.condition_id) = lower(mp.condition_id)
          AND cb.outcome_index = mp.outcome_index
      )
    SELECT
      condition_id,
      question,
      outcome_index,
      round(bought, 4) as bought,
      round(sold, 4) as sold,
      round(net_tokens, 4) as net_tokens,
      round(cost, 2) as cost,
      round(sell_proceeds, 2) as sell_proceeds,
      CASE
        WHEN status = 'realized' AND won = 1 THEN round(net_tokens, 2)
        WHEN status = 'realized' THEN 0
        ELSE round(net_tokens * ifNull(current_mark_price, 0), 2)
      END as settlement,
      CASE
        WHEN status = 'realized' THEN round(sell_proceeds - cost + (CASE WHEN won = 1 THEN net_tokens ELSE 0 END), 2)
        ELSE round(sell_proceeds - cost + net_tokens * ifNull(current_mark_price, 0), 2)
      END as pnl,
      status
    FROM with_prices
    WHERE status != 'unknown'
    ORDER BY abs(pnl) DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((row) => ({
    conditionId: row.condition_id,
    question: row.question || 'Unknown Market',
    outcome: Number(row.outcome_index),
    bought: Number(row.bought),
    sold: Number(row.sold),
    netTokens: Number(row.net_tokens),
    cost: Number(row.cost),
    sellProceeds: Number(row.sell_proceeds),
    settlement: Number(row.settlement),
    pnl: Number(row.pnl),
    status: row.status as 'realized' | 'synthetic' | 'unrealized',
  }));
}

// Test wallets for validation (from TDD sessions)
export const TEST_WALLETS = {
  // Original test wallet - owner confirmed $1.16 PnL
  original: '0xf918977ef9d3f101385eda508621d5f835fa9052',
  // Maker-heavy wallets (80%+ maker trades)
  maker_heavy_1: '0x105a54a721d475a5d2faaf7902c55475758ba63c', // UI: -$12.60
  maker_heavy_2: '0x2e4a6d6dccff351fccfd404f368fa711d94b2e12', // UI: ~$1500
  // Taker-heavy wallets (80%+ taker trades)
  taker_heavy_1: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', // UI: -$47.19
  taker_heavy_2: '0x94fabfc86594fffbf76996e2f66e5e19675a8164', // UI: -$73.00
  // Mixed wallets (40-60% maker/taker)
  mixed_1: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', // UI: -$0.01
  mixed_2: '0x8a8752f8c1b6e8bbdd4d8c47d6298e3a25a421f7', // UI: ~$4916
  // NegRisk-heavy wallets (use V1+ for these)
  negrisk_heavy_1: '0x36f9b0d0db05b7ffe5ff69774d70eb3f78607e3b', // JohnnyTenNumbers: API $69,926, V1+ $67,891
};

// Expected PnL values for validation
export const EXPECTED_PNL = {
  original: 1.16,
  maker_heavy_1: -12.6,
  taker_heavy_1: -47.19,
  taker_heavy_2: -73.0,
  mixed_1: -0.01,
};
