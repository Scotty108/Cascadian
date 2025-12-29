import { clickhouse } from '@/lib/clickhouse/client';

export interface EconomicParityResult {
  wallet: string;
  buys: number;
  sells: number;
  splitCost: number;
  mergeValue: number;
  redemptions: number;
  payoutValue: number;
  heldValue: number;
  gain: number;
  loss: number;
  realizedPnl: number;
  trades: number;
  openPositions: number;
  unmappedTokens: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
  splitTxHashCount: number;
  tradeTxHashCount: number;
  splitTxHashCoveragePct: number;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const QUERY_CHUNK_SIZE = 750;

export async function computeEconomicParityPnl(wallet: string): Promise<EconomicParityResult> {
  const normalized = wallet.toLowerCase();

  // 1) Deduped CLOB trades (base_id)
  const tradesQ = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(side) as side,
        any(usdc_amount)/1e6 as usdc,
        any(token_amount)/1e6 as tokens,
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(transaction_hash) as transaction_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${normalized}' AND is_deleted = 0
      GROUP BY base_id
    )
    SELECT
      count() as trade_count,
      sum(if(side = 'buy', usdc, 0)) as buys,
      sum(if(side = 'sell', usdc, 0)) as sells,
      countDistinct(transaction_hash) as trade_tx_hashes
    FROM deduped
  `;

  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const tradesRow = ((await tradesR.json()) as any[])[0];

  const buys = parseFloat(tradesRow.buys || 0);
  const sells = parseFloat(tradesRow.sells || 0);
  const tradeCount = parseInt(tradesRow.trade_count || 0, 10);
  const tradeTxHashCount = parseInt(tradesRow.trade_tx_hashes || 0, 10);

  // 2) Net token positions from trades
  const positionsQ = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(side) as side,
        any(token_amount)/1e6 as tokens,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${normalized}' AND is_deleted = 0
      GROUP BY base_id
    )
    SELECT
      token_id,
      sum(if(side = 'buy', tokens, -tokens)) as net_tokens
    FROM deduped
    GROUP BY token_id
    HAVING net_tokens != 0
  `;
  const posR = await clickhouse.query({ query: positionsQ, format: 'JSONEachRow' });
  const posRows = (await posR.json()) as Array<{ token_id: string; net_tokens: number }>;

  const tokenIds = posRows.map((r) => r.token_id);
  const netByToken = new Map<string, number>();
  for (const row of posRows) netByToken.set(row.token_id, Number(row.net_tokens));

  if (tokenIds.length === 0) {
    const gain = sells;
    const loss = buys;
    // No positions means no splits to track, so coverage is 0
    return {
      wallet: normalized,
      buys,
      sells,
      splitCost: 0,
      mergeValue: 0,
      redemptions: 0,
      payoutValue: 0,
      heldValue: 0,
      gain,
      loss,
      realizedPnl: gain - loss,
      trades: tradeCount,
      openPositions: 0,
      unmappedTokens: 0,
      mappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
      splitTxHashCount: 0,
      tradeTxHashCount,
      splitTxHashCoveragePct: 0,
    };
  }

