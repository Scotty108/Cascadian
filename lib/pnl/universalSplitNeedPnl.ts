/**
 * Universal Split-Need P&L Engine
 *
 * Key insight: Compute split cost from token flow, NOT from tx_hash correlation.
 *
 * For each condition (market):
 *   For each outcome i:
 *     required_split_i = max(0, sold_i + redeemed_i + held_i - bought_i)
 *   splitCost_condition = max(required_split across outcomes)
 *
 * Why max() not sum():
 *   A split creates 1 token for EACH outcome.
 *   If you need 100 of outcome A and 50 of outcome B, you only need 100 splits.
 *   The 100 splits create 100 A + 100 B (50 B are excess).
 *
 * This handles ALL wallet types with one formula:
 *   - Buyers: bought >= sold + held → required = 0 → no split cost
 *   - Splitters: sold > bought → required > 0 → split cost
 *   - Mixed: computed per-condition, not per-wallet
 *
 * Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
 */

import { clickhouse } from '@/lib/clickhouse/client';
import {
  computeConditionSplitNeed,
  redeemedTokensFromPayout,
  type OutcomeFlow,
} from '@/lib/pnl/splitNeedMath';

export interface UniversalSplitNeedResult {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  splitCost: number;
  heldValue: number;
  realizedPnl: number;

  // Diagnostics
  trades: number;
  conditionsTraded: number;
  conditionsWithSplitNeed: number;
  conditionsResolved: number;
  conditionsOpen: number;
  mappedTokens: number;
  unmappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;

