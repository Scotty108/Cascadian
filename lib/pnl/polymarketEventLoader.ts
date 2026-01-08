/**
 * Polymarket Event Loader
 *
 * Loads and transforms events from ClickHouse into the format expected
 * by the polymarketSubgraphEngine.
 *
 * Data sources:
 * 1. CLOB trades from pm_trader_events_v3
 * 2. CTF events (Split/Merge/Redemption) from pm_ctf_events
 * 3. Resolutions from pm_condition_resolutions
 *
 * @see polymarketSubgraphEngine.ts
 */

import { clickhouse } from '../clickhouse/client';
import {
  PolymarketPnlEvent,
  PolymarketEventType,
  COLLATERAL_SCALE,
  PnlMode,
  resolveEngineOptions,
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
} from './polymarketSubgraphEngine';
// Note: We inline hex-to-bigint conversion rather than using polymarketConstants
// helpers since BigInt() handles "0x..." format directly

/**
 * Chunk an array into smaller arrays of specified size
 * Used to avoid "Field value too long" errors in ClickHouse queries
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Maximum number of condition_ids or token_ids to include in a single query
 * Prevents "Field value too long" errors from ClickHouse
 */
const QUERY_CHUNK_SIZE = 750;

/**
 * Maximum number of condition_ids a wallet can have before being skipped
 * Very high-activity wallets can have thousands of conditions which causes
 * query payloads to exceed ClickHouse limits
 */
const MAX_CONDITIONS_PER_WALLET = 20000;

/**
 * Raw CLOB trade row from pm_trader_events_v3
 */
interface ClobTradeRow {
  event_id: string;
  token_id: string;
  side: 'buy' | 'sell';
  usdc_amount: number;
  token_amount: number;
  trade_time: string;
  transaction_hash: string;
  block_number: string;
}

/**
 * Raw CTF event row from pm_ctf_events
 */
interface CtfEventRow {
  event_type: 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
  condition_id: string;
  amount_or_payout: string;
  event_timestamp: string;
  block_number: string;
  tx_hash: string;
  id: string;
}

/**
 * Token mapping row from pm_token_to_condition_map_v5
 */
interface TokenMappingRow {
  condition_id: string;
  token_id_dec: string;
  outcome_index: number;
}

/**
 * Resolution row from pm_condition_resolutions
 */
interface ResolutionRow {
  condition_id: string;
  payout_numerators: string;
  payout_denominator: string;
}

/**
 * Raw ERC1155 transfer row from pm_erc1155_transfers
 *
 * IMPORTANT: Token ID is in HEX format (e.g., 0xabc...)
 * Must be converted to decimal for matching with CLOB trades.
 */
interface Erc1155TransferRow {
  tx_hash: string;
  log_index: number;
  block_number: string;
  block_timestamp: string;
  token_id: string; // HEX format
  from_address: string;
  to_address: string;
  value: string; // HEX encoded amount
}

/**
 * Synthetic cost adjustment row for tx_hash split cost allocation
 */
interface SplitCostAllocation {
  tx_hash: string;
  token_id: string;
  usdc_debit: bigint;
  trade_time: string;
  block_number: string;
}

/**
 * Load CLOB trades for a wallet
 *
 * DEDUPLICATION STRATEGY:
 * pm_trader_events_v3 can contain maker/taker duplicates with event_id suffixes
 * like "-m" and "-t" for the same underlying fill. We dedupe by collapsing
 * event_id to its base (strip -m/-t) and grouping by that base_id.
 *
 * This preserves distinct fills while removing maker/taker duplicates, and
 * avoids over-collapsing multiple fills that share a transaction_hash.
 */
