import { clickhouse } from '@/lib/clickhouse/client';

export interface LedgerV2Result {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  merges: number;
  splitCost: number;
  heldValue: number;
  realizedPnl: number;
  trades: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
  implicitSplits: number;
  implicitSplitFromTrades: number;
  implicitSplitFromRedemptions: number;
  explicitSplits: number;
  openPositions: number;
  netTokenBalance: number;
  isNetBuyer: boolean;
  redemptionEvents: number;
  redemptionApplied: number;
  redemptionSkippedNoResolution: number;
  redemptionSkippedNoToken: number;
}

interface LedgerEventTrade {
  kind: 'trade';
  time: string;
  side: 'buy' | 'sell';
  usdc: number;
  tokens: number;
  tokenId: string;
  txHash: string;
  role?: string | null;
}

interface LedgerEventCTF {
  kind: 'split' | 'merge' | 'redemption';
  time: string;
  conditionId: string;
  amountUsdc: number;
}

type LedgerEvent = LedgerEventTrade | LedgerEventCTF;

const QUERY_CHUNK_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function redeemedTokensFromPayout(payoutUsdc: number, resolutionPrice?: number | null): number {
  if (!resolutionPrice || resolutionPrice <= 0) return 0;
  return payoutUsdc / resolutionPrice;
}

function sortEvents(a: LedgerEvent, b: LedgerEvent): number {
  const ta = new Date(a.time).getTime();
  const tb = new Date(b.time).getTime();
  if (ta !== tb) return ta - tb;
  const priority: Record<LedgerEvent['kind'], number> = {
    split: 0,
    trade: 1,
    merge: 2,
    redemption: 3,
  };
  const kindDiff = priority[a.kind] - priority[b.kind];
  if (kindDiff !== 0) return kindDiff;
  if (a.kind === 'trade' && b.kind === 'trade') {
    const txA = a.txHash || '';
    const txB = b.txHash || '';
    if (txA !== txB) return txA.localeCompare(txB);
    const sideOrder = (side: 'buy' | 'sell') => (side === 'sell' ? 0 : 1);
    return sideOrder(a.side) - sideOrder(b.side);
  }
  return 0;
}

