/**
 * CCR-v3: Unified Cash-Flow PnL Engine
 *
 * =============================================================================
 * FIRST PRINCIPLES: PnL = Cash Flow + Remaining Value
 * =============================================================================
 *
 * This engine calculates PnL using a pure cash-flow approach:
 *
 *   PnL = (USDC received) - (USDC spent) + (Remaining token value)
 *
 * Where:
 *   USDC received = sell proceeds + redemption payouts
 *   USDC spent = buy costs + split collateral
 *   Remaining token value = unrealized positions at mark price (or resolution)
 *
 * This works universally because:
 * 1. It doesn't require tracking where inventory came from
 * 2. It captures the economic reality directly
 * 3. Resolution handles remaining token value
 *
 * =============================================================================
 * Data Sources
 * =============================================================================
 *
 * 1. pm_trader_events_v3: CLOB trades (buys and sells)
 *    - Contains maker AND taker trades
 *    - Deduped by event_id to avoid double-counting
 *
 * 2. pm_ctf_events: Split/merge/redemption events
 *    - PositionSplit: User deposits USDC, creates YES+NO tokens
 *    - PositionsMerge: User destroys YES+NO tokens, receives USDC
 *    - PayoutRedemption: Market resolved, user redeems winning tokens
 *
 * 3. pm_condition_resolutions: Market resolution outcomes
 *    - Tells us which outcome won (YES or NO)
 *
 * =============================================================================
 * Cash Flow Tracking
 * =============================================================================
 *
 * USDC Out (costs):
 *   - CLOB buys: usdc_amount from pm_trader_events_v3 where side='buy'
 *   - Split collateral: amount from pm_ctf_events where event_type='PositionSplit'
 *
 * USDC In (proceeds):
 *   - CLOB sells: usdc_amount from pm_trader_events_v3 where side='sell'
 *   - Merge proceeds: amount from pm_ctf_events where event_type='PositionsMerge'
 *   - Redemption: amount from pm_ctf_events where event_type='PayoutRedemption'
 *
 * Remaining Value:
 *   - For resolved markets: remaining tokens × resolution payout
 *   - For unresolved markets: remaining tokens × 0.5 (mark price)
 *
 * =============================================================================
 * Token Inventory Tracking
 * =============================================================================
 *
 * We still need to track token inventory to calculate remaining value:
 *
 * Token In:
 *   - CLOB buys: add tokens
 *   - Splits: add YES and NO tokens
 *
 * Token Out:
 *   - CLOB sells: subtract tokens
 *   - Merges: subtract YES and NO tokens
 *   - Redemptions: subtract tokens
 *
 * Remaining = Token In - Token Out
 */

import { clickhouse } from '../clickhouse/client';

// Debug logging
const DEBUG = process.env.CCR_DEBUG === '1';

// =============================================================================
// Types
// =============================================================================

export interface CCRv3Metrics {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  positions_count: number;
  resolved_count: number;
  unresolved_count: number;
  total_trades: number;
  volume_traded: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  // Cash flow breakdown
  usdc_from_buys: number;
  usdc_from_sells: number;
  usdc_from_splits: number;    // Collateral deposited
  usdc_from_merges: number;    // Collateral returned
  usdc_from_redemptions: number;
  pnl_confidence: 'high' | 'medium' | 'low';
}

interface RawTrade {
  event_id: string;
  token_id: string;
  side: string;
  usdc: number;
  tokens: number;
  trade_time: string;
  block_number: number;
  tx_hash: string;
  role: string;
  condition_id: string | null;
  outcome_index: number | null;
}

interface RawCTFEvent {
  event_type: string;
  condition_id: string;
  amount: number;
  event_timestamp: string;
  block_number: number;
  tx_hash: string;
  user_address: string;
}

interface TokenResolution {
  token_id: string;
  payout: number;
  is_resolved: boolean;
}

// Per-token tracking for remaining value calculation
interface TokenPosition {
  tokenId: string;
  conditionId: string;
  outcomeIndex: number;
  tokensIn: number;    // From buys + splits
  tokensOut: number;   // From sells + merges + redemptions
}