  // Per-condition breakdown (optional)
  conditionBreakdown?: Array<{
    condition_id: string;
    outcomes: Array<{
      outcome_index: number;
      token_id: string;
      bought: number;
      sold: number;
      redeemed: number;
      held: number;
      required_split: number;
      resolution_price: number | null;
    }>;
    split_cost: number;
    held_value: number;
  }>;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const QUERY_CHUNK_SIZE = 750;

export async function computeUniversalSplitNeedPnl(
  wallet: string,
  options: { includeBreakdown?: boolean } = {}
): Promise<UniversalSplitNeedResult> {
  const normalized = wallet.toLowerCase();
  const { includeBreakdown = false } = options;

  // 1) Load deduped CLOB trades (canonical source)
  const tradesQ = `
    SELECT
      token_id,
      side,
      usdc_amount/1e6 as usdc,
      token_amount/1e6 as tokens,
      trade_time
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${normalized}'
  `;

  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const tradeRows = (await tradesR.json()) as Array<{
    token_id: string;
    side: 'buy' | 'sell';
    usdc: number;
    tokens: number;
    trade_time: string;
  }>;

  // Build token stats
  const tokenStats = new Map<string, {
    bought: number;
    sold: number;
    usdc_spent: number;
    usdc_received: number;
  }>();

  let totalBuys = 0;
  let totalSells = 0;
  let totalTrades = 0;

  for (const row of tradeRows) {
    const stats = tokenStats.get(row.token_id) || {
      bought: 0,
      sold: 0,
      usdc_spent: 0,
      usdc_received: 0,
    };
    if (row.side === 'buy') {
      stats.bought += Number(row.tokens);
      stats.usdc_spent += Number(row.usdc);
      totalBuys += Number(row.usdc);
    } else {
      stats.sold += Number(row.tokens);
      stats.usdc_received += Number(row.usdc);
      totalSells += Number(row.usdc);
    }
    tokenStats.set(row.token_id, stats);
    totalTrades += 1;
  }

  const tokenIds = [...tokenStats.keys()];

  if (tokenIds.length === 0) {
    return {
      wallet: normalized,
      buys: 0,
      sells: 0,
      redemptions: 0,
      splitCost: 0,
      heldValue: 0,
      realizedPnl: 0,
      trades: 0,
      conditionsTraded: 0,
      conditionsWithSplitNeed: 0,
      conditionsResolved: 0,
      conditionsOpen: 0,
      mappedTokens: 0,
      unmappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
    };
  }

  // 2) Map tokens to conditions
  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  const chunks = chunkArray(tokenIds, QUERY_CHUNK_SIZE);

  for (const chunk of chunks) {
    const mappingQ = `
      WITH patch_deduped AS (
        SELECT token_id_dec, any(condition_id) as condition_id, any(outcome_index) as outcome_index
        FROM pm_token_to_condition_patch
        GROUP BY token_id_dec
      )
      SELECT
        ids.token_id_dec as token_id,
        COALESCE(NULLIF(p.condition_id, ''), NULLIF(g.condition_id, '')) as condition_id,
        COALESCE(if(p.condition_id != '', p.outcome_index, NULL), g.outcome_index) as outcome_index
      FROM (
        SELECT token_id_dec FROM pm_token_to_condition_map_v5
        WHERE token_id_dec IN ({tokenIds:Array(String)})
        UNION ALL
        SELECT token_id_dec FROM pm_token_to_condition_patch
        WHERE token_id_dec IN ({tokenIds:Array(String)})
      ) ids
      LEFT JOIN pm_token_to_condition_map_v5 g ON ids.token_id_dec = g.token_id_dec
      LEFT JOIN patch_deduped p ON ids.token_id_dec = p.token_id_dec
      WHERE COALESCE(NULLIF(p.condition_id, ''), NULLIF(g.condition_id, '')) != ''
    `;

    const mappingR = await clickhouse.query({
      query: mappingQ,
      query_params: { tokenIds: chunk },
      format: 'JSONEachRow',
    });
    const rows = (await mappingR.json()) as Array<{
      token_id: string;
      condition_id: string;
      outcome_index: number;
    }>;

    for (const row of rows) {
      tokenToCondition.set(row.token_id, {
        condition_id: row.condition_id,
        outcome_index: Number(row.outcome_index),
      });
    }
  }

  const mappedTokens = tokenToCondition.size;
  const unmappedTokens = tokenIds.length - mappedTokens;
  const mappingCoveragePct = tokenIds.length > 0 ? mappedTokens / tokenIds.length : 0;

  // 3) Group tokens by condition
  const conditionTokens = new Map<string, Map<number, string>>(); // condition -> outcome -> token
  for (const [tokenId, mapping] of tokenToCondition.entries()) {
    const outcomes = conditionTokens.get(mapping.condition_id) || new Map<number, string>();
    outcomes.set(mapping.outcome_index, tokenId);
    conditionTokens.set(mapping.condition_id, outcomes);
  }

  // Add conditions from redemptions (may include conditions not traded on CLOB)
  const redConditionQ = `
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE lower(user_address) = '${normalized}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;
  const redConditionR = await clickhouse.query({ query: redConditionQ, format: 'JSONEachRow' });
  const redConditionRows = (await redConditionR.json()) as Array<{ condition_id: string }>;
  for (const row of redConditionRows) {
    if (row.condition_id && !conditionTokens.has(row.condition_id)) {
      conditionTokens.set(row.condition_id, new Map());
    }
  }

  const allConditionIds = [...conditionTokens.keys()];

  // 4) Get resolution prices
  const resMap = new Map<string, Map<number, number>>();
  if (allConditionIds.length > 0) {
    const conditionChunks = chunkArray(allConditionIds, QUERY_CHUNK_SIZE);
    for (const chunk of conditionChunks) {
      const resQ = `
        SELECT condition_id, outcome_index, resolved_price
        FROM vw_pm_resolution_prices
        WHERE condition_id IN ({conditionIds:Array(String)})
      `;
      const resR = await clickhouse.query({
        query: resQ,
        query_params: { conditionIds: chunk },
        format: 'JSONEachRow',
      });
      const rows = (await resR.json()) as any[];
      for (const r of rows) {
        const m = resMap.get(r.condition_id) || new Map<number, number>();
        m.set(Number(r.outcome_index), Number(r.resolved_price));
        resMap.set(r.condition_id, m);
      }
    }
  }

  // 5) Get redemptions per condition (keep timestamps for sequencing)
  // PayoutRedemption amount is in USDC (tokens * $1 for winning outcome)
  // NOTE: totalRedemptions is computed later, only for conditions with mapped outcomes
  const conditionRedemptions = new Map<string, Array<{ ts: string; usdc: number }>>();
  {
    const redQ = `
      SELECT condition_id, toFloat64OrZero(amount_or_payout) / 1e6 as redeemed, event_timestamp
      FROM pm_ctf_events
      WHERE lower(user_address) = '${normalized}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `;
    const redR = await clickhouse.query({ query: redQ, format: 'JSONEachRow' });
    const rows = (await redR.json()) as Array<{ condition_id: string; redeemed: number; event_timestamp: string }>;
    for (const row of rows) {
      const amt = Number(row.redeemed) || 0;
      if (!row.condition_id || amt <= 0) continue;
      const list = conditionRedemptions.get(row.condition_id) || [];
      list.push({ ts: row.event_timestamp, usdc: amt });
      conditionRedemptions.set(row.condition_id, list);
    }
  }

