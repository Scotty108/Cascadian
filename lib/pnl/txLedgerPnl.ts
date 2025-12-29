import { clickhouse } from '@/lib/clickhouse/client';

export interface TxLedgerPnlResult {
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
  implicitSplitFromTrades: number;
  implicitSplitFromRedemptions: number;
  explicitSplitTokens: number;
  redemptionEvents: number;
  redemptionApplied: number;
  redemptionSkippedNoResolution: number;
  redemptionSkippedNoToken: number;
  netTokenBalance: number;
  isNetBuyer: boolean;
  takerSellShare: number;
  splitCostMode: 'txhash' | 'condition' | 'none';
  conditionSplitCost: number;
}

interface InventoryPos {
  trade: number;
  split: number;
}

const QUERY_CHUNK_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function computeTxLedgerPnl(wallet: string): Promise<TxLedgerPnlResult> {
  const normalized = wallet.toLowerCase();

  // 1) Load deduped trades (CLOB)
  const tradesQ = `
    SELECT
      side,
      role,
      usdc_amount/1e6 as usdc,
      token_amount/1e6 as tokens,
      token_id,
      lower(concat('0x', hex(transaction_hash))) as tx_hash,
      trade_time
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${normalized}'
    ORDER BY trade_time ASC
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as Array<{
    side: 'buy' | 'sell';
    role: string;
    usdc: number;
    tokens: number;
    token_id: string;
    tx_hash: string;
    trade_time: string;
  }>;

  const tradeCount = trades.length;
  const tokenIds = [...new Set(trades.map((t) => t.token_id))];

  // Compute net token balance (debug/diagnostic)
  let tokensBought = 0;
  let tokensSold = 0;
  let totalSellUsdc = 0;
  let takerSellUsdc = 0;
  for (const t of trades) {
    if (t.side === 'buy') tokensBought += t.tokens;
    else {
      tokensSold += t.tokens;
      totalSellUsdc += t.usdc;
      if (t.role === 'taker') takerSellUsdc += t.usdc;
    }
  }
  const netTokenBalance = tokensBought - tokensSold;
  const isNetBuyer = netTokenBalance > 0;
  const takerSellShare = totalSellUsdc > 0 ? takerSellUsdc / totalSellUsdc : 0;

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
      implicitSplitFromTrades: 0,
      implicitSplitFromRedemptions: 0,
      explicitSplitTokens: 0,
      redemptionEvents: 0,
      redemptionApplied: 0,
      redemptionSkippedNoResolution: 0,
      redemptionSkippedNoToken: 0,
      takerSellShare: 0,
      splitCostMode: 'none',
      conditionSplitCost: 0,
      netTokenBalance,
      isNetBuyer,
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

  // 3) Token -> condition/outcome mapping (patch overrides gamma)
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  const tokenChunks = chunkArray(tokenIds, QUERY_CHUNK_SIZE);
  for (const chunk of tokenChunks) {
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
    const mapped = (await mappingR.json()) as Array<{ token_id: string; condition_id: string; outcome_index: number }>;
    for (const row of mapped) {
      tokenToCondition.set(row.token_id, {
        conditionId: row.condition_id,
        outcomeIndex: Number(row.outcome_index),
      });
    }
  }
  const mappedTokens = tokenToCondition.size;
  const totalTokens = tokenIds.length;
  const mappingCoveragePct = totalTokens > 0 ? mappedTokens / totalTokens : 0;

  // 4) Condition IDs from trades + redemptions + direct splits/merges
  const conditionIds = new Set<string>();
  for (const mapping of tokenToCondition.values()) {
    conditionIds.add(mapping.conditionId);
  }
  for (const e of ctfEvents) conditionIds.add(e.condition_id);
  const conditionIdList = [...conditionIds];

  // 5) Build condition->outcome->token map (for split minting)
  const outcomeMap = new Map<string, Map<number, string>>();
  if (conditionIdList.length > 0) {
    const conditionChunks: string[][] = [];
    for (let i = 0; i < conditionIdList.length; i += QUERY_CHUNK_SIZE) {
      conditionChunks.push(conditionIdList.slice(i, i + QUERY_CHUNK_SIZE));
    }
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
        query_params: { conditionIds: chunk },
        format: 'JSONEachRow',
      });
      const rows = (await outcomeR.json()) as Array<{ condition_id: string; outcome_index: number; token_id: string }>;
      for (const row of rows) {
        const outcomes = outcomeMap.get(row.condition_id) || new Map<number, string>();
        outcomes.set(Number(row.outcome_index), row.token_id);
        outcomeMap.set(row.condition_id, outcomes);
      }
    }
  }
  // Expand token->condition/outcome mapping for tokens that only appear via splits/redemptions
  // (i.e., not present in the wallet's trade token set).
  const tokenToConditionAll = new Map(tokenToCondition);
  for (const [conditionId, outcomes] of outcomeMap.entries()) {
    for (const [outcomeIndex, tokenId] of outcomes.entries()) {
      if (!tokenId) continue;
      if (!tokenToConditionAll.has(tokenId)) {
        tokenToConditionAll.set(tokenId, { conditionId, outcomeIndex });
      }
    }
  }

  // 6) Resolution prices
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

  const ensureOutcomes = (conditionId: string): Map<number, string> | undefined => {
    const existing = outcomeMap.get(conditionId);
    if (existing) return existing;
    const prices = resMap.get(conditionId);
    if (!prices || prices.size === 0) return undefined;
    const synthetic = new Map<number, string>();
    for (const idx of prices.keys()) {
      synthetic.set(idx, `synthetic:${conditionId}:${idx}`);
    }
    outcomeMap.set(conditionId, synthetic);
    return synthetic;
  };

  // 7) Sequential ledger (per-trade) with implicit split inference
  const inventory = new Map<string, InventoryPos>();
  const ensurePos = (tokenId: string): InventoryPos => {
    const existing = inventory.get(tokenId);
    if (existing) return existing;
    const pos = { trade: 0, split: 0 };
    inventory.set(tokenId, pos);
    return pos;
  };

  let buys = 0;
  let sells = 0;
  let redemptions = 0;
  let splitCost = 0;
  let implicitSplitTokens = 0;
  let implicitSplitFromTrades = 0;
  let implicitSplitFromRedemptions = 0;
  let explicitSplitTokens = 0;
  let redemptionEvents = 0;
  let redemptionApplied = 0;
  let redemptionSkippedNoResolution = 0;
  let redemptionSkippedNoToken = 0;

  const implicitSplitByCondition = new Map<string, number>();
  const explicitSplitByCondition = new Map<string, number>();
  const splitUsedByCondition = new Map<string, number>();
  const splitAvailableByCondition = new Map<string, number>();
  let totalTxHashSplits = 0;

  // Precompute split availability per condition from tx_hash correlation (cap only)
  const txHashes = [...new Set(trades.map((t) => t.tx_hash))];
  const txChunks = chunkArray(txHashes, QUERY_CHUNK_SIZE);
  for (const chunk of txChunks) {
    const splitQ = `
      SELECT condition_id, sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_usdc
      FROM pm_ctf_events
      WHERE tx_hash IN ({txHashes:Array(String)})
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
      GROUP BY condition_id
    `;
    const splitR = await clickhouse.query({
      query: splitQ,
      query_params: { txHashes: chunk },
      format: 'JSONEachRow',
    });
    const rows = (await splitR.json()) as Array<{ condition_id: string; split_usdc: number }>;
    for (const row of rows) {
      const amt = Number(row.split_usdc) || 0;
      if (!row.condition_id || amt <= 0) continue;
      splitAvailableByCondition.set(
        row.condition_id,
        (splitAvailableByCondition.get(row.condition_id) || 0) + amt,
      );
      totalTxHashSplits += amt;
    }
  }

  const applyImplicitSplit = (
    conditionId: string,
    outcomes: Map<number, string>,
    amount: number,
    source: 'trade' | 'redemption'
  ) => {
    if (amount <= 0) return 0;
    // Cap by tx-hash split volume when available to avoid over-attribution
    const available = splitAvailableByCondition.get(conditionId);
    const used = splitUsedByCondition.get(conditionId) || 0;
    const remaining = available !== undefined ? Math.max(0, available - used) : amount;
    const mint = Math.min(amount, remaining);
    if (mint <= 0) return 0;
    for (const tId of outcomes.values()) {
      const p = ensurePos(tId);
      p.split += mint;
    }
    splitCost += mint;
    implicitSplitTokens += mint;
    if (source === 'trade') {
      implicitSplitFromTrades += mint;
    } else {
      implicitSplitFromRedemptions += mint;
    }
    implicitSplitByCondition.set(conditionId, (implicitSplitByCondition.get(conditionId) || 0) + mint);
    splitUsedByCondition.set(conditionId, used + mint);
    return mint;
  };

  // 7) Sequential ledger (per-transaction) with implicit split inference.
  // Within each tx, compute per-condition sell deficits (relative to starting inventory + buys),
  // then infer a split equal to the max deficit across outcomes for that condition.
  const txMap = new Map<string, { trades: typeof trades; ts: string }>();
  for (const t of trades) {
    const entry = txMap.get(t.tx_hash);
    if (!entry) {
      txMap.set(t.tx_hash, { trades: [t], ts: t.trade_time });
    } else {
      entry.trades.push(t);
      if (t.trade_time < entry.ts) entry.ts = t.trade_time;
    }
  }

  const txEntries = [...txMap.values()].sort((a, b) => a.ts.localeCompare(b.ts));

  for (const tx of txEntries) {
    // Aggregate buys/sells per token within this tx
    const perToken = new Map<string, { buys: number; sells: number; usdcBuy: number; usdcSell: number }>();
    for (const trade of tx.trades) {
      const mapping = tokenToCondition.get(trade.token_id);
      if (!mapping) continue;
      const entry = perToken.get(trade.token_id) || { buys: 0, sells: 0, usdcBuy: 0, usdcSell: 0 };
      if (trade.side === 'buy') {
        entry.buys += trade.tokens;
        entry.usdcBuy += trade.usdc;
      } else {
        entry.sells += trade.tokens;
        entry.usdcSell += trade.usdc;
      }
      perToken.set(trade.token_id, entry);
    }

    // 7a) Infer splits per condition based on deficits within this tx
    const conditionMaxDeficit = new Map<string, number>();
    for (const [tokenId, stats] of perToken.entries()) {
      const mapping = tokenToCondition.get(tokenId);
      if (!mapping) continue;
      const outcomes = ensureOutcomes(mapping.conditionId);
      if (!outcomes) continue;
      const pos = ensurePos(tokenId);
      const available = pos.trade + pos.split + stats.buys;
      const deficit = Math.max(0, stats.sells - available);
      if (deficit > 0) {
        const current = conditionMaxDeficit.get(mapping.conditionId) || 0;
        conditionMaxDeficit.set(mapping.conditionId, Math.max(current, deficit));
      }
    }

    for (const [conditionId, deficit] of conditionMaxDeficit.entries()) {
      const outcomes = ensureOutcomes(conditionId);
      if (!outcomes) continue;
      applyImplicitSplit(conditionId, outcomes, deficit, 'trade');
    }

    // 7b) Apply buys/sells to inventory
    for (const [tokenId, stats] of perToken.entries()) {
      const pos = ensurePos(tokenId);
      // Apply buys
      if (stats.buys > 0) {
        pos.trade += stats.buys;
        buys += stats.usdcBuy;
      }
      // Apply sells (consume trade then split)
      if (stats.sells > 0) {
        let remaining = stats.sells;
        if (pos.trade > 0) {
          const use = Math.min(pos.trade, remaining);
          pos.trade -= use;
          remaining -= use;
        }
        if (remaining > 0 && pos.split > 0) {
          const use = Math.min(pos.split, remaining);
          pos.split -= use;
          remaining -= use;
        }
        if (remaining > 0) {
          // Track short inventory for unmatched sells
          pos.trade -= remaining;
        }
        sells += stats.usdcSell;
      }
    }
  }

  // 9) Apply explicit splits/merges (wallet-address events)
  for (const e of ctfEvents) {
    const amount = Number(e.amount_or_payout || 0) / 1e6;
    if (amount <= 0) continue;
    const outcomes = ensureOutcomes(e.condition_id);
    if (!outcomes) continue;
    if (e.event_type === 'PositionSplit') {
      splitCost += amount;
      explicitSplitTokens += amount;
      explicitSplitByCondition.set(
        e.condition_id,
        (explicitSplitByCondition.get(e.condition_id) || 0) + amount,
      );
      for (const tokenId of outcomes.values()) {
        const pos = ensurePos(tokenId);
        pos.split += amount;
      }
    } else if (e.event_type === 'PositionsMerge') {
      sells += amount;
      for (const tokenId of outcomes.values()) {
        const pos = ensurePos(tokenId);
        const total = pos.trade + pos.split;
        const use = Math.min(total, amount);
        if (use <= 0) continue;
        // Consume trade inventory first (preserve split-derived tokens)
        const useTrade = Math.min(pos.trade, use);
        pos.trade -= useTrade;
        const remaining = use - useTrade;
        if (remaining > 0) {
          pos.split = Math.max(0, pos.split - remaining);
        }
      }
    }
  }

  // 10) Redemptions (resolve winning outcome)
  const redemptionByCondition = new Map<string, number>();
  const redemptionEventsByCondition = new Map<string, Array<{ ts: string; usdc: number }>>();
  for (const e of ctfEvents) {
    if (e.event_type !== 'PayoutRedemption') continue;
    redemptionEvents += 1;
    const amt = Number(e.amount_or_payout || 0) / 1e6;
    if (amt <= 0) continue;
    redemptionByCondition.set(e.condition_id, (redemptionByCondition.get(e.condition_id) || 0) + amt);
    const list = redemptionEventsByCondition.get(e.condition_id) || [];
    list.push({ ts: e.event_timestamp, usdc: amt });
    redemptionEventsByCondition.set(e.condition_id, list);
  }

  for (const [conditionId, redemptionAmount] of redemptionByCondition.entries()) {
    const prices = resMap.get(conditionId);
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
    const outcomes = ensureOutcomes(conditionId);
    if (!outcomes) {
      redemptionSkippedNoToken += 1;
      continue;
    }
    const tokenId = outcomes.get(winnerIdx) || `synthetic:${conditionId}:${winnerIdx}`;
    const tokenAmount = redemptionAmount / winnerPrice;
    if (tokenAmount <= 0) continue;

    // Treat redemption as a sell at resolution price.
    // If inventory is insufficient, infer an implicit split for this condition.
    const pos = ensurePos(tokenId);
    const available = pos.trade + pos.split;

    const hasSplitSource =
      (implicitSplitByCondition.get(conditionId) || 0) > 0 ||
      (explicitSplitByCondition.get(conditionId) || 0) > 0;

    // Consume inventory with source-aware priority:
    // - If this condition had splits inferred/explicit, redeem from split first.
    // - Otherwise redeem from trade first (buy-only wallets).
    let remaining = tokenAmount;
    if (hasSplitSource) {
      if (pos.split > 0) {
        const use = Math.min(pos.split, remaining);
        pos.split -= use;
        remaining -= use;
      }
      if (remaining > 0 && pos.trade > 0) {
        const use = Math.min(pos.trade, remaining);
        pos.trade -= use;
        remaining -= use;
      }
    } else {
      if (pos.trade > 0) {
        const use = Math.min(pos.trade, remaining);
        pos.trade -= use;
        remaining -= use;
      }
      if (remaining > 0 && pos.split > 0) {
        const use = Math.min(pos.split, remaining);
        pos.split -= use;
        remaining -= use;
      }
    }
    if (remaining > 0) {
      // If redemption exceeds inventory, infer an implicit split for this condition
      // and consume the newly minted winner tokens. Skip for net buyers.
      const outcomes = ensureOutcomes(conditionId);
      if (outcomes) {
        applyImplicitSplit(conditionId, outcomes, remaining, 'redemption');
        const p = ensurePos(tokenId);
        const use = Math.min(p.split, remaining);
        p.split -= use;
        remaining -= use;
      }
    }
    if (remaining > 0) {
      redemptionSkippedNoToken += 1;
    }

    redemptions += redemptionAmount;
    redemptionApplied += 1;
  }

  // 11) Condition-level split need (universal deficit over time, no tx_hash)
  // For each outcome, compute min inventory over time (buys/sells + redemptions)
  // requiredSplit = max(0, -minInventory); conditionSplitCost = max(requiredSplit across outcomes)
  const tokenEvents = new Map<string, Array<{ ts: string; delta: number }>>();
  for (const trade of trades) {
    if (!tokenToCondition.has(trade.token_id)) continue;
    const list = tokenEvents.get(trade.token_id) || [];
    list.push({ ts: trade.trade_time, delta: trade.side === 'buy' ? trade.tokens : -trade.tokens });
    tokenEvents.set(trade.token_id, list);
  }

  let conditionSplitCost = 0;
  for (const conditionId of conditionIdList) {
    const outcomes = ensureOutcomes(conditionId);
    if (!outcomes || outcomes.size === 0) continue;
    const prices = resMap.get(conditionId);
    // Determine winning outcome for redemption attribution
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
    let maxRequired = 0;
    for (const [outcomeIdx, tokenId] of outcomes.entries()) {
      const events = [...(tokenEvents.get(tokenId) || [])];
      // Add redemption token outflow for winning outcome
      if (winningOutcome !== null && outcomeIdx === winningOutcome) {
        const reds = redemptionEventsByCondition.get(conditionId) || [];
        if (winningPrice > 0) {
          for (const r of reds) {
            const tokens = r.usdc / winningPrice;
            if (tokens > 0) {
              events.push({ ts: r.ts, delta: -tokens });
            }
          }
        }
      }
      if (events.length === 0) continue;
      events.sort((a, b) => a.ts.localeCompare(b.ts));
      let inv = 0;
      let minInv = 0;
      for (const ev of events) {
        inv += ev.delta;
        if (inv < minInv) minInv = inv;
      }
      const requiredSplit = Math.max(0, -minInv);
      if (requiredSplit > maxRequired) maxRequired = requiredSplit;
    }
    conditionSplitCost += maxRequired;
  }

  // 11) Held value for resolved positions (final inventory)
  let heldValue = 0;
  let openPositions = 0;
  for (const [tokenId, pos] of inventory.entries()) {
    const net = pos.trade + pos.split;
    if (net <= 0) continue;
    const mapping = tokenToConditionAll.get(tokenId);
    if (!mapping) continue;
    const price = resMap.get(mapping.conditionId)?.get(mapping.outcomeIndex);
    if (price === undefined || price === null) {
      openPositions += 1;
      continue;
    }
    heldValue += net * price;
  }

  // Choose split-cost strategy:
  // - Net buyers: use condition-level split need (deficits on specific outcomes)
  // - Net sellers with heavy taker-sell activity: use tx-hash/ledger inferred splits
  // - Otherwise: use condition-level split need
  let splitCostMode: 'txhash' | 'condition' | 'none' = 'condition';
  let finalSplitCost = splitCost;
  if (totalSellUsdc === 0) {
    splitCostMode = 'none';
    finalSplitCost = 0;
  } else if (isNetBuyer) {
    splitCostMode = 'condition';
    finalSplitCost = conditionSplitCost;
  } else if (takerSellShare >= 0.75 && totalTxHashSplits > 0) {
    splitCostMode = 'txhash';
    finalSplitCost = splitCost;
  } else {
    splitCostMode = 'condition';
    finalSplitCost = conditionSplitCost;
  }

  const realizedPnl = sells + redemptions - buys - finalSplitCost + heldValue;

  return {
    wallet: normalized,
    buys,
    sells,
    redemptions,
    splitCost: finalSplitCost,
    heldValue,
    realizedPnl,
    trades: tradeCount,
    openPositions,
    mappedTokens,
    totalTokens,
    mappingCoveragePct,
    implicitSplitTokens,
    implicitSplitFromTrades,
    implicitSplitFromRedemptions,
    explicitSplitTokens,
    redemptionEvents,
    redemptionApplied,
    redemptionSkippedNoResolution,
    redemptionSkippedNoToken,
    netTokenBalance,
    isNetBuyer,
    takerSellShare,
    splitCostMode,
    conditionSplitCost,
  };
}