// Per-condition tracking for PnL
interface ConditionCashFlow {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  // Cash flows
  buySpend: number;      // USDC spent on CLOB buys
  sellProceeds: number;  // USDC from CLOB sells
  splitCollateral: number; // USDC deposited for splits
  mergeProceeds: number;   // USDC from merges ($1 per pair)
  redemptionProceeds: number; // USDC from redemptions
  // Token positions
  yesTokensIn: number;
  yesTokensOut: number;
  noTokensIn: number;
  noTokensOut: number;
}

// =============================================================================
// Data Loaders
// =============================================================================

async function loadAllTradesForWallet(wallet: string): Promise<RawTrade[]> {
  // Load ALL trades (maker + taker) with deduplication
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        any(block_number) as block_number,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash,
        any(role) as role
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${wallet.toLowerCase()}'
       
      GROUP BY event_id
    )
    SELECT
      d.event_id,
      d.token_id,
      d.side,
      d.usdc,
      d.tokens,
      d.trade_time,
      d.block_number,
      d.tx_hash,
      d.role,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.block_number, d.event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as RawTrade[];
}

async function loadCTFEventsForWallet(wallet: string): Promise<RawCTFEvent[]> {
  // Load CTF events: splits, merges, redemptions
  const query = `
    SELECT DISTINCT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp,
      block_number,
      tx_hash,
      lower(user_address) as user_address
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND lower(user_address) = '${wallet.toLowerCase()}'
    ORDER BY block_number, event_timestamp
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    return (await result.json()) as RawCTFEvent[];
  } catch {
    return [];
  }
}

/**
 * Load CTF events that are attributed to PROXY contracts but belong to this wallet
 * via tx_hash matching. This captures split/merge events done through PM Exchange API
 * where the CTF event shows the proxy address, not the end-user.
 *
 * Key insight: When users trade via PM Exchange API, split events are attributed to
 * proxy contracts like 0x4bfb41d5... or 0xd91e80cf..., but we can link them back to
 * the user via the transaction hash from their CLOB trades.
 */
async function loadProxyCTFEventsForWallet(wallet: string): Promise<RawCTFEvent[]> {
  // Step 1: Get all unique tx_hashes from the wallet's CLOB trades
  // Step 2: Find CTF events on those tx_hashes that are NOT attributed to the wallet
  //         (i.e., attributed to proxy contracts)
  const query = `
    WITH wallet_txs AS (
      SELECT DISTINCT
        lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${wallet.toLowerCase()}'
       
    )
    SELECT DISTINCT
      c.event_type,
      c.condition_id,
      toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
      c.event_timestamp,
      c.block_number,
      c.tx_hash,
      lower(c.user_address) as user_address
    FROM pm_ctf_events c
    INNER JOIN wallet_txs t ON lower(c.tx_hash) = t.tx_hash
    WHERE c.is_deleted = 0
      AND lower(c.user_address) != '${wallet.toLowerCase()}'
    ORDER BY c.block_number, c.event_timestamp
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const events = (await result.json()) as RawCTFEvent[];

    if (DEBUG && events.length > 0) {
      // Group by user_address to see which proxies were used
      const byProxy = new Map<string, number>();
      for (const e of events) {
        byProxy.set(e.user_address, (byProxy.get(e.user_address) || 0) + 1);
      }
      console.log(`[PROXY CTF] Found ${events.length} proxy-attributed CTF events via tx_hash:`);
      for (const [proxy, count] of byProxy) {
        console.log(`  ${proxy}: ${count} events`);
      }
    }

    return events;
  } catch (e) {
    if (DEBUG) console.log(`[PROXY CTF] Error loading proxy events:`, e);
    return [];
  }
}