  // 6) Build full outcome map for all conditions (not just traded tokens)
  // Need to know all outcomes to compute max(required_split)
  const conditionAllOutcomes = new Map<string, Map<number, string>>(); // condition -> outcome -> token
  if (allConditionIds.length > 0) {
    const conditionChunks = chunkArray(allConditionIds, QUERY_CHUNK_SIZE);
    for (const chunk of conditionChunks) {
      const outcomeQ = `
        WITH patch AS (
          SELECT condition_id, outcome_index, any(token_id_dec) as token_id
          FROM pm_token_to_condition_patch
          WHERE condition_id IN ({conditionIds:Array(String)})
          GROUP BY condition_id, outcome_index
        ),
        gamma AS (
          SELECT condition_id, outcome_index, any(token_id_dec) as token_id
          FROM pm_token_to_condition_map_v5
          WHERE condition_id IN ({conditionIds:Array(String)})
          GROUP BY condition_id, outcome_index
        ),
        keys AS (
          SELECT condition_id, outcome_index FROM gamma
          UNION ALL
          SELECT condition_id, outcome_index FROM patch
        )
        SELECT DISTINCT
          k.condition_id,
          k.outcome_index,
          COALESCE(NULLIF(p.token_id, ''), g.token_id) as token_id
        FROM keys k
        LEFT JOIN gamma g ON k.condition_id = g.condition_id AND k.outcome_index = g.outcome_index
        LEFT JOIN patch p ON k.condition_id = p.condition_id AND k.outcome_index = p.outcome_index
        WHERE COALESCE(NULLIF(p.token_id, ''), g.token_id) != ''
      `;
      const outcomeR = await clickhouse.query({
        query: outcomeQ,
        query_params: { conditionIds: chunk },
        format: 'JSONEachRow',
      });
      const rows = (await outcomeR.json()) as Array<{
        condition_id: string;
        outcome_index: number;
        token_id: string;
      }>;
      for (const row of rows) {
        const outcomes = conditionAllOutcomes.get(row.condition_id) || new Map<number, string>();
        outcomes.set(Number(row.outcome_index), row.token_id);
        conditionAllOutcomes.set(row.condition_id, outcomes);
      }
    }
  }

  // Ensure each condition has all outcomes (even if not mapped), using resolution keys.
  // Missing outcomes get synthetic token ids so required_split can be computed correctly.
  for (const conditionId of allConditionIds) {
    const outcomes = conditionAllOutcomes.get(conditionId) || new Map<number, string>();
    const prices = resMap.get(conditionId);
    if (prices && prices.size > 0) {
      for (const outcomeIdx of prices.keys()) {
        if (!outcomes.has(outcomeIdx)) {
          const tokenId = `synthetic:${conditionId}:${outcomeIdx}`;
          outcomes.set(outcomeIdx, tokenId);
          if (!tokenStats.has(tokenId)) {
            tokenStats.set(tokenId, {
              bought: 0,
              sold: 0,
              usdc_spent: 0,
              usdc_received: 0,
            });
          }
        }
      }
    }
    if (outcomes.size > 0) conditionAllOutcomes.set(conditionId, outcomes);
  }

  // 7) Calculate per-condition split cost and held value
  let totalSplitCost = 0;
  let totalHeldValue = 0;
  let totalRedemptions = 0; // Only count redemptions for conditions with mapped outcomes
  let conditionsWithSplitNeed = 0;
  let conditionsResolved = 0;
  let conditionsOpen = 0;

