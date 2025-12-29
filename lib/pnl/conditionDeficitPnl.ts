/**
 * Condition-Level Deficit P&L Engine v3
 *
 * Core insight: Split cost attribution depends on wallet's overall trading pattern.
 *
 * Pattern detection via NET TOKEN BALANCE (bought - sold):
 * - SELLER (balance < -100): Negative balance = sold more than bought → full split cost
 * - BUYER (balance > 100): Positive balance = bought more than sold → no split cost
 * - MIXED: Small balance → deficit-based attribution per condition
 *
 * Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
 *
 * Why this works:
 * - SELLERS split USDC → create tokens → sell one side → keep other
 *   → Exchange splits ARE for them → attribute full split cost
 * - BUYERS just buy on CLOB → Exchange splits are for counterparties
 *   → Exchange splits are NOT for them → skip split cost
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface ConditionDeficitResult {
  wallet: string;
  pattern: 'SELLER' | 'BUYER' | 'MIXED';
  tokenBalance: number;
  buys: number;
  sells: number;
  redemptions: number;
  splitCostAttributed: number;
  splitCostAvailable: number;
  heldValue: number;
  realizedPnl: number;

  // Diagnostic fields
  trades: number;
  tokensWithDeficit: number;
  tokensWithSurplus: number;
  openPositions: number;
  mappedTokens: number;
  unmappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
  deficitTokensTotal: number;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const QUERY_CHUNK_SIZE = 750;

export async function computeConditionDeficitPnl(
  wallet: string,
  options: { includeBreakdown?: boolean } = {}
): Promise<ConditionDeficitResult> {
  const normalized = wallet.toLowerCase();

  // 1) Get all CLOB trades with deduplication - aggregate per token
  const tradesQ = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(side) as side,
        any(usdc_amount)/1e6 as usdc,
        any(token_amount)/1e6 as tokens,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${normalized}' AND is_deleted = 0
      GROUP BY base_id
    )
    SELECT
      token_id,
      sum(if(side = 'buy', tokens, 0)) as bought,
      sum(if(side = 'sell', tokens, 0)) as sold,
      sum(if(side = 'buy', usdc, 0)) as usdc_spent,
      sum(if(side = 'sell', usdc, 0)) as usdc_received,
      count() as trade_count
    FROM deduped
    GROUP BY token_id
  `;

  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const tradeRows = (await tradesR.json()) as Array<{
    token_id: string;
    bought: number;
    sold: number;
    usdc_spent: number;
    usdc_received: number;
    trade_count: number;
  }>;

  // Build token stats and calculate overall token balance
  const tokenStats = new Map<string, {
    bought: number;
    sold: number;
    usdc_spent: number;
    usdc_received: number;
  }>();

  let totalBuys = 0;
  let totalSells = 0;
  let totalTrades = 0;
  let totalBoughtTokens = 0;
  let totalSoldTokens = 0;

  for (const row of tradeRows) {
    const bought = Number(row.bought);
    const sold = Number(row.sold);
    tokenStats.set(row.token_id, {
      bought,
      sold,
      usdc_spent: Number(row.usdc_spent),
      usdc_received: Number(row.usdc_received),
    });
    totalBuys += Number(row.usdc_spent);
    totalSells += Number(row.usdc_received);
    totalTrades += Number(row.trade_count);
    totalBoughtTokens += bought;
    totalSoldTokens += sold;
  }

  // Calculate net token balance and determine pattern
  const tokenBalance = totalBoughtTokens - totalSoldTokens;
  const pattern: 'SELLER' | 'BUYER' | 'MIXED' =
    tokenBalance < -100 ? 'SELLER' :
    tokenBalance > 100 ? 'BUYER' :
    'MIXED';

  const tokenIds = [...tokenStats.keys()];

  if (tokenIds.length === 0) {
    return {
      wallet: normalized,
      pattern: 'MIXED',
      tokenBalance: 0,
      buys: 0,
      sells: 0,
      redemptions: 0,
      splitCostAttributed: 0,
      splitCostAvailable: 0,
      heldValue: 0,
      realizedPnl: 0,
      trades: 0,
      tokensWithDeficit: 0,
      tokensWithSurplus: 0,
      openPositions: 0,
      mappedTokens: 0,
      unmappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
      deficitTokensTotal: 0,
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

  // 3) Get conditions from traded tokens + redemptions
  const conditionIdSet = new Set<string>();
  for (const mapping of tokenToCondition.values()) {
    conditionIdSet.add(mapping.condition_id);
  }

  // Add conditions from redemptions
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
    if (row.condition_id) conditionIdSet.add(row.condition_id);
  }

  const allConditionIds = [...conditionIdSet];

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

  // 5) Get splits via tx_hash correlation (only for SELLER/MIXED patterns)
  const conditionSplits = new Map<string, number>();
  let totalSplitAvailable = 0;

  if (pattern !== 'BUYER' && allConditionIds.length > 0) {
    const conditionChunks = chunkArray(allConditionIds, QUERY_CHUNK_SIZE);
    for (const chunk of conditionChunks) {
      const splitQ = `
        WITH wallet_trades AS (
          SELECT
            lower(concat('0x', hex(any(transaction_hash)))) as tx_hash,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${normalized}' AND is_deleted = 0
          GROUP BY replaceRegexpAll(event_id, '-[mt]$', '')
        ),
        sell_tx AS (
          SELECT tx_hash
          FROM wallet_trades
          GROUP BY tx_hash
          HAVING sum(if(side = 'sell', usdc, 0)) > 0
        )
        SELECT
          condition_id,
          sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_usdc
        FROM pm_ctf_events
        WHERE tx_hash IN (SELECT tx_hash FROM sell_tx)
          AND is_deleted = 0
          AND condition_id IN ({conditionIds:Array(String)})
          AND event_type = 'PositionSplit'
        GROUP BY condition_id
      `;
      const splitR = await clickhouse.query({
        query: splitQ,
        query_params: { conditionIds: chunk },
        format: 'JSONEachRow',
      });
      const rows = (await splitR.json()) as Array<{ condition_id: string; split_usdc: number }>;
      for (const row of rows) {
        const amt = Number(row.split_usdc) || 0;
        conditionSplits.set(row.condition_id, amt);
        totalSplitAvailable += amt;
      }
    }
  }

  // 6) Get redemptions
  let totalRedemptions = 0;
  {
    const redQ = `
      SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redeemed
      FROM pm_ctf_events
      WHERE lower(user_address) = '${normalized}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `;
    const redR = await clickhouse.query({ query: redQ, format: 'JSONEachRow' });
    const rows = (await redR.json()) as Array<{ redeemed: number }>;
    totalRedemptions = Number(rows[0]?.redeemed || 0);
  }

  // 7) Calculate split cost based on pattern
  let splitCostAttributed = 0;
  let heldValue = 0;
  let tokensWithDeficit = 0;
  let tokensWithSurplus = 0;
  let openPositions = 0;
  let deficitTokensTotal = 0;

  if (pattern === 'SELLER') {
    // SELLER pattern: attribute FULL split cost from tx-hash correlation
    // This matches economicParityPnl behavior for calibration
    splitCostAttributed = totalSplitAvailable;
  } else if (pattern === 'MIXED') {
    // MIXED pattern: attribute deficit-based split cost
    const splitUsed = new Map<string, number>();

    for (const [tokenId, stats] of tokenStats.entries()) {
      const mapping = tokenToCondition.get(tokenId);
      if (!mapping) continue;

      const { condition_id } = mapping;
      const deficit = Math.max(0, stats.sold - stats.bought);

      if (deficit > 0) {
        const conditionSplitTotal = conditionSplits.get(condition_id) || 0;
        const usedSoFar = splitUsed.get(condition_id) || 0;
        const remaining = Math.max(0, conditionSplitTotal - usedSoFar);

        const deficitCost = deficit;
        const cappedCost = Math.min(deficitCost, remaining);

        splitCostAttributed += cappedCost;
        splitUsed.set(condition_id, usedSoFar + cappedCost);
        tokensWithDeficit++;
        deficitTokensTotal += deficit;
      }
    }
  }
  // BUYER pattern: splitCostAttributed stays 0

  // Calculate held value and open positions
  for (const [tokenId, stats] of tokenStats.entries()) {
    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) continue;

    const { condition_id, outcome_index } = mapping;
    const prices = resMap.get(condition_id);
    const resPrice = prices?.get(outcome_index);
    const inventory = stats.bought - stats.sold;

    if (inventory > 0) {
      tokensWithSurplus++;
      if (resPrice !== undefined && resPrice !== null) {
        heldValue += inventory * resPrice;
      } else {
        openPositions++;
      }
    } else if (inventory < 0) {
      tokensWithDeficit++;
      deficitTokensTotal += Math.abs(inventory);
    }
  }

  // Final P&L calculation
  const realizedPnl = totalSells + totalRedemptions - totalBuys - splitCostAttributed + heldValue;

  return {
    wallet: normalized,
    pattern,
    tokenBalance,
    buys: totalBuys,
    sells: totalSells,
    redemptions: totalRedemptions,
    splitCostAttributed,
    splitCostAvailable: totalSplitAvailable,
    heldValue,
    realizedPnl,
    trades: totalTrades,
    tokensWithDeficit,
    tokensWithSurplus,
    openPositions,
    mappedTokens,
    unmappedTokens,
    totalTokens: tokenIds.length,
    mappingCoveragePct,
    deficitTokensTotal,
  };
}