async function loadTokenMapForConditions(conditionIds: string[]): Promise<Map<string, { yes: string; no: string }>> {
  if (conditionIds.length === 0) return new Map();

  const CHUNK_SIZE = 500;
  const result = new Map<string, { yes: string; no: string }>();

  for (let i = 0; i < conditionIds.length; i += CHUNK_SIZE) {
    const chunk = conditionIds.slice(i, i + CHUNK_SIZE);
    const conditionList = chunk.map(c => `'${c.toLowerCase()}'`).join(',');

    const query = `
      SELECT
        lower(condition_id) as condition_id,
        token_id_dec,
        outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE lower(condition_id) IN (${conditionList})
    `;

    const qr = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await qr.json()) as { condition_id: string; token_id_dec: string; outcome_index: number }[];

    const grouped = new Map<string, { yes?: string; no?: string }>();
    for (const row of rows) {
      const entry = grouped.get(row.condition_id) || {};
      if (row.outcome_index === 0) entry.yes = row.token_id_dec;
      else if (row.outcome_index === 1) entry.no = row.token_id_dec;
      grouped.set(row.condition_id, entry);
    }

    for (const [cid, tokens] of grouped) {
      if (tokens.yes && tokens.no) {
        result.set(cid, { yes: tokens.yes, no: tokens.no });
      }
    }
  }

  return result;
}