  const breakdown: UniversalSplitNeedResult['conditionBreakdown'] = [];

  for (const conditionId of allConditionIds) {
    const tradedOutcomes = conditionTokens.get(conditionId) || new Map<number, string>();
    const allOutcomes = conditionAllOutcomes.get(conditionId) || tradedOutcomes;
    if (allOutcomes.size === 0) {
      continue;
    }
    const prices = resMap.get(conditionId);
    const redemptionList = conditionRedemptions.get(conditionId) || [];

    // Determine winning outcome (for redemption attribution)
    // Use max resolved_price (covers fractional resolution too)
    let winningOutcome: number | null = null;
    let winningPrice = 0;
    if (prices) {
      for (const [idx, price] of prices.entries()) {
        if (price > winningPrice) {
          winningPrice = price;
          winningOutcome = idx;
        }
      }
    }

    const redemptionPayout = redemptionList.reduce((sum, r) => sum + r.usdc, 0);

    // Only count redemptions for conditions we can map + resolve
    if (redemptionPayout > 0 && winningOutcome !== null && winningPrice > 0 && allOutcomes.size > 0) {
      totalRedemptions += redemptionPayout;
    }

    const outcomeFlows: OutcomeFlow[] = [];
    for (const [outcomeIdx, tokenId] of allOutcomes.entries()) {
      const stats = tokenStats.get(tokenId);
      const bought = stats?.bought || 0;
      const sold = stats?.sold || 0;
      const resPrice = prices?.get(outcomeIdx);
      const redeemedTokens =
        outcomeIdx === winningOutcome ? redeemedTokensFromPayout(redemptionPayout, resPrice) : 0;

      outcomeFlows.push({
        outcomeIndex: outcomeIdx,
        bought,
        sold,
        redeemedTokens,
        resolutionPrice: resPrice,
      });
    }

    const splitNeed = computeConditionSplitNeed(outcomeFlows);
    totalSplitCost += splitNeed.splitCost;
    totalHeldValue += splitNeed.heldValue;

    if (splitNeed.splitCost > 0) {
      conditionsWithSplitNeed++;
    }

    const hasOpenPosition = outcomeFlows.some((flow) => {
      const held = splitNeed.heldByOutcome.get(flow.outcomeIndex) || 0;
      return held > 0 && (flow.resolutionPrice === null || flow.resolutionPrice === undefined);
    });

    const hasResolution = prices !== undefined && prices.size > 0;
    if (hasOpenPosition) {
      conditionsOpen++;
    } else if (hasResolution) {
      conditionsResolved++;
    }

    if (includeBreakdown) {
      const outcomeData = outcomeFlows.map((flow) => ({
        outcome_index: flow.outcomeIndex,
        token_id: allOutcomes.get(flow.outcomeIndex) || '',
        bought: flow.bought,
        sold: flow.sold,
        redeemed: flow.redeemedTokens,
        held: splitNeed.heldByOutcome.get(flow.outcomeIndex) || 0,
        required_split: splitNeed.requiredSplitByOutcome.get(flow.outcomeIndex) || 0,
        resolution_price: flow.resolutionPrice ?? null,
      }));

      breakdown.push({
        condition_id: conditionId,
        outcomes: outcomeData,
        split_cost: splitNeed.splitCost,
        held_value: splitNeed.heldValue,
      });
    }
  }

  // 8) Final P&L calculation
  const realizedPnl = totalSells + totalRedemptions - totalBuys - totalSplitCost + totalHeldValue;

  const result: UniversalSplitNeedResult = {
    wallet: normalized,
    buys: totalBuys,
    sells: totalSells,
    redemptions: totalRedemptions,
    splitCost: totalSplitCost,
    heldValue: totalHeldValue,
    realizedPnl,
    trades: totalTrades,
    conditionsTraded: conditionTokens.size,
    conditionsWithSplitNeed,
    conditionsResolved,
    conditionsOpen,
    mappedTokens,
    unmappedTokens,
    totalTokens: tokenIds.length,
    mappingCoveragePct,
  };

  if (includeBreakdown) {
    result.conditionBreakdown = breakdown;
  }

  return result;
}