async function loadClobTrades(wallet: string): Promise<PolymarketPnlEvent[]> {
  // Note: We use a subquery to first deduplicate, then sort
  const query = `
    SELECT *
    FROM (
      SELECT
        any(event_id) as event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) as usdc_amount,
        any(token_amount) as token_amount,
        any(trade_time) as trade_time,
        any(transaction_hash) as transaction_hash,
        any(block_number) as block_number
      FROM (
        SELECT
          *,
          replaceRegexpAll(event_id, '-[mt]$', '') as base_id
        FROM pm_trader_events_v3
        WHERE trader_wallet = {wallet:String}
         
      )
      GROUP BY base_id
    )
    ORDER BY block_number, trade_time
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as ClobTradeRow[];

  return rows.map((row) => {
    // Both usdc_amount and token_amount are already in micro units (6 decimals)
    // e.g., usdc_amount=765530000 means $765.53, token_amount=1531060000 means 1531.06 tokens
    const tokenAmount = row.token_amount;
    const usdcAmount = row.usdc_amount;

    // price = usdc per token, scaled to COLLATERAL_SCALE
    // Since both are in micro units: price = (usdc / 1e6) / (tokens / 1e6) * 1e6
    // Which simplifies to: price = usdc * 1e6 / tokens
    // But wait - in Polymarket's subgraph, COLLATERAL_SCALE = 1e6
    // price in subgraph = quoteAmount * COLLATERAL_SCALE / baseAmount
    // So: price = usdc_micro * 1e6 / token_micro
    // But usdc_micro = usdc_dollars * 1e6, token_micro = tokens * 1e6
    // So: price = (usdc_dollars * 1e6 * 1e6) / (tokens * 1e6) = usdc_dollars / tokens * 1e6
    // Which means: price = usdc_amount / token_amount * 1e6
    // Since usdc_amount and token_amount are BOTH scaled by 1e6:
    // price = usdc_amount / token_amount (ratio is correct)
    // Then multiply by COLLATERAL_SCALE to get the subgraph scale
    // But actually usdc/tokens when both scaled = usdc/tokens in human terms
    // Example: 765530000 / 1531060000 = 0.5 which is correct $0.50 price
    // Subgraph wants price scaled by 1e6, so 0.5 * 1e6 = 500000
    const price =
      tokenAmount > 0
        ? BigInt(Math.round((usdcAmount / tokenAmount) * 1_000_000))
        : 0n;

    const eventType: PolymarketEventType =
      row.side === 'buy' ? 'ORDER_MATCHED_BUY' : 'ORDER_MATCHED_SELL';

    return {
      wallet: wallet.toLowerCase(),
      tokenId: BigInt(row.token_id),
      eventType,
      price,
      amount: BigInt(Math.round(tokenAmount)), // tokens in micro units
      blockNumber: BigInt(row.block_number),
      logIndex: 0n, // CLOB events don't have log index, use 0
      txHash: row.transaction_hash,
      timestamp: row.trade_time,
      // Store raw USDC amount for economic cashflow reconciliation
      usdcAmountRaw: BigInt(Math.round(usdcAmount)),
    };
  });
}

/**
 * Polymarket ConditionalTokens contract address on Polygon
 * Only ERC1155 transfers from this contract are Polymarket position tokens.
 */
const CONDITIONAL_TOKENS_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';

/**
 * Load ERC1155 transfers for a wallet
 *
 * These are direct token transfers between wallets, not CLOB trades.
 * When tokens are transferred TO the wallet, we create TRANSFER_IN events.
 * When tokens are transferred FROM the wallet, we create TRANSFER_OUT events.
 *
 * IMPORTANT:
 * - Token IDs are in HEX format in pm_erc1155_transfers (convert directly to BigInt)
 * - Value is HEX encoded (convert directly to BigInt)
 * - Excludes mints (from 0x0) and burns (to 0x0)
 * - ONLY includes transfers from the Polymarket ConditionalTokens contract
 */
async function loadErc1155Transfers(wallet: string): Promise<PolymarketPnlEvent[]> {
  const normalizedWallet = wallet.toLowerCase();

  // Query both incoming and outgoing transfers
  // Filter by Polymarket ConditionalTokens contract
  // Exclude mints (from 0x0) and burns (to 0x0)
  const query = `
    SELECT
      tx_hash,
      log_index,
      block_number,
      block_timestamp,
      token_id,
      from_address,
      to_address,
      value
    FROM pm_erc1155_transfers
    WHERE lower(contract) = {contract:String}
      AND (lower(to_address) = {wallet:String} OR lower(from_address) = {wallet:String})
      AND lower(from_address) != '0x0000000000000000000000000000000000000000'
      AND lower(to_address) != '0x0000000000000000000000000000000000000000'
      AND is_deleted = 0
    ORDER BY block_number, log_index
  `;

  const result = await clickhouse.query({
    query,
    query_params: {
      wallet: normalizedWallet,
      contract: CONDITIONAL_TOKENS_CONTRACT,
    },
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Erc1155TransferRow[];
  const events: PolymarketPnlEvent[] = [];

  for (const row of rows) {
    // Convert hex token_id directly to bigint (token_id is "0x..." format)
    let tokenId: bigint;
    try {
      // Ensure 0x prefix for BigInt parsing
      const tokenIdHex = row.token_id.startsWith('0x') ? row.token_id : '0x' + row.token_id;
      tokenId = BigInt(tokenIdHex);
    } catch (e) {
      // Skip if token_id is malformed
      console.warn(`Malformed token_id in ERC1155 transfer: ${row.token_id}`);
      continue;
    }

    // Convert hex value directly to bigint
    let amount: bigint;
    try {
      const valueHex = row.value.startsWith('0x') ? row.value : '0x' + row.value;
      amount = BigInt(valueHex);
    } catch (e) {
      // Skip if value is malformed
      console.warn(`Malformed value in ERC1155 transfer: ${row.value}`);
      continue;
    }

    if (amount <= 0n) continue;

    // Determine event type based on direction
    const isIncoming = row.to_address.toLowerCase() === normalizedWallet;
    const eventType: PolymarketEventType = isIncoming ? 'TRANSFER_IN' : 'TRANSFER_OUT';

    events.push({
      wallet: normalizedWallet,
      tokenId,
      eventType,
      price: 0n, // Transfers have no price - inventory only
      amount,
      blockNumber: BigInt(row.block_number),
      logIndex: BigInt(row.log_index),
      txHash: row.tx_hash,
      timestamp: row.block_timestamp,
      // No usdcAmountRaw for transfers - no USDC changes hands
    });
  }

  return events;
}

/**
 * Build synthetic cost adjustment events from PositionSplit costs by tx_hash.
 *
 * This allocates split collateral cost across tokens with net-positive
 * inventory in the same transaction, and adjusts their avgPrice (debit).
 */
async function loadSplitCostAdjustmentsByTxHash(
  wallet: string
): Promise<PolymarketPnlEvent[]> {
  // 1) Aggregate net token deltas per tx_hash + token_id (deduped by base_id)
  const tradesQ = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) as token_amount,
        any(trade_time) as trade_time,
        any(transaction_hash) as transaction_hash,
        any(block_number) as block_number
      FROM pm_trader_events_v3
      WHERE trader_wallet = {wallet:String}
      GROUP BY base_id
    )
    SELECT
      lower(concat('0x', hex(transaction_hash))) as tx_hash,
      token_id,
      sum(if(side = 'buy', token_amount, -token_amount)) as net_tokens,
      max(trade_time) as trade_time,
      max(block_number) as block_number
    FROM deduped
    GROUP BY tx_hash, token_id
    HAVING net_tokens != 0
  `;

  const tradesR = await clickhouse.query({
    query: tradesQ,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });
  const tradeRows = (await tradesR.json()) as Array<{
    tx_hash: string;
    token_id: string;
    net_tokens: string | number;
    trade_time: string;
    block_number: string;
  }>;

  if (tradeRows.length === 0) return [];

  const txHashes = [...new Set(tradeRows.map((r) => r.tx_hash).filter(Boolean))];
  if (txHashes.length === 0) return [];

  // 2) Load split cost per tx_hash
  const splitRows: Array<{ tx_hash: string; split_amount: string | number }> = [];
  const chunks = chunkArray(txHashes, QUERY_CHUNK_SIZE);
  for (const chunk of chunks) {
    const splitQ = `
      SELECT
        tx_hash,
        sum(toInt64OrZero(amount_or_payout)) as split_amount
      FROM pm_ctf_events
      WHERE tx_hash IN ({txHashes:Array(String)})
        AND is_deleted = 0
        AND event_type = 'PositionSplit'
      GROUP BY tx_hash
    `;
    const splitR = await clickhouse.query({
      query: splitQ,
      query_params: { txHashes: chunk },
      format: 'JSONEachRow',
    });
    splitRows.push(...((await splitR.json()) as any[]));
  }

  const splitMap = new Map<string, bigint>();
  for (const row of splitRows) {
    const amount = BigInt(Math.max(0, Number(row.split_amount || 0)));
    if (amount > 0n) splitMap.set(row.tx_hash, amount);
  }

  if (splitMap.size === 0) return [];

  // 3) Allocate split cost across net-positive token deltas in each tx
  const allocations: SplitCostAllocation[] = [];
  const tradesByTx = new Map<string, typeof tradeRows>();
  for (const row of tradeRows) {
    const list = tradesByTx.get(row.tx_hash) || [];
    list.push(row);
    tradesByTx.set(row.tx_hash, list);
  }

  for (const [txHash, rows] of tradesByTx.entries()) {
    const splitAmount = splitMap.get(txHash);
    if (!splitAmount || splitAmount <= 0n) continue;

    const positive = rows.filter((r) => Number(r.net_tokens) > 0);
    if (positive.length === 0) continue;

    const totalNet = positive.reduce((acc, r) => acc + BigInt(Math.round(Number(r.net_tokens))), 0n);
    if (totalNet <= 0n) continue;

    let remaining = splitAmount;
    for (let i = 0; i < positive.length; i++) {
      const row = positive[i];
      const net = BigInt(Math.round(Number(row.net_tokens)));
      if (net <= 0n) continue;

      // Allocate proportionally, last row gets remainder
      const alloc =
        i === positive.length - 1
          ? remaining
          : (splitAmount * net) / totalNet;
      remaining -= alloc;

      allocations.push({
        tx_hash: txHash,
        token_id: row.token_id,
        usdc_debit: alloc,
        trade_time: row.trade_time,
        block_number: row.block_number,
      });
    }
  }

  // 4) Convert allocations to SYNTHETIC_COST_ADJUSTMENT events (debit = negative credit)
  const events: PolymarketPnlEvent[] = allocations.map((a) => ({
    wallet: wallet.toLowerCase(),
    tokenId: BigInt(a.token_id),
    eventType: 'SYNTHETIC_COST_ADJUSTMENT',
    price: 0n,
    amount: 0n,
    blockNumber: BigInt(a.block_number || 0),
    logIndex: 999n,
    txHash: a.tx_hash,
    timestamp: a.trade_time,
    usdcAmountRaw: -a.usdc_debit,
  }));

  return events;
}
/**
 * Load token mapping for a set of condition_ids
 * Uses chunking to avoid "Field value too long" errors
 *
 * First checks pm_token_to_condition_map_v5, then falls back to
 * pm_market_metadata for any unmapped condition_ids.
 */