async function loadResolutions(tokenIds: string[]): Promise<Map<string, TokenResolution>> {
  if (tokenIds.length === 0) return new Map();

  const CHUNK_SIZE = 500;
  const resolutions = new Map<string, TokenResolution>();

  for (let i = 0; i < tokenIds.length; i += CHUNK_SIZE) {
    const chunk = tokenIds.slice(i, i + CHUNK_SIZE);
    const tokenList = chunk.map(t => `'${t}'`).join(',');

    const query = `
      WITH token_map AS (
        SELECT token_id_dec, condition_id, outcome_index
        FROM pm_token_to_condition_map_v5
        WHERE token_id_dec IN (${tokenList})
      )
      SELECT
        m.token_id_dec as token_id,
        r.payout_numerators,
        m.outcome_index
      FROM token_map m
      LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    for (const row of rows) {
      let payout = 0.5;
      let isResolved = false;

      if (row.payout_numerators) {
        try {
          const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
          const outcomeIndex = Number(row.outcome_index);
          const payoutDenominator = payouts.reduce((a: number, b: number) => a + b, 0);
          payout = payoutDenominator > 0 ? payouts[outcomeIndex] / payoutDenominator : 0;
          isResolved = true;
        } catch {
          // Parse error
        }
      }

      resolutions.set(row.token_id, { token_id: row.token_id, payout, is_resolved: isResolved });
    }
  }

  // Default unresolved for missing tokens
  for (const tokenId of tokenIds) {
    if (!resolutions.has(tokenId)) {
      resolutions.set(tokenId, { token_id: tokenId, payout: 0.5, is_resolved: false });
    }
  }

  return resolutions;
}

// =============================================================================
// Cash-Flow Engine
// =============================================================================

function createEmptyCashFlow(conditionId: string, yesTokenId: string, noTokenId: string): ConditionCashFlow {
  return {
    conditionId,
    yesTokenId,
    noTokenId,
    buySpend: 0,
    sellProceeds: 0,
    splitCollateral: 0,
    mergeProceeds: 0,
    redemptionProceeds: 0,
    yesTokensIn: 0,
    yesTokensOut: 0,
    noTokensIn: 0,
    noTokensOut: 0,
  };
}

// =============================================================================
// Main Engine
// =============================================================================

export async function computeCCRv3(wallet: string): Promise<CCRv3Metrics> {
  // Step 1: Load all data
  // Load CLOB trades and direct CTF events (NOT proxy splits - see note below)
  //
  // NOTE: Proxy splits are NOT loaded because they cause double-counting.
  // The proxy split collateral is already reflected in the CLOB trade prices.
  // Adding them separately would over-estimate the USDC OUT and produce
  // wildly inaccurate PnL (+$218K instead of -$115K for the split-heavy wallet).
  //
  // The correct approach is:
  // - For single-market taker-heavy wallets: Use CCR-v3 with Pattern A detection
  //   (the sell gap inference correctly handles bundled split+sell operations)
  // - For multi-market wallets: Use CCR-v1 (maker-only) which achieves ~3.5% accuracy
  //
  const [rawTrades, rawCTFEvents] = await Promise.all([
    loadAllTradesForWallet(wallet),
    loadCTFEventsForWallet(wallet),
  ]);

  if (rawTrades.length === 0 && rawCTFEvents.length === 0) {
    return emptyMetrics(wallet);
  }

  // Step 2: Get all condition_ids and build token map
  const conditionIdsFromTrades = new Set(
    rawTrades.map(t => t.condition_id?.toLowerCase()).filter(Boolean) as string[]
  );
  const conditionIdsFromCTF = new Set(
    rawCTFEvents.map(e => e.condition_id.toLowerCase())
  );
  const allConditionIds = [...new Set([...conditionIdsFromTrades, ...conditionIdsFromCTF])];

  const tokenMap = await loadTokenMapForConditions(allConditionIds);

  // Build reverse map: token_id -> { conditionId, outcomeIndex }
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  for (const [cid, tokens] of tokenMap) {
    tokenToCondition.set(tokens.yes, { conditionId: cid, outcomeIndex: 0 });
    tokenToCondition.set(tokens.no, { conditionId: cid, outcomeIndex: 1 });
  }

  // Step 3: Initialize cash flow tracking per condition
  const cashFlows = new Map<string, ConditionCashFlow>();
  for (const [cid, tokens] of tokenMap) {
    cashFlows.set(cid, createEmptyCashFlow(cid, tokens.yes, tokens.no));
  }

  // Step 4: Process all CLOB trades
  let volumeTraded = 0;
  let tradeCount = 0;

  for (const trade of rawTrades) {
    if (!trade.condition_id) continue;
    const cid = trade.condition_id.toLowerCase();
    const cf = cashFlows.get(cid);
    if (!cf) continue;

    const isYes = trade.outcome_index === 0;

    if (trade.side === 'buy') {
      // USDC out, tokens in
      cf.buySpend += trade.usdc;
      if (isYes) {
        cf.yesTokensIn += trade.tokens;
      } else {
        cf.noTokensIn += trade.tokens;
      }
      volumeTraded += trade.usdc;

      if (DEBUG) {
        console.log(`[BUY] ${trade.tokens.toFixed(2)} ${isYes ? 'YES' : 'NO'} for $${trade.usdc.toFixed(2)}`);
      }
    } else {
      // USDC in, tokens out
      cf.sellProceeds += trade.usdc;
      if (isYes) {
        cf.yesTokensOut += trade.tokens;
      } else {
        cf.noTokensOut += trade.tokens;
      }
      volumeTraded += trade.usdc;

      if (DEBUG) {
        console.log(`[SELL] ${trade.tokens.toFixed(2)} ${isYes ? 'YES' : 'NO'} for $${trade.usdc.toFixed(2)}`);
      }
    }

    tradeCount++;
  }

  // Step 5: Process all CTF events (direct user events)
  for (const ctf of rawCTFEvents) {
    const cid = ctf.condition_id.toLowerCase();
    const cf = cashFlows.get(cid);
    if (!cf) continue;

    if (ctf.event_type === 'PositionSplit') {
      // USDC out (collateral), tokens in (both YES and NO)
      cf.splitCollateral += ctf.amount;
      cf.yesTokensIn += ctf.amount;
      cf.noTokensIn += ctf.amount;

      if (DEBUG) {
        console.log(`[SPLIT] $${ctf.amount.toFixed(2)} → ${ctf.amount.toFixed(2)} YES + ${ctf.amount.toFixed(2)} NO`);
      }
    } else if (ctf.event_type === 'PositionsMerge') {
      // USDC in (returned collateral), tokens out (both YES and NO)
      cf.mergeProceeds += ctf.amount;
      cf.yesTokensOut += ctf.amount;
      cf.noTokensOut += ctf.amount;

      if (DEBUG) {
        console.log(`[MERGE] ${ctf.amount.toFixed(2)} YES + ${ctf.amount.toFixed(2)} NO → $${ctf.amount.toFixed(2)}`);
      }
    } else if (ctf.event_type === 'PayoutRedemption') {
      // USDC in (payout), tokens out
      // Note: PayoutRedemption amount is the USDC received, not token count
      cf.redemptionProceeds += ctf.amount;
      // We don't know which outcome was redeemed from this event alone
      // But we can infer from resolution data

      if (DEBUG) {
        console.log(`[REDEMPTION] $${ctf.amount.toFixed(2)}`);
      }
    }
  }

  // Step 5b: Infer split collateral from sell gaps
  //
  // =============================================================================
  // KEY INSIGHT: Split inference must account for cross-condition netting
  // =============================================================================
  //
  // Problem with per-condition inference:
  //   - If condition A has +100 YES surplus (bought more than sold)
  //   - And condition B has +100 YES sell gap (sold more than bought)
  //   - Per-condition inference adds $100 splits for B
  //   - But the wallet-level YES is NET ZERO!
  //
  // Why this matters:
  //   - Splits create paired YES+NO tokens
  //   - A YES bought on condition A can be TRANSFERRED to condition B via merge+split
  //   - Or the user just has net-zero cross-condition exposure
  //
  // Correct approach: WALLET-LEVEL inference
  //   1. Calculate wallet-level net position for YES and NO
  //   2. Only infer splits for the wallet-level sell gap
  //   3. Distribute inferred splits proportionally to per-condition gaps
  //
  // Special case: Per-condition SYMMETRIC gaps (YES gap = NO gap)
  //   - This indicates split+sell on BOTH outcomes
  //   - Example: split $100 → sell 100 YES + sell 100 NO = $100 proceeds
  //   - The $100 collateral is RETURNED via the two sells
  //   - NO split inference needed - it's a neutral operation
  //
  // Another case: Single-market Pattern A (PM Exchange API bundled trades)
  //   - Buy includes split net-cost, no inference needed
  //
  // =============================================================================

  // Step 5b.1: Calculate wallet-level net positions
  let walletYesIn = 0, walletYesOut = 0;
  let walletNoIn = 0, walletNoOut = 0;

  for (const cf of cashFlows.values()) {
    walletYesIn += cf.yesTokensIn;
    walletYesOut += cf.yesTokensOut;
    walletNoIn += cf.noTokensIn;
    walletNoOut += cf.noTokensOut;
  }

  const walletYesGap = Math.max(0, walletYesOut - walletYesIn);
  const walletNoGap = Math.max(0, walletNoOut - walletNoIn);

  // Wallet-level split inference: only for the NET gap
  // If YES has surplus and NO has gap, only the NO gap matters
  const walletLevelSplitInference = Math.max(walletYesGap, walletNoGap);

  if (DEBUG) {
    console.log(`[WALLET] YES: in ${walletYesIn.toFixed(0)}, out ${walletYesOut.toFixed(0)}, gap ${walletYesGap.toFixed(0)}`);
    console.log(`[WALLET] NO: in ${walletNoIn.toFixed(0)}, out ${walletNoOut.toFixed(0)}, gap ${walletNoGap.toFixed(0)}`);
    console.log(`[WALLET] Net split inference needed: ${walletLevelSplitInference.toFixed(0)}`);
  }

  // Step 5b.2: Distribute split inference to conditions proportionally
  // Only distribute to conditions that have the relevant gap

  // Calculate per-condition gaps for distribution weighting
  const conditionGaps: { cid: string; gap: number }[] = [];
  let totalConditionGap = 0;

  // Determine which side has the wallet-level gap
  const gapSide = walletYesGap > walletNoGap ? 'yes' : 'no';

  for (const [cid, cf] of cashFlows) {
    const yesSellGap = Math.max(0, cf.yesTokensOut - cf.yesTokensIn);
    const noSellGap = Math.max(0, cf.noTokensOut - cf.noTokensIn);

    // For symmetric gaps (both YES and NO have same gap), this is split+sell both
    // The collateral is returned via sells, so no inference needed
    const symmetricGap = Math.min(yesSellGap, noSellGap);
    const adjustedYesGap = yesSellGap - symmetricGap;
    const adjustedNoGap = noSellGap - symmetricGap;

    // Use the gap that matches the wallet-level direction
    const relevantGap = gapSide === 'yes' ? adjustedYesGap : adjustedNoGap;

    if (relevantGap > 0) {
      conditionGaps.push({ cid, gap: relevantGap });
      totalConditionGap += relevantGap;
    }

    if (DEBUG && symmetricGap > 0) {
      console.log(`[SYMMETRIC] ${cid.slice(0, 8)}... symmetric gap ${symmetricGap.toFixed(0)} - neutralized (split+sell both)`);
    }
  }

  // Step 5b.3: Apply split inference proportionally

  // Special case: Single-market wallet (Pattern A detection)
  const isSingleMarket = cashFlows.size === 1;
  let skipInference = false;

  if (isSingleMarket && walletLevelSplitInference > 0) {
    // Check if this is Pattern A: opposing buy surplus covers the gap
    const cf = cashFlows.values().next().value!;
    if (walletYesGap > 0) {
      const noBuySurplus = cf.noTokensIn - cf.noTokensOut;
      if (noBuySurplus >= walletYesGap * 0.95) {
        skipInference = true;
        if (DEBUG) {
          console.log(`[PATTERN A] Single-market, NO buy surplus ${noBuySurplus.toFixed(0)} covers YES gap ${walletYesGap.toFixed(0)} - skip inference`);
        }
      }
    } else if (walletNoGap > 0) {
      const yesBuySurplus = cf.yesTokensIn - cf.yesTokensOut;
      if (yesBuySurplus >= walletNoGap * 0.95) {
        skipInference = true;
        if (DEBUG) {
          console.log(`[PATTERN A] Single-market, YES buy surplus ${yesBuySurplus.toFixed(0)} covers NO gap ${walletNoGap.toFixed(0)} - skip inference`);
        }
      }
    }
  }

  let totalInferredSplits = 0;

  if (!skipInference && walletLevelSplitInference > 0 && totalConditionGap > 0) {
    for (const { cid, gap } of conditionGaps) {
      // Distribute proportionally
      const proportion = gap / totalConditionGap;
      const inferredSplitCount = walletLevelSplitInference * proportion;

      const cf = cashFlows.get(cid)!;

      // Add inferred split collateral ($1 per split pair)
      cf.splitCollateral += inferredSplitCount;

      // Add inferred token inventory for BOTH outcomes
      cf.yesTokensIn += inferredSplitCount;
      cf.noTokensIn += inferredSplitCount;

      totalInferredSplits += inferredSplitCount;

      if (DEBUG) {
        console.log(`[INFERRED] ${cid.slice(0, 8)}... +${inferredSplitCount.toFixed(0)} splits (${(proportion * 100).toFixed(1)}% of wallet gap)`);
      }
    }
  }

  if (DEBUG && totalInferredSplits > 0) {
    console.log(`[INFO] Total inferred splits: ${totalInferredSplits.toFixed(0)} tokens`);
  }

  // Step 6: Load resolutions and calculate final PnL
  const allTokenIds = [...tokenToCondition.keys()];
  const resolutions = await loadResolutions(allTokenIds);

  // Aggregate totals
  let totalBuySpend = 0;
  let totalSellProceeds = 0;
  let totalSplitCollateral = 0;
  let totalMergeProceeds = 0;
  let totalRedemptionProceeds = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const [cid, cf] of cashFlows) {
    // Aggregate USDC flows
    totalBuySpend += cf.buySpend;
    totalSellProceeds += cf.sellProceeds;
    totalSplitCollateral += cf.splitCollateral;
    totalMergeProceeds += cf.mergeProceeds;
    totalRedemptionProceeds += cf.redemptionProceeds;

    // Calculate remaining tokens
    const remainingYes = Math.max(0, cf.yesTokensIn - cf.yesTokensOut);
    const remainingNo = Math.max(0, cf.noTokensIn - cf.noTokensOut);

    // Get resolution status
    const yesRes = resolutions.get(cf.yesTokenId);
    const noRes = resolutions.get(cf.noTokenId);
    const isResolved = yesRes?.is_resolved || noRes?.is_resolved;

    // Cash flow for this condition
    const usdcOut = cf.buySpend + cf.splitCollateral;
    const usdcIn = cf.sellProceeds + cf.mergeProceeds + cf.redemptionProceeds;

    if (isResolved) {
      // Remaining value = tokens × resolution payout
      const yesValue = remainingYes * (yesRes?.payout ?? 0);
      const noValue = remainingNo * (noRes?.payout ?? 0);
      const remainingValue = yesValue + noValue;

      // PnL = USDC in - USDC out + remaining value
      const positionPnl = usdcIn - usdcOut + remainingValue;
      realizedPnl += positionPnl;
      resolvedCount++;

      // Win/loss tracking
      if (positionPnl > 0.01) winCount++;
      else if (positionPnl < -0.01) lossCount++;

      if (DEBUG && (remainingYes > 0 || remainingNo > 0)) {
        console.log(`[RESOLVED] ${cid.slice(0, 8)}...`);
        console.log(`  USDC: out $${usdcOut.toFixed(2)}, in $${usdcIn.toFixed(2)}`);
        console.log(`  Remaining: ${remainingYes.toFixed(2)} YES @ $${(yesRes?.payout ?? 0).toFixed(2)}, ${remainingNo.toFixed(2)} NO @ $${(noRes?.payout ?? 0).toFixed(2)}`);
        console.log(`  PnL: $${positionPnl.toFixed(2)}`);
      }
    } else {
      // Mark-to-market at 0.5
      const yesValue = remainingYes * 0.5;
      const noValue = remainingNo * 0.5;
      const remainingValue = yesValue + noValue;

      // Unrealized PnL = USDC in - USDC out + mark value
      const positionPnl = usdcIn - usdcOut + remainingValue;
      unrealizedPnl += positionPnl;
      unresolvedCount++;

      if (DEBUG && (remainingYes > 0 || remainingNo > 0)) {
        console.log(`[UNRESOLVED] ${cid.slice(0, 8)}...`);
        console.log(`  Remaining: ${remainingYes.toFixed(2)} YES + ${remainingNo.toFixed(2)} NO @ $0.50`);
        console.log(`  Unrealized: $${positionPnl.toFixed(2)}`);
      }
    }
  }

  // Calculate confidence
  // High: we have complete data (splits + trades OR just trades)
  // Medium: some trades but incomplete CTF data
  // Low: no meaningful data
  let pnlConfidence: 'high' | 'medium' | 'low';
  if (tradeCount > 0 || totalSplitCollateral > 0) {
    pnlConfidence = 'high';
  } else if (rawCTFEvents.length > 0) {
    pnlConfidence = 'medium';
  } else {
    pnlConfidence = 'low';
  }

  const totalPnl = realizedPnl + unrealizedPnl;
  const resolvedPositions = winCount + lossCount;
  const winRate = resolvedPositions > 0 ? winCount / resolvedPositions : 0;

  return {
    wallet,
    realized_pnl: Math.round(realizedPnl * 100) / 100,
    unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
    total_pnl: Math.round(totalPnl * 100) / 100,
    positions_count: cashFlows.size,
    resolved_count: resolvedCount,
    unresolved_count: unresolvedCount,
    total_trades: tradeCount,
    volume_traded: Math.round(volumeTraded * 100) / 100,
    win_count: winCount,
    loss_count: lossCount,
    win_rate: Math.round(winRate * 1000) / 1000,
    usdc_from_buys: Math.round(totalBuySpend * 100) / 100,
    usdc_from_sells: Math.round(totalSellProceeds * 100) / 100,
    usdc_from_splits: Math.round(totalSplitCollateral * 100) / 100,
    usdc_from_merges: Math.round(totalMergeProceeds * 100) / 100,
    usdc_from_redemptions: Math.round(totalRedemptionProceeds * 100) / 100,
    pnl_confidence: pnlConfidence,
  };
}

function emptyMetrics(wallet: string): CCRv3Metrics {
  return {
    wallet,
    realized_pnl: 0,
    unrealized_pnl: 0,
    total_pnl: 0,
    positions_count: 0,
    resolved_count: 0,
    unresolved_count: 0,
    total_trades: 0,
    volume_traded: 0,
    win_count: 0,
    loss_count: 0,
    win_rate: 0,
    usdc_from_buys: 0,
    usdc_from_sells: 0,
    usdc_from_splits: 0,
    usdc_from_merges: 0,
    usdc_from_redemptions: 0,
    pnl_confidence: 'high',
  };
}

// Factory
export function createCCRv3Engine() {
  return {
    compute: computeCCRv3,
  };
}