export async function computeLedgerV2Pnl(wallet: string): Promise<LedgerV2Result> {
  const w = wallet.toLowerCase();

  // 1) Load deduped CLOB trades
  const tradesQ = `
    SELECT
      side,
      usdc_amount/1e6 as usdc,
      token_amount/1e6 as tokens,
      token_id,
      trade_time,
      lower(concat('0x', hex(transaction_hash))) as tx_hash,
      role
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${w}'
    ORDER BY trade_time ASC
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as Array<{
    side: 'buy' | 'sell';
    usdc: number;
    tokens: number;
    token_id: string;
    trade_time: string;
    tx_hash: string;
    role?: string | null;
  }>;

  const tradeCount = trades.length;
  const tokenIds = [...new Set(trades.map((t) => t.token_id))];

  let tokensBought = 0;
  let tokensSold = 0;
  for (const t of trades) {
    if (t.side === 'buy') tokensBought += t.tokens;
    else tokensSold += t.tokens;
  }
  const netTokenBalance = tokensBought - tokensSold;
  const isNetBuyer = netTokenBalance > 0;

  if (tokenIds.length === 0) {
    return {
      wallet: w,
      buys: 0,
      sells: 0,
      redemptions: 0,
      merges: 0,
      splitCost: 0,
      heldValue: 0,
      realizedPnl: 0,
      trades: tradeCount,
      mappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
      implicitSplits: 0,
      implicitSplitFromTrades: 0,
      implicitSplitFromRedemptions: 0,
      explicitSplits: 0,
      openPositions: 0,
      netTokenBalance,
      isNetBuyer,
      redemptionEvents: 0,
      redemptionApplied: 0,
      redemptionSkippedNoResolution: 0,
      redemptionSkippedNoToken: 0,
    };
  }

  // 2) Load CTF events (splits/merges/redemptions)
  const ctfQ = `
    SELECT
      event_type,
      condition_id,
      amount_or_payout,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
      AND is_deleted = 0
    ORDER BY event_timestamp ASC
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
    const mapped = (await mappingR.json()) as Array<{
      token_id: string;
      condition_id: string;
      outcome_index: number;
    }>;
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

  // 4) Condition IDs from trades + ctf
  const conditionIds = new Set<string>();
  for (const mapping of tokenToCondition.values()) conditionIds.add(mapping.conditionId);
  for (const e of ctfEvents) conditionIds.add(e.condition_id);
  const conditionIdList = [...conditionIds];

  // 5) Condition -> outcome -> token map
  const outcomeMap = new Map<string, Map<number, string>>();
  if (conditionIdList.length > 0) {
    const conditionChunks = chunkArray(conditionIdList, QUERY_CHUNK_SIZE);
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
          k.condition_id as condition_id,
          k.outcome_index as outcome_index,
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
        const outcomes = outcomeMap.get(row.condition_id) || new Map<number, string>();
        outcomes.set(Number(row.outcome_index), row.token_id);
        outcomeMap.set(row.condition_id, outcomes);
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
    const resRows = (await resR.json()) as Array<{
      condition_id: string;
      outcome_index: number;
      resolved_price: number;
    }>;
    for (const row of resRows) {
      const m = resMap.get(row.condition_id) || new Map<number, number>();
      m.set(Number(row.outcome_index), Number(row.resolved_price));
      resMap.set(row.condition_id, m);
    }
  }

  // 7) Build ledger events
  const events: LedgerEvent[] = [];
  for (const t of trades) {
    events.push({
      kind: 'trade',
      time: t.trade_time,
      side: t.side,
      usdc: Number(t.usdc) || 0,
      tokens: Number(t.tokens) || 0,
      tokenId: t.token_id,
      txHash: t.tx_hash || '',
      role: t.role ?? null,
    });
  }
  for (const e of ctfEvents) {
    const amt = Number(e.amount_or_payout || 0) / 1e6;
    if (amt <= 0) continue;
    if (e.event_type === 'PositionSplit') {
      events.push({ kind: 'split', time: e.event_timestamp, conditionId: e.condition_id, amountUsdc: amt });
    } else if (e.event_type === 'PositionsMerge') {
      events.push({ kind: 'merge', time: e.event_timestamp, conditionId: e.condition_id, amountUsdc: amt });
    } else {
      events.push({ kind: 'redemption', time: e.event_timestamp, conditionId: e.condition_id, amountUsdc: amt });
    }
  }

  events.sort(sortEvents);

  // 8) Ledger state
  const tradeInv = new Map<string, number>();
  const splitInv = new Map<string, number>();
  const setTradeInv = (tokenId: string, value: number) => {
    tradeInv.set(tokenId, value);
  };
  const setSplitInv = (tokenId: string, value: number) => {
    splitInv.set(tokenId, value);
  };
  const getTradeInv = (tokenId: string) => tradeInv.get(tokenId) || 0;
  const getSplitInv = (tokenId: string) => splitInv.get(tokenId) || 0;
  const getTotalInv = (tokenId: string) => getTradeInv(tokenId) + getSplitInv(tokenId);
  const consumeFromInventory = (tokenId: string, amount: number) => {
    if (amount <= 0) return;
    let remaining = amount;
    // Prefer consuming trade inventory first; split inventory is a fallback
    // when trades don't cover the outflow (deficit-driven splits).
    const tradeAvail = getTradeInv(tokenId);
    if (tradeAvail > 0) {
      const use = Math.min(tradeAvail, remaining);
      setTradeInv(tokenId, tradeAvail - use);
      remaining -= use;
    }
    if (remaining > 0) {
      const splitAvail = getSplitInv(tokenId);
      const use = Math.min(splitAvail, remaining);
      setSplitInv(tokenId, splitAvail - use);
      remaining -= use;
    }
  };

  let buys = 0;
  let sells = 0;
  let redemptions = 0;
  let merges = 0;
  let splitCost = 0;
  let heldValue = 0;
  let implicitSplits = 0;
  let implicitSplitFromTrades = 0;
  let implicitSplitFromRedemptions = 0;
  let explicitSplits = 0;
  let redemptionEvents = 0;
  let redemptionApplied = 0;
  let redemptionSkippedNoResolution = 0;
  let redemptionSkippedNoToken = 0;
  let openPositions = 0;

  const applySplit = (conditionId: string, amount: number, source: 'trade' | 'redemption' | 'explicit') => {
    if (amount <= 0) return;
    const outcomes = outcomeMap.get(conditionId);
    if (!outcomes || outcomes.size === 0) return;
    for (const tokenId of outcomes.values()) {
      setSplitInv(tokenId, getSplitInv(tokenId) + amount);
    }
    splitCost += amount;
    if (source === 'explicit') {
      explicitSplits += amount;
    } else {
      implicitSplits += amount;
      if (source === 'trade') implicitSplitFromTrades += amount;
      if (source === 'redemption') implicitSplitFromRedemptions += amount;
    }
  };

  const applyMerge = (conditionId: string, amount: number) => {
    if (amount <= 0) return;
    const outcomes = outcomeMap.get(conditionId);
    if (!outcomes || outcomes.size === 0) return;
    for (const tokenId of outcomes.values()) {
      consumeFromInventory(tokenId, amount);
    }
    merges += amount;
  };

  for (const event of events) {
    if (event.kind === 'trade') {
      const mapping = tokenToCondition.get(event.tokenId);
      if (!mapping) continue;
      if (event.side === 'buy') {
        setTradeInv(event.tokenId, getTradeInv(event.tokenId) + event.tokens);
        buys += event.usdc;
        continue;
      }
      // SELL
      let available = getTotalInv(event.tokenId);
      if (available < event.tokens) {
        const deficit = event.tokens - available;
        applySplit(mapping.conditionId, deficit, 'trade');
        available = getTotalInv(event.tokenId);
      }
      consumeFromInventory(event.tokenId, event.tokens);
      sells += event.usdc;
      continue;
    }

    if (event.kind === 'split') {
      applySplit(event.conditionId, event.amountUsdc, 'explicit');
      continue;
    }

    if (event.kind === 'merge') {
      applyMerge(event.conditionId, event.amountUsdc);
      continue;
    }

    // redemption
    redemptionEvents += 1;
    const prices = resMap.get(event.conditionId);
    if (!prices || prices.size === 0) {
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
    const outcomes = outcomeMap.get(event.conditionId);
    const winnerTokenId = outcomes?.get(winnerIdx);
    if (!winnerTokenId) {
      redemptionSkippedNoToken += 1;
      continue;
    }
    const redeemedTokens = redeemedTokensFromPayout(event.amountUsdc, winnerPrice);
    if (redeemedTokens <= 0) {
      redemptionSkippedNoResolution += 1;
      continue;
    }
    let available = getTotalInv(winnerTokenId);
    if (available < redeemedTokens) {
      const deficit = redeemedTokens - available;
      applySplit(event.conditionId, deficit, 'redemption');
      available = getTotalInv(winnerTokenId);
    }
    consumeFromInventory(winnerTokenId, redeemedTokens);
    redemptions += event.amountUsdc;
    redemptionApplied += 1;
  }

  // 9) Held value and open positions
  const allTokenIds = new Set<string>([...tradeInv.keys(), ...splitInv.keys()]);
  for (const tokenId of allTokenIds) {
    const amount = getTotalInv(tokenId);
    if (amount <= 0) continue;
    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) continue;
    const price = resMap.get(mapping.conditionId)?.get(mapping.outcomeIndex);
    if (price === undefined || price === null) {
      openPositions += 1;
      continue;
    }
    heldValue += amount * price;
  }

  const realizedPnl = sells + redemptions + merges - buys - splitCost + heldValue;

  return {
    wallet: w,
    buys,
    sells,
    redemptions,
    merges,
    splitCost,
    heldValue,
    realizedPnl,
    trades: tradeCount,
    mappedTokens: tokenToCondition.size,
    totalTokens,
    mappingCoveragePct,
    implicitSplits,
    implicitSplitFromTrades,
    implicitSplitFromRedemptions,
    explicitSplits,
    openPositions,
    netTokenBalance,
    isNetBuyer,
    redemptionEvents,
    redemptionApplied,
    redemptionSkippedNoResolution,
    redemptionSkippedNoToken,
  };
}