async function loadTokenMapping(
  conditionIds: string[]
): Promise<Map<string, TokenMappingRow[]>> {
  if (conditionIds.length === 0) return new Map();

  // Use token_id-level de-duplication with patch override.
  // If a token appears in both patch and gamma, prefer patch.
  const mappingByToken = new Map<string, Map<string, TokenMappingRow>>();
  const chunks = chunkArray(conditionIds, QUERY_CHUNK_SIZE);

  // First pass: Query patch table (highest priority)
  for (const chunk of chunks) {
    const patchQuery = `
      SELECT DISTINCT condition_id, token_id_dec, outcome_index
      FROM pm_token_to_condition_patch
      WHERE condition_id IN ({conditionIds:Array(String)})
        AND condition_id != ''
    `;

    const result = await clickhouse.query({
      query: patchQuery,
      query_params: { conditionIds: chunk },
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as TokenMappingRow[];

    for (const row of rows) {
      const byToken = mappingByToken.get(row.condition_id) || new Map<string, TokenMappingRow>();
      byToken.set(row.token_id_dec, row);
      mappingByToken.set(row.condition_id, byToken);
    }
  }

  // Second pass: Query gamma table and fill only missing tokens per condition
  for (const chunk of chunks) {
    const gammaQuery = `
      SELECT DISTINCT condition_id, token_id_dec, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE condition_id IN ({conditionIds:Array(String)})
        AND condition_id != ''
    `;

    const result = await clickhouse.query({
      query: gammaQuery,
      query_params: { conditionIds: chunk },
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as TokenMappingRow[];

    for (const row of rows) {
      const byToken = mappingByToken.get(row.condition_id) || new Map<string, TokenMappingRow>();
      if (!byToken.has(row.token_id_dec)) {
        byToken.set(row.token_id_dec, row);
        mappingByToken.set(row.condition_id, byToken);
      }
    }
  }

  // Convert mappingByToken to mapping array
  const mapping = new Map<string, TokenMappingRow[]>();
  for (const [conditionId, byToken] of mappingByToken.entries()) {
    mapping.set(conditionId, Array.from(byToken.values()));
  }

  // Find condition_ids not mapped by v5/patch
  const unmappedIds = conditionIds.filter((id) => !mapping.has(id));

  if (unmappedIds.length === 0) return mapping;

  // Second pass: Query pm_market_metadata for unmapped condition_ids
  const unmappedChunks = chunkArray(unmappedIds, QUERY_CHUNK_SIZE);

  for (const chunk of unmappedChunks) {
    const metadataQuery = `
      SELECT condition_id, token_ids
      FROM pm_market_metadata
      WHERE condition_id IN ({conditionIds:Array(String)})
        AND length(token_ids) > 0
    `;

    const metadataResult = await clickhouse.query({
      query: metadataQuery,
      query_params: { conditionIds: chunk },
      format: 'JSONEachRow',
    });

    interface MetadataRow {
      condition_id: string;
      token_ids: string[];
    }

    const metadataRows = (await metadataResult.json()) as MetadataRow[];

    // Convert metadata token_ids array to TokenMappingRow format
    for (const row of metadataRows) {
      const tokenRows: TokenMappingRow[] = row.token_ids.map(
        (tokenId, index) => ({
          condition_id: row.condition_id,
          token_id_dec: tokenId,
          outcome_index: index,
        })
      );
      mapping.set(row.condition_id, tokenRows);
    }
  }

  return mapping;
}

/**
 * Load resolutions for a set of condition_ids
 * Uses chunking to avoid "Field value too long" errors
 */
async function loadResolutions(
  conditionIds: string[]
): Promise<Map<string, { numerators: bigint[]; denominator: bigint }>> {
  if (conditionIds.length === 0) return new Map();

  const resolutions = new Map<
    string,
    { numerators: bigint[]; denominator: bigint }
  >();
  const chunks = chunkArray(conditionIds, QUERY_CHUNK_SIZE);

  for (const chunk of chunks) {
    const query = `
      SELECT condition_id, payout_numerators, payout_denominator
      FROM pm_condition_resolutions
      WHERE condition_id IN ({conditionIds:Array(String)})
        AND is_deleted = 0
    `;

    const result = await clickhouse.query({
      query,
      query_params: { conditionIds: chunk },
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as ResolutionRow[];

    for (const row of rows) {
      // Parse payout_numerators - could be JSON array or comma-separated
      let numerators: bigint[];
      try {
        const parsed = JSON.parse(row.payout_numerators);
        numerators = parsed.map((n: string | number) => BigInt(n));
      } catch {
        numerators = row.payout_numerators.split(',').map((n) => BigInt(n.trim()));
      }

      // CRITICAL: Denominator must be SUM of numerators, not the stored value!
      // The Polymarket subgraph calculates: payoutDenominator = sum(payoutNumerators)
      // Our table incorrectly stores denominator=2 for binary markets with [0,1] or [1,0]
      // This would give $0.50 for winners instead of $1.00
      // Fix: Calculate denominator as sum of numerators
      const denominator = numerators.reduce((acc, n) => acc + n, 0n);

      resolutions.set(row.condition_id, {
        numerators,
        denominator: denominator > 0n ? denominator : 1n, // Fallback to 1 if all zeros
      });
    }
  }

  return resolutions;
}

/**
 * Result from loading CTF events - includes gap stats
 */
interface LoadCtfEventsResult {
  events: PolymarketPnlEvent[];
  gapStats: {
    unmappedEventCount: number;
    unmappedConditionIds: Set<string>;
    skippedUsdcAbs: number;
    skippedTokenAbs: number;
  };
}

/**
 * Build CTF events from raw rows (Split, Merge, Redemption)
 * Tracks skipped events for gap analysis.
 */
async function buildCtfEventsFromRows(
  wallet: string,
  ctfRows: CtfEventRow[]
): Promise<LoadCtfEventsResult> {
  // Initialize gap stats
  const gapStats = {
    unmappedEventCount: 0,
    unmappedConditionIds: new Set<string>(),
    skippedUsdcAbs: 0,
    skippedTokenAbs: 0,
  };

  if (ctfRows.length === 0) {
    return { events: [], gapStats };
  }

  // Get unique condition_ids
  const conditionIds = [...new Set(ctfRows.map((r) => r.condition_id))];

  // Load token mapping and resolutions (only if we have redemptions)
  const needsResolutions = ctfRows.some((r) => r.event_type === 'PayoutRedemption');
  const [tokenMapping, resolutions] = await Promise.all([
    loadTokenMapping(conditionIds),
    needsResolutions ? loadResolutions(conditionIds) : Promise.resolve(new Map()),
  ]);

  const events: PolymarketPnlEvent[] = [];

  for (const row of ctfRows) {
    const tokens = tokenMapping.get(row.condition_id);
    if (!tokens || tokens.length === 0) {
      // Track this skipped event
      gapStats.unmappedEventCount++;
      gapStats.unmappedConditionIds.add(row.condition_id);

      // Track skipped amounts - amount_or_payout is the token amount
      // For splits/merges, this represents USDC equivalent (1:1 with $1 collateral)
      // For redemptions, this is the payout in tokens
      const amount = Number(row.amount_or_payout) / 1e6; // Convert from micro-units
      gapStats.skippedTokenAbs += Math.abs(amount);

      // For splits/merges, token amount = USDC amount (collateral)
      if (row.event_type === 'PositionSplit' || row.event_type === 'PositionsMerge') {
        gapStats.skippedUsdcAbs += Math.abs(amount);
      }
      // For redemptions, USDC = tokens * payout_price (unknown without resolution)
      // Conservatively estimate as tokens * 0.5 (average payout)
      else if (row.event_type === 'PayoutRedemption') {
        gapStats.skippedUsdcAbs += Math.abs(amount) * 0.5;
      }

      continue;
    }

    // Parse amount
    const amount = BigInt(row.amount_or_payout);

    // Map event type
    let eventType: PolymarketEventType;
    switch (row.event_type) {
      case 'PositionSplit':
        eventType = 'SPLIT';
        break;
      case 'PositionsMerge':
        eventType = 'MERGE';
        break;
      case 'PayoutRedemption':
        eventType = 'REDEMPTION';
        break;
      default:
        continue; // Unknown event type
    }

    // For Split/Merge: create events for BOTH outcomes
    // For Redemption: create events for BOTH outcomes with their payout prices
    for (const tokenRow of tokens) {
      let payoutPrice: bigint | undefined;

      if (eventType === 'REDEMPTION') {
        // Get payout price for this outcome
        const resolution = resolutions.get(row.condition_id);
        if (resolution && resolution.denominator > 0n) {
          const numerator = resolution.numerators[tokenRow.outcome_index] || 0n;
          // price = numerator * COLLATERAL_SCALE / denominator
          payoutPrice =
            (numerator * COLLATERAL_SCALE) / resolution.denominator;
        } else {
          // No resolution found - assume $1 for winner
          payoutPrice = COLLATERAL_SCALE;
        }
      }

      events.push({
        wallet: wallet.toLowerCase(),
        tokenId: BigInt(tokenRow.token_id_dec),
        eventType,
        price: payoutPrice || 0n, // Split/Merge use FIFTY_CENTS in engine
        amount,
        blockNumber: BigInt(row.block_number),
        logIndex: BigInt(tokenRow.outcome_index), // Use outcome_index as tie-breaker
        txHash: row.tx_hash,
        timestamp: row.event_timestamp,
        payoutPrice,
      });
    }
  }

  return { events, gapStats };
}

type CtfEventType = CtfEventRow['event_type'];

/**
 * Load CTF events (Split, Merge, Redemption) for a wallet by user_address.
 * Now also tracks skipped events for gap analysis.
 */
async function loadCtfEvents(
  wallet: string,
  eventTypes: CtfEventType[] = ['PositionSplit', 'PositionsMerge', 'PayoutRedemption']
): Promise<LoadCtfEventsResult> {
  // First, get all CTF events for this wallet
  const query = `
    SELECT
      event_type,
      condition_id,
      amount_or_payout,
      event_timestamp,
      block_number,
      tx_hash,
      id
    FROM pm_ctf_events
    WHERE user_address = {wallet:String}
      AND is_deleted = 0
      AND event_type IN ({eventTypes:Array(String)})
    ORDER BY block_number, event_timestamp
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase(), eventTypes },
    format: 'JSONEachRow',
  });

  const ctfRows = (await result.json()) as CtfEventRow[];

  return buildCtfEventsFromRows(wallet, ctfRows);
}

/**
 * Load CTF splits/merges by tx_hash correlation to CLOB trades.
 * This captures PositionSplit/PositionsMerge events emitted under the Exchange contract,
 * which are not attributed to the user_address.
 */
async function loadCtfEventsByTxHash(
  wallet: string,
  eventTypes: CtfEventType[] = ['PositionSplit', 'PositionsMerge']
): Promise<LoadCtfEventsResult> {
  const txQuery = `
    SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v3
    WHERE trader_wallet = {wallet:String}
  `;

  const txResult = await clickhouse.query({
    query: txQuery,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });

  const txRows = (await txResult.json()) as Array<{ tx_hash: string }>;
  const txHashes = txRows.map((r) => r.tx_hash).filter(Boolean);

  if (txHashes.length === 0) {
    return {
      events: [],
      gapStats: {
        unmappedEventCount: 0,
        unmappedConditionIds: new Set<string>(),
        skippedUsdcAbs: 0,
        skippedTokenAbs: 0,
      },
    };
  }

  // Query CTF events in chunks to avoid overly large IN clauses
  const ctfRows: CtfEventRow[] = [];
  const chunks = chunkArray(txHashes, QUERY_CHUNK_SIZE);
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const query = `
      SELECT
        event_type,
        condition_id,
        amount_or_payout,
        event_timestamp,
        block_number,
        tx_hash,
        id
      FROM pm_ctf_events
      WHERE tx_hash IN ({txHashes:Array(String)})
        AND is_deleted = 0
        AND event_type IN ({eventTypes:Array(String)})
    `;

    const result = await clickhouse.query({
      query,
      query_params: { txHashes: chunk, eventTypes },
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as CtfEventRow[];
    for (const row of rows) {
      const key = row.id || `${row.tx_hash}-${row.condition_id}-${row.event_type}-${row.amount_or_payout}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ctfRows.push(row);
    }
  }

  return buildCtfEventsFromRows(wallet, ctfRows);
}

/**
 * Synthesize implicit redemption events for resolved positions
 *
 * When a market resolves, positions become worth their payout value.
 * Users may not explicitly call redeemPositions(), but the Polymarket UI
 * treats resolved positions as if they were redeemed.
 *
 * This function identifies positions in resolved markets that weren't
 * explicitly redeemed and creates synthetic redemption events for them.
 */
type SyntheticRedemptionMode = 'losers_only' | 'all';

async function synthesizeImplicitRedemptions(
  wallet: string,
  existingEvents: PolymarketPnlEvent[],
  ctfEvents: PolymarketPnlEvent[],
  mode: SyntheticRedemptionMode = 'losers_only'
): Promise<PolymarketPnlEvent[]> {
  // Step 1: Compute positions using the SAME engine rules (sell-capping)
  // so synthetic redemptions close positions exactly.
  const tempState = createEmptyEngineState(wallet, { includeTransfers: false, mode: 'strict' });
  for (const event of sortEventsByTimestamp(existingEvents)) {
    applyEventToState(tempState, event);
  }

  // Step 2: Collect positive positions (tokens still held)
  const heldTokenIds: string[] = [];
  const heldAmounts = new Map<string, bigint>(); // tokenId -> amount
  for (const position of tempState.positions.values()) {
    if (position.amount > 0n) {
      const tokenId = position.tokenId.toString();
      heldTokenIds.push(tokenId);
      heldAmounts.set(tokenId, position.amount);
    }
  }

  if (heldTokenIds.length === 0) return [];

  // Step 3: Get token-to-condition mapping for held tokens (with chunking)
  // First try pm_token_to_condition_map_v5 + patch table, then fall back to pm_market_metadata
  const tokenMappingRows: TokenMappingRow[] = [];
  const tokenChunks = chunkArray(heldTokenIds, QUERY_CHUNK_SIZE);
  const mappedTokenIds = new Set<string>();

  // First pass: Query pm_token_to_condition_map_v5
  for (const chunk of tokenChunks) {
    const tokenMappingQuery = `
      WITH patch_deduped AS (
        SELECT
          token_id_dec,
          any(condition_id) as condition_id,
          any(outcome_index) as outcome_index
        FROM pm_token_to_condition_patch
        GROUP BY token_id_dec
      )
      SELECT
        ids.token_id_dec as token_id_dec,
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
      WHERE COALESCE(NULLIF(g.condition_id, ''), p.condition_id) != ''
    `;

    const tokenMappingResult = await clickhouse.query({
      query: tokenMappingQuery,
      query_params: { tokenIds: chunk },
      format: 'JSONEachRow',
    });

    const rows = (await tokenMappingResult.json()) as TokenMappingRow[];
    tokenMappingRows.push(...rows);
    rows.forEach((r) => mappedTokenIds.add(r.token_id_dec));
  }

  // Find unmapped token_ids and try pm_market_metadata
  const unmappedTokenIds = heldTokenIds.filter((id) => !mappedTokenIds.has(id));
  if (unmappedTokenIds.length > 0) {
    // Query pm_market_metadata and find which markets have these token_ids
    const unmappedChunks = chunkArray(unmappedTokenIds, QUERY_CHUNK_SIZE);
    for (const chunk of unmappedChunks) {
      const metadataQuery = `
        SELECT condition_id, token_ids
        FROM pm_market_metadata
        WHERE length(token_ids) > 0
          AND hasAny(token_ids, {tokenIds:Array(String)})
      `;

      const metadataResult = await clickhouse.query({
        query: metadataQuery,
        query_params: { tokenIds: chunk },
        format: 'JSONEachRow',
      });

      interface MetadataRow {
        condition_id: string;
        token_ids: string[];
      }

      const metadataRows = (await metadataResult.json()) as MetadataRow[];

      // Convert to TokenMappingRow format for matching tokens
      for (const row of metadataRows) {
        for (const tokenId of chunk) {
          const outcomeIndex = row.token_ids.indexOf(tokenId);
          if (outcomeIndex >= 0) {
            tokenMappingRows.push({
              condition_id: row.condition_id,
              token_id_dec: tokenId,
              outcome_index: outcomeIndex,
            });
          }
        }
      }
    }
  }

  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  for (const row of tokenMappingRows) {
    tokenToCondition.set(row.token_id_dec, {
      conditionId: row.condition_id,
      outcomeIndex: row.outcome_index,
    });
  }

  // Step 4: Get all condition_ids that have tokens held
  const conditionIds = [...new Set(tokenMappingRows.map(r => r.condition_id))];
  if (conditionIds.length === 0) return [];

  // Step 5: Load resolutions for these conditions (with chunking)
  interface ResolutionWithTimestamp {
    condition_id: string;
    payout_numerators: string;
    payout_denominator: string;
    resolved_at: string;
  }

  const resolutions = new Map<string, { numerators: bigint[]; denominator: bigint; timestamp: string }>();
  const conditionChunks = chunkArray(conditionIds, QUERY_CHUNK_SIZE);

  for (const chunk of conditionChunks) {
    const resolutionQuery = `
      SELECT condition_id, payout_numerators, payout_denominator, resolved_at
      FROM pm_condition_resolutions
      WHERE condition_id IN ({conditionIds:Array(String)})
        AND is_deleted = 0
    `;

    const resolutionResult = await clickhouse.query({
      query: resolutionQuery,
      query_params: { conditionIds: chunk },
      format: 'JSONEachRow',
    });

    const resolutionRows = (await resolutionResult.json()) as ResolutionWithTimestamp[];

    for (const row of resolutionRows) {
      let numerators: bigint[];
      try {
        const parsed = JSON.parse(row.payout_numerators);
        numerators = parsed.map((n: string | number) => BigInt(n));
      } catch {
        numerators = row.payout_numerators.split(',').map(n => BigInt(n.trim()));
      }

      // Denominator = sum of numerators (as per Polymarket subgraph)
      const denominator = numerators.reduce((acc, n) => acc + n, 0n);

      resolutions.set(row.condition_id, {
        numerators,
        denominator: denominator > 0n ? denominator : 1n,
        timestamp: row.resolved_at || new Date().toISOString(),
      });
    }
  }

  // Step 6: Find tokens already redeemed (from CTF events)
  const redeemedTokens = new Set<string>();
  for (const event of ctfEvents) {
    if (event.eventType === 'REDEMPTION') {
      redeemedTokens.add(event.tokenId.toString());
    }
  }

  // Step 7: Create synthetic redemption events for unredeemed resolved positions
  const syntheticEvents: PolymarketPnlEvent[] = [];

  for (const [tokenId, amount] of heldAmounts.entries()) {
    if (amount <= 0n) continue;
    // In economic parity mode ('all'), we synthesize for all resolved positions
    // regardless of whether a redemption event exists.
    if (mode !== 'all' && redeemedTokens.has(tokenId)) continue; // Already redeemed

    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) continue; // No mapping found

    const resolution = resolutions.get(mapping.conditionId);
    if (!resolution) continue; // Market not resolved

    // Calculate payout price for this outcome
    const numerator = resolution.numerators[mapping.outcomeIndex] || 0n;
    const payoutPrice = resolution.denominator > 0n
      ? (numerator * COLLATERAL_SCALE) / resolution.denominator
      : 0n;

    if (mode === 'losers_only' && payoutPrice > 0n) {
      // Default UI parity mode: skip unredeemed winners (treat as unrealized)
      continue;
    }

    // At this point payoutPrice == 0n, so this is a LOSING token
    // Create synthetic redemption event
    syntheticEvents.push({
      wallet: wallet.toLowerCase(),
      tokenId: BigInt(tokenId),
      eventType: 'REDEMPTION',
      price: payoutPrice,
      amount,
      blockNumber: 0n, // Synthetic event, no real block
      logIndex: 999n, // High log index to sort after real events
      txHash: `synthetic-${tokenId.substring(0, 16)}`,
      timestamp: resolution.timestamp,
      payoutPrice,
    });
  }

  return syntheticEvents;
}

/**
 * Gap statistics from loading events
 * Tracks events skipped due to missing token mappings
 */
export interface LoaderGapStats {
  /** Number of CTF events skipped due to no token mapping */
  unmapped_event_count: number;
  /** Number of unique condition_ids without token mapping */
  unmapped_condition_count: number;
  /** Total USDC value of skipped events (absolute) */
  skipped_usdc_abs: number;
  /** Total token amount of skipped events (absolute) */
  skipped_token_abs: number;
  /** Sample of skipped condition_ids (up to 5) */
  skipped_conditions_sample: string[];
}

/**
 * Result from loading PnL events
 */
export interface LoadPnlEventsResult {
  events: PolymarketPnlEvent[];
  gapStats: LoaderGapStats;
}

/**
 * Options for loading PnL events
 */
export interface LoadPnlEventsOptions {
  /**
   * Whether to synthesize redemption events for resolved positions
   * that weren't explicitly redeemed.
   *
   * When TRUE: Treats resolved-but-unredeemed positions as realized PnL
   * at the payout price. Use for UI parity experiments.
   *
   * When FALSE (default): Only counts actual redemption events.
   * This matches Dome API realized PnL behavior.
   *
   * A/B test result: synthetic OFF gives 70.5% vs 29.5% pass rate on Dome.
   */
  includeSyntheticRedemptions?: boolean;

  /**
   * Synthetic redemption mode:
   * - 'losers_only' (default): UI parity behavior (winners unrealized)
   * - 'all': Economic parity (realize all resolved outcomes)
   */
  syntheticRedemptionMode?: SyntheticRedemptionMode;

  /**
   * Whether to include ERC1155 token transfers between wallets.
   *
   * When TRUE: Includes TRANSFER_IN and TRANSFER_OUT events from
   * pm_erc1155_transfers. This fills data gaps where tokens were
   * received via transfer rather than CLOB trade or CTF split.
   *
   * When FALSE (default): Only uses CLOB + CTF event sources.
   * This matches the original engine behavior.
   *
   * Enable this to reduce "capped sells" where users sell tokens
   * that we don't have buy records for.
   */
  includeErc1155Transfers?: boolean;

  /**
   * Whether to load PositionSplit/PositionsMerge via tx_hash correlation
   * to the wallet's CLOB trades. This captures split cost emitted under
   * the Exchange contract, not attributed to user_address.
   *
   * When TRUE: CTF splits/merges are loaded by tx_hash; redemptions still
   * come from user_address.
   */
  includeTxHashSplits?: boolean;

  /**
   * Whether to allocate tx_hash PositionSplit collateral cost to net-positive
   * token deltas and apply as synthetic cost adjustments (no token mint).
   */
  includeTxHashSplitCostAdjustments?: boolean;

  /**
   * Whether to log a summary line for mapping gaps.
   * When TRUE: Prints one line per wallet load with gap stats.
   * When FALSE (default): Silent operation.
   */
  logGapSummary?: boolean;
}

/**
 * Load all PnL events for a wallet
 *
 * Combines CLOB trades, CTF events, optionally ERC1155 transfers, and
 * optionally synthetic redemptions for resolved markets.
 * Sorted by timestamp for correct event ordering.
 *
 * @param wallet - Wallet address
 * @param options - Options for loading events
 * @returns LoadPnlEventsResult with events and gap stats
 */
export async function loadPolymarketPnlEventsForWallet(
  wallet: string,
  options: LoadPnlEventsOptions = {}
): Promise<LoadPnlEventsResult> {
  const {
    includeSyntheticRedemptions = false, // Default OFF for Dome parity (A/B tested)
    syntheticRedemptionMode = 'losers_only',
    includeErc1155Transfers = false,
    includeTxHashSplits = false,
    includeTxHashSplitCostAdjustments = false,
    logGapSummary = false,
  } = options;

  // Load CLOB trades and CTF events (CTF now returns gap stats)
  const clobPromise = loadClobTrades(wallet);
  const ctfPromise = includeTxHashSplits
    ? Promise.all([
        loadCtfEvents(wallet, ['PayoutRedemption']),
        loadCtfEventsByTxHash(wallet, ['PositionSplit', 'PositionsMerge']),
      ])
    : Promise.all([loadCtfEvents(wallet)]);

  const splitCostPromise = includeTxHashSplitCostAdjustments
    ? loadSplitCostAdjustmentsByTxHash(wallet)
    : Promise.resolve([]);

  const [clobEvents, ctfResults, splitCostEvents] = await Promise.all([
    clobPromise,
    ctfPromise,
    splitCostPromise,
  ]);

  const ctfResult =
    ctfResults.length === 1
      ? ctfResults[0]
      : {
          events: [...ctfResults[0].events, ...ctfResults[1].events],
          gapStats: {
            unmappedEventCount:
              ctfResults[0].gapStats.unmappedEventCount +
              ctfResults[1].gapStats.unmappedEventCount,
            unmappedConditionIds: new Set<string>([
              ...ctfResults[0].gapStats.unmappedConditionIds,
              ...ctfResults[1].gapStats.unmappedConditionIds,
            ]),
            skippedUsdcAbs:
              ctfResults[0].gapStats.skippedUsdcAbs +
              ctfResults[1].gapStats.skippedUsdcAbs,
            skippedTokenAbs:
              ctfResults[0].gapStats.skippedTokenAbs +
              ctfResults[1].gapStats.skippedTokenAbs,
          },
        };

  const ctfEvents = ctfResult.events;

  // Load ERC1155 transfers if requested
  let transferEvents: PolymarketPnlEvent[] = [];
  if (includeErc1155Transfers) {
    transferEvents = await loadErc1155Transfers(wallet);
  }

  // Combine all events
  const allEvents = [...clobEvents, ...ctfEvents, ...transferEvents, ...splitCostEvents];

  // Optionally synthesize implicit redemptions for resolved positions
  if (includeSyntheticRedemptions) {
    const syntheticRedemptions = await synthesizeImplicitRedemptions(
      wallet,
      allEvents,
      ctfEvents,
      syntheticRedemptionMode
    );
    allEvents.push(...syntheticRedemptions);
  }

  // Sort by timestamp (blockNumber in pm_ctf_events is unreliable)
  // The pm_ctf_events block_number values are inconsistent with pm_trader_events_v3
  // Timestamp sorting is more reliable for cross-table event ordering
  allEvents.sort((a, b) => {
    // Primary sort: by timestamp
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    // Secondary sort: by blockNumber (for events within same second)
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    // Tertiary: by logIndex
    if (a.logIndex !== b.logIndex) {
      return a.logIndex < b.logIndex ? -1 : 1;
    }
    // Final: by txHash
    return a.txHash.localeCompare(b.txHash);
  });

  // Build gap stats from CTF loader result
  const gapStats: LoaderGapStats = {
    unmapped_event_count: ctfResult.gapStats.unmappedEventCount,
    unmapped_condition_count: ctfResult.gapStats.unmappedConditionIds.size,
    skipped_usdc_abs: ctfResult.gapStats.skippedUsdcAbs,
    skipped_token_abs: ctfResult.gapStats.skippedTokenAbs,
    skipped_conditions_sample: Array.from(ctfResult.gapStats.unmappedConditionIds).slice(0, 5),
  };

  // Log summary if requested
  if (logGapSummary && gapStats.unmapped_event_count > 0) {
    const walletShort = wallet.substring(0, 10);
    console.log(
      `mapping_gap [${walletShort}]: events=${gapStats.unmapped_event_count}, ` +
      `conditions=${gapStats.unmapped_condition_count}, ` +
      `skipped_usdc=$${gapStats.skipped_usdc_abs.toFixed(2)}, ` +
      `skipped_tokens=${gapStats.skipped_token_abs.toFixed(2)}`
    );
  }

  return { events: allEvents, gapStats };
}

/**
 * Get event counts by type for a wallet (for debugging)
 */
export async function getEventCountsForWallet(
  wallet: string
): Promise<Record<string, number>> {
  const clobQuery = `
    SELECT
      side,
      count() as cnt
    FROM pm_trader_events_v3
    WHERE trader_wallet = {wallet:String}
     
    GROUP BY side
  `;

  const ctfQuery = `
    SELECT
      event_type,
      count() as cnt
    FROM pm_ctf_events
    WHERE user_address = {wallet:String}
      AND is_deleted = 0
    GROUP BY event_type
  `;

  const [clobResult, ctfResult] = await Promise.all([
    clickhouse.query({
      query: clobQuery,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    }),
    clickhouse.query({
      query: ctfQuery,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    }),
  ]);

  const clobRows = (await clobResult.json()) as Array<{
    side: string;
    cnt: string;
  }>;
  const ctfRows = (await ctfResult.json()) as Array<{
    event_type: string;
    cnt: string;
  }>;

  const counts: Record<string, number> = {};

  for (const row of clobRows) {
    counts[`CLOB_${row.side.toUpperCase()}`] = Number(row.cnt);
  }

  for (const row of ctfRows) {
    counts[row.event_type] = Number(row.cnt);
  }

  return counts;
}

/**
 * Legacy function that returns just events (for backward compatibility)
 *
 * @deprecated Use loadPolymarketPnlEventsForWallet() which returns { events, gapStats }
 */
export async function loadPolymarketPnlEvents(
  wallet: string,
  options: LoadPnlEventsOptions = {}
): Promise<PolymarketPnlEvent[]> {
  const result = await loadPolymarketPnlEventsForWallet(wallet, options);
  return result.events;
}

/**
 * High-level PnL computation using mode presets
 *
 * This is the recommended entry point for computing wallet PnL.
 * Use 'strict' (default) for verified, conservative PnL.
 * Use 'ui_like' for best-effort UI parity.
 *
 * @param wallet - Wallet address
 * @param mode - 'strict' (default) or 'ui_like'
 * @returns LoadPnlEventsOptions configured for the mode
 */
export function getLoaderOptionsForMode(mode: PnlMode = 'strict'): LoadPnlEventsOptions {
  const resolved = resolveEngineOptions({ mode });

  return {
    includeSyntheticRedemptions: true,
    includeErc1155Transfers: resolved.includeTransfers,
  };
}

/**
 * Create an empty gap stats object
 */
export function createEmptyGapStats(): LoaderGapStats {
  return {
    unmapped_event_count: 0,
    unmapped_condition_count: 0,
    skipped_usdc_abs: 0,
    skipped_token_abs: 0,
    skipped_conditions_sample: [],
  };
}