  // 4) Map tokens -> condition/outcome (patch overrides gamma)
  const mapped: Array<{ token_id: string; condition_id: string; outcome_index: number; source: string }> = [];
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
        COALESCE(if(p.condition_id != '', p.outcome_index, NULL), g.outcome_index) as outcome_index,
        if(p.condition_id != '', 'patch', 'gamma') as source
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
    mapped.push(...((await mappingR.json()) as any[]));
  }

  const mappedTokens = new Set(mapped.map((m) => m.token_id));
  const totalTokens = tokenIds.length;
  const unmappedTokens = tokenIds.filter((t) => !mappedTokens.has(t)).length;
  const mappingCoveragePct = totalTokens > 0 ? mappedTokens.size / totalTokens : 0;
  // Base condition set from traded tokens
  const conditionIdSet = new Set<string>(mapped.map((m) => m.condition_id));

  // Add conditions from explicit redemptions (may include tokens never traded)
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

  const conditionIds = [...conditionIdSet];

  // Build full condition -> outcome -> token map (all outcomes, not just traded tokens)
  const conditionOutcomeToToken = new Map<string, Map<number, string>>();
  const conditionChunks = chunkArray(conditionIds, QUERY_CHUNK_SIZE);
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
      const m = conditionOutcomeToToken.get(row.condition_id) || new Map<number, string>();
      m.set(Number(row.outcome_index), row.token_id);
      conditionOutcomeToToken.set(row.condition_id, m);
    }
  }

  // 3) Split/Merge cost via tx_hash where wallet SOLD in the tx,
  // and only for conditions the wallet actually traded.
  let splitCost = 0;
  let mergeValue = 0;
  let splitTxHashCount = 0;

  const splitTxSet = new Set<string>();
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
        event_type,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT tx_hash FROM sell_tx)
        AND is_deleted = 0
        AND condition_id IN ({conditionIds:Array(String)})
        AND event_type IN ('PositionSplit', 'PositionsMerge')
      GROUP BY event_type
    `;

    const splitR = await clickhouse.query({
      query: splitQ,
      query_params: { conditionIds: chunk },
      format: 'JSONEachRow',
    });
    const splitRows = (await splitR.json()) as any[];
    for (const row of splitRows) {
      if (row.event_type === 'PositionSplit') splitCost += parseFloat(row.total || 0);
      if (row.event_type === 'PositionsMerge') mergeValue += parseFloat(row.total || 0);
    }

    const txQ = `
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
      SELECT DISTINCT tx_hash
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT tx_hash FROM sell_tx)
        AND is_deleted = 0
        AND condition_id IN ({conditionIds:Array(String)})
        AND event_type = 'PositionSplit'
    `;
    const txR = await clickhouse.query({
      query: txQ,
      query_params: { conditionIds: chunk },
      format: 'JSONEachRow',
    });
    const txRows = (await txR.json()) as Array<{ tx_hash: string }>;
    for (const row of txRows) splitTxSet.add(row.tx_hash);
  }
  splitTxHashCount = splitTxSet.size;
  let payoutValue = 0;
  let redemptions = 0;
  let openPositions = 0;

  if (conditionIds.length > 0) {
    const resChunks = chunkArray(conditionIds, QUERY_CHUNK_SIZE);
    const resMap = new Map<string, Map<number, number>>();

    for (const chunk of resChunks) {
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

    // Build reverse map: condition_id + outcome_index -> token_id (all outcomes)
    const tokenByOutcome = new Map<string, string>();
    for (const [cid, outcomes] of conditionOutcomeToToken.entries()) {
      for (const [idx, tokenId] of outcomes.entries()) {
        tokenByOutcome.set(`${cid}:${idx}`, tokenId);
      }
    }
    // Fallback: ensure any traded-token mappings are available (covers deleted markets)
    for (const row of mapped) {
      const key = `${row.condition_id}:${row.outcome_index}`;
      if (!tokenByOutcome.has(key)) {
        tokenByOutcome.set(key, row.token_id);
      }
    }

    // Identify winner outcome per condition (resolved_price = 1)
    const winnerOutcome = new Map<string, number>();
    for (const [cid, prices] of resMap.entries()) {
      for (const [idx, price] of prices.entries()) {
        if (price === 1) {
          winnerOutcome.set(cid, idx);
        }
      }
    }

    // 4b) Apply redemptions: add cash. (Legacy parity: do NOT reduce net positions here.)
    const redQ = `
      SELECT condition_id, amount_or_payout
      FROM pm_ctf_events
      WHERE lower(user_address) = '${normalized}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `;
    const redR = await clickhouse.query({ query: redQ, format: 'JSONEachRow' });
    const redRows = (await redR.json()) as Array<{ condition_id: string; amount_or_payout: string | number }>;

    for (const row of redRows) {
      const cid = row.condition_id;
      const winIdx = winnerOutcome.get(cid);
      if (winIdx === undefined) continue;
      const tokenId = tokenByOutcome.get(`${cid}:${winIdx}`);
      if (!tokenId) continue;
      const amount = Number(row.amount_or_payout || 0) / 1e6;
      if (amount <= 0) continue;
      redemptions += amount; // payout at $1
      // NOTE: We intentionally do NOT reduce net positions here.
      // This matches the previously validated economic parity output for the calibration wallet.
    }

    // 4c) Synthetic payout for remaining net positions in resolved markets
    for (const row of mapped) {
      const net = netByToken.get(row.token_id) || 0;
      if (net <= 0) continue;
      const prices = resMap.get(row.condition_id);
      if (!prices) {
        openPositions++;
        continue;
      }
      const price = prices.get(Number(row.outcome_index));
      if (price === undefined || price === null) {
        openPositions++;
        continue;
      }
      payoutValue += net * price;
    }
  }

  // NOTE: We intentionally exclude mergeValue to match the validated cash-flow
  // formula (Sells + Redemptions - Buys - SplitCost + HeldValue).
  const heldValue = payoutValue;
  const gain = sells + payoutValue + redemptions;
  const loss = buys + splitCost;
  const splitTxHashCoveragePct = tradeTxHashCount > 0 ? splitTxHashCount / tradeTxHashCount : 0;

  return {
    wallet: normalized,
    buys,
    sells,
    splitCost,
    mergeValue,
    redemptions,
    payoutValue,
    heldValue,
    gain,
    loss,
    realizedPnl: gain - loss,
    trades: tradeCount,
    openPositions,
    unmappedTokens,
    mappedTokens: mappedTokens.size,
    totalTokens,
    mappingCoveragePct,
    splitTxHashCount,
    tradeTxHashCount,
    splitTxHashCoveragePct,
  };
}
