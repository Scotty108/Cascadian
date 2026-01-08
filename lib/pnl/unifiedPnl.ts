import { clickhouse } from '@/lib/clickhouse/client';

export interface UnifiedPnlResult {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  splitCost: number;
  heldValue: number;
  realizedPnl: number;
  trades: number;
  openPositions: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
  implicitSplitTokens: number;
  explicitSplitTokens: number;
  redemptionEvents: number;
  redemptionApplied: number;
  redemptionSkippedNoResolution: number;
  redemptionSkippedNoToken: number;
  sellDeficitNoMapping: number;
  sellDeficitNoSplitEvidence: number;
  redeemDeficitNoSplitEvidence: number;
  txSplitPoolTotal: number;
  txSplitTokensUsed: number;
}

interface Position {
  amount: number;
}

const DEFAULT_OUTCOME_COUNT = 2;

export async function computeUnifiedPnl(wallet: string): Promise<UnifiedPnlResult> {
  const normalized = wallet.toLowerCase();

  // 1) Load deduped trades
  const tradesQ = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(side) as side,
        any(usdc_amount)/1e6 as usdc,
        any(token_amount)/1e6 as tokens,
        any(token_id) as token_id,
        lower(concat('0x', hex(any(transaction_hash)))) as transaction_hash,
        any(trade_time) as trade_time
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${normalized}'
      GROUP BY base_id
    )
    SELECT
      side,
      usdc,
      tokens,
      token_id,
      transaction_hash,
      trade_time
    FROM deduped
    ORDER BY trade_time ASC
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as Array<{
    side: 'buy' | 'sell';
    usdc: number;
    tokens: number;
    token_id: string;
    transaction_hash: string;
    trade_time: string;
  }>;

  const tradeCount = trades.length;
  let totalBuyTokens = 0;
  let totalSellTokens = 0;
  const txHasBuySell = new Map<string, { hasBuy: boolean; hasSell: boolean }>();
  for (const t of trades) {
    const entry = txHasBuySell.get(t.transaction_hash) || { hasBuy: false, hasSell: false };
    if (t.side === 'buy') entry.hasBuy = true;
    if (t.side === 'sell') entry.hasSell = true;
    txHasBuySell.set(t.transaction_hash, entry);
    if (t.side === 'buy') totalBuyTokens += t.tokens;
    if (t.side === 'sell') totalSellTokens += t.tokens;
  }
  const netTokenBalance = totalBuyTokens - totalSellTokens;
  const sellerMode = netTokenBalance < 0;
  const tokenIds = [...new Set(trades.map((t) => t.token_id))];
  if (tokenIds.length === 0) {
    return {
      wallet: normalized,
      buys: 0,
      sells: 0,
      redemptions: 0,
      splitCost: 0,
      heldValue: 0,
      realizedPnl: 0,
      trades: tradeCount,
      openPositions: 0,
      mappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
      implicitSplitTokens: 0,
      explicitSplitTokens: 0,
      redemptionEvents: 0,
      redemptionApplied: 0,
      redemptionSkippedNoResolution: 0,
      redemptionSkippedNoToken: 0,
      sellDeficitNoMapping: 0,
      sellDeficitNoSplitEvidence: 0,
      redeemDeficitNoSplitEvidence: 0,
      txSplitPoolTotal: 0,
      txSplitTokensUsed: 0,
    };
  }

  // 2) CTF events (splits/merges/redemptions) for this wallet
  const ctfQ = `
    SELECT
      event_type,
      condition_id,
      amount_or_payout,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) = '${normalized}'
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
      AND is_deleted = 0
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfEvents = (await ctfR.json()) as Array<{
    event_type: 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
    condition_id: string;
    amount_or_payout: string | number;
    event_timestamp: string;
  }>;

  const redemptionConditionIds = new Set(
    ctfEvents.filter((e) => e.event_type === 'PayoutRedemption').map((e) => e.condition_id),
  );
  const splitConditionIds = new Set(
    ctfEvents.filter((e) => e.event_type !== 'PayoutRedemption').map((e) => e.condition_id),
  );

  // 3) Token -> condition/outcome mapping (patch overrides gamma) for traded tokens
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
    query_params: { tokenIds },
    format: 'JSONEachRow',
  });
  const mapped = (await mappingR.json()) as Array<{ token_id: string; condition_id: string; outcome_index: number }>;

  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  for (const row of mapped) {
    tokenToCondition.set(row.token_id, {
      conditionId: row.condition_id,
      outcomeIndex: Number(row.outcome_index),
    });
  }

  const mappedTokens = tokenToCondition.size;
  const totalTokens = tokenIds.length;
  const mappingCoveragePct = totalTokens > 0 ? mappedTokens / totalTokens : 0;

  const ensureTokenMeta = (tokenId: string, conditionId: string, outcomeIndex: number): void => {
    if (!tokenToCondition.has(tokenId)) {
      tokenToCondition.set(tokenId, { conditionId, outcomeIndex });
    }
  };

  // 4) Build condition id set from trades + redemptions + direct splits/merges
  const conditionIds = new Set<string>();
  for (const row of mapped) conditionIds.add(row.condition_id);
  for (const cid of redemptionConditionIds) conditionIds.add(cid);
  for (const cid of splitConditionIds) conditionIds.add(cid);

  const conditionIdList = [...conditionIds];

  const txSplitPoolTotal = 0;

  // 5) Build condition->outcome->token map (needed for opposite token)
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
    SELECT
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
    query_params: { conditionIds: conditionIdList },
    format: 'JSONEachRow',
  });
  const outcomeRows = (await outcomeR.json()) as Array<{ condition_id: string; outcome_index: number; token_id: string }>;
  const outcomeMap = new Map<string, Map<number, string>>();
  for (const row of outcomeRows) {
    const m = outcomeMap.get(row.condition_id) || new Map<number, string>();
    m.set(Number(row.outcome_index), row.token_id);
    outcomeMap.set(row.condition_id, m);
    ensureTokenMeta(row.token_id, row.condition_id, Number(row.outcome_index));
  }

  // 6) Resolution prices for all relevant conditions
  const resMap = new Map<string, Map<number, number>>();
  if (conditionIdList.length > 0) {
    const resQ = `
      SELECT condition_id, outcome_index, resolved_price
      FROM vw_pm_resolution_prices
      WHERE condition_id IN ({conditionIds:Array(String)})
    `;
    const resR = await clickhouse.query({
      query: resQ,
      query_params: { conditionIds: conditionIdList },
      format: 'JSONEachRow',
    });
    const resRows = (await resR.json()) as Array<{ condition_id: string; outcome_index: number; resolved_price: number }>;
    for (const row of resRows) {
      const m = resMap.get(row.condition_id) || new Map<number, number>();
      m.set(Number(row.outcome_index), Number(row.resolved_price));
      resMap.set(row.condition_id, m);
    }
  }

  const getOutcomes = (conditionId: string): Map<number, string> | undefined => {
    const existing = outcomeMap.get(conditionId);
    if (existing) return existing;
    const prices = resMap.get(conditionId);
    if (!prices || prices.size === 0) return undefined;
    const synthetic = new Map<number, string>();
    for (const idx of prices.keys()) {
      const tokenId = `synthetic:${conditionId}:${idx}`;
      synthetic.set(idx, tokenId);
      ensureTokenMeta(tokenId, conditionId, idx);
    }
    outcomeMap.set(conditionId, synthetic);
    return synthetic;
  };

  // 7) Build condition-level "sell-in-mixed-tx" set for redemption split inference
  // If a condition ever has a SELL in a tx that also has a BUY (any condition),
  // treat that condition as split-eligible for redemption deficits.
  const conditionHasSellInMixedTx = new Set<string>();
  for (const trade of trades) {
    if (trade.side !== 'sell') continue;
    const flags = txHasBuySell.get(trade.transaction_hash);
    if (!flags || !flags.hasBuy || !flags.hasSell) continue;
    const mapping = tokenToCondition.get(trade.token_id);
    if (!mapping) continue;
    conditionHasSellInMixedTx.add(mapping.conditionId);
  }

  // 8) Build unified event list
  type UnifiedEvent =
    | { ts: number; type: 'BUY' | 'SELL'; tokenId: string; amount: number; price: number; txHash: string }
    | { ts: number; type: 'SPLIT' | 'MERGE' | 'REDEEM'; conditionId: string; amount: number; txHash?: string };

  const events: UnifiedEvent[] = [];
  for (const trade of trades) {
    const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;
    events.push({
      ts: Date.parse(trade.trade_time),
      type: trade.side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
      tokenId: trade.token_id,
      amount: trade.tokens,
      price,
      txHash: trade.transaction_hash,
    });
  }
  for (const e of ctfEvents) {
    const amount = Number(e.amount_or_payout || 0) / 1e6;
    if (amount <= 0) continue;
    events.push({
      ts: Date.parse(e.event_timestamp),
      type: e.event_type === 'PayoutRedemption' ? 'REDEEM' : e.event_type === 'PositionSplit' ? 'SPLIT' : 'MERGE',
      conditionId: e.condition_id,
      amount,
    });
  }

  // Sort by time, then ensure within the SAME tx we process SELL before BUY
  // to expose split deficits in arbitrage txs.
  const typeOrder: Record<string, number> = { SPLIT: 0, SELL: 1, BUY: 2, MERGE: 3, REDEEM: 4 };
  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.txHash && b.txHash && a.txHash === b.txHash) {
      return typeOrder[a.type] - typeOrder[b.type];
    }
    return typeOrder[a.type] - typeOrder[b.type];
  });

  // 8) Process events with implicit splits on deficit sells/redemptions (sequential ledger)
  const positions = new Map<string, Position>();
  let buys = 0;
  let sells = 0;
  let redemptions = 0;
  let splitCost = 0;
  let implicitSplitTokens = 0;
  let explicitSplitTokens = 0;
  let redemptionEvents = 0;
  let redemptionApplied = 0;
  let redemptionSkippedNoResolution = 0;
  let redemptionSkippedNoToken = 0;
  let sellDeficitNoMapping = 0;
  let sellDeficitNoSplitEvidence = 0;
  let redeemDeficitNoSplitEvidence = 0;
  let txSplitTokensUsed = 0;

  const ensurePos = (tokenId: string): Position => {
    const existing = positions.get(tokenId);
    if (existing) return existing;
    const pos = { amount: 0 };
    positions.set(tokenId, pos);
    return pos;
  };

  const addSplitTokens = (conditionId: string, amount: number): boolean => {
    const outcomes = getOutcomes(conditionId);
    if (!outcomes) return false;
    for (const tokenId of outcomes.values()) {
      const pos = ensurePos(tokenId);
      pos.amount += amount;
    }
    return true;
  };

  for (const ev of events) {
    if (ev.type === 'BUY') {
      buys += ev.amount * ev.price;
      const pos = ensurePos(ev.tokenId);
      pos.amount += ev.amount;
      continue;
    }

    if (ev.type === 'SELL') {
      sells += ev.amount * ev.price;
      const mapping = tokenToCondition.get(ev.tokenId);
      const pos = ensurePos(ev.tokenId);

      if (pos.amount < ev.amount) {
        const deficit = ev.amount - pos.amount;
        const txFlags = txHasBuySell.get(ev.txHash);
        const allowImplicitSplit = sellerMode || (txFlags?.hasBuy && txFlags?.hasSell);
        if (!mapping) {
          sellDeficitNoMapping += deficit;
        } else if (allowImplicitSplit) {
          const ok = addSplitTokens(mapping.conditionId, deficit);
          if (!ok) {
            sellDeficitNoSplitEvidence += deficit;
          }
          splitCost += deficit;
          implicitSplitTokens += deficit;
        } else {
          sellDeficitNoSplitEvidence += deficit;
        }
      }

      pos.amount = Math.max(0, pos.amount - ev.amount);
      continue;
    }

    if (ev.type === 'SPLIT' || ev.type === 'MERGE') {
      const outcomes = getOutcomes(ev.conditionId);
      if (!outcomes) continue;

      if (ev.type === 'SPLIT') {
        splitCost += ev.amount;
        explicitSplitTokens += ev.amount;
        for (const tokenId of outcomes.values()) {
          const pos = ensurePos(tokenId);
          pos.amount += ev.amount;
        }
        continue;
      }

      // MERGE: return USDC, burn equal amount from each outcome
      sells += ev.amount;
      for (const tokenId of outcomes.values()) {
        const pos = ensurePos(tokenId);
        pos.amount = Math.max(0, pos.amount - ev.amount);
      }
      continue;
    }

    if (ev.type === 'REDEEM') {
      redemptionEvents += 1;
      const prices = resMap.get(ev.conditionId);
      if (!prices) {
        redemptionSkippedNoResolution += 1;
        continue;
      }
      let winnerIdx: number | null = null;
      let winnerPrice = 0;
      for (const [idx, price] of prices.entries()) {
        if (price > winnerPrice) {
          winnerPrice = price;
          winnerIdx = idx;
        }
      }
      if (winnerIdx === null || winnerPrice <= 0) {
        redemptionSkippedNoResolution += 1;
        continue;
      }

      const outcomes = getOutcomes(ev.conditionId);
      if (!outcomes) {
        redemptionSkippedNoToken += 1;
        continue;
      }
      const tokenId = outcomes.get(winnerIdx) ?? `synthetic:${ev.conditionId}:${winnerIdx}`;
      ensureTokenMeta(tokenId, ev.conditionId, winnerIdx);

      const tokenAmount = ev.amount / winnerPrice;
      if (tokenAmount <= 0) {
        redemptionSkippedNoResolution += 1;
        continue;
      }

      const pos = ensurePos(tokenId);
      if (pos.amount < tokenAmount) {
        const deficit = tokenAmount - pos.amount;
        const allowImplicitSplit = sellerMode || conditionHasSellInMixedTx.has(ev.conditionId);
        if (allowImplicitSplit) {
          const ok = addSplitTokens(ev.conditionId, deficit);
          if (!ok) {
            redeemDeficitNoSplitEvidence += deficit;
          }
          splitCost += deficit;
          implicitSplitTokens += deficit;
        } else {
          redeemDeficitNoSplitEvidence += deficit;
        }
      }

      pos.amount = Math.max(0, pos.amount - tokenAmount);
      redemptions += ev.amount;
      redemptionApplied += 1;
      continue;
    }
  }

  // 9) Resolve remaining positions (synthetic redemptions for resolved positions)
  let heldValue = 0;
  let openPositions = 0;
  for (const [tokenId, pos] of positions.entries()) {
    if (pos.amount <= 0) continue;
    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) continue;
    const price = resMap.get(mapping.conditionId)?.get(mapping.outcomeIndex);
    if (price === undefined || price === null) {
      openPositions++;
      continue;
    }
    heldValue += pos.amount * price;
  }

  const realizedPnl = sells + redemptions - buys - splitCost + heldValue;

  return {
    wallet: normalized,
    buys,
    sells,
    redemptions,
    splitCost,
    heldValue,
    realizedPnl,
    trades: tradeCount,
    openPositions,
    mappedTokens,
    totalTokens,
    mappingCoveragePct,
    implicitSplitTokens,
    explicitSplitTokens,
    redemptionEvents,
    redemptionApplied,
    redemptionSkippedNoResolution,
    redemptionSkippedNoToken,
    sellDeficitNoMapping,
    sellDeficitNoSplitEvidence,
    redeemDeficitNoSplitEvidence,
    txSplitPoolTotal,
    txSplitTokensUsed,
  };
}
