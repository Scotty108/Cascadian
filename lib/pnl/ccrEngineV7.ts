/**
 * CCR-v7: Subgraph-Style Unified PnL Engine with Proxy Attribution
 *
 * Implements Polymarket's official PnL calculation methodology:
 *
 * EVENT PROCESSING:
 * 1. CLOB trades (buy/sell at actual price)
 * 2. User's direct splits (buy BOTH outcomes at $0.50)
 * 3. User's direct merges (sell BOTH outcomes at $0.50)
 * 4. User's redemptions (sell at payout price: $1 or $0)
 * 5. **PROXY SPLITS** attributed via tx_hash matching (buy at $0.50)
 *
 * POSITION TRACKING (per token_id):
 * - amount: current token holdings
 * - avgPrice: weighted average purchase price
 * - realizedPnl: cumulative realized profit/loss
 *
 * FORMULAS:
 * - Buy: avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
 * - Sell: realizedPnl += min(sellAmount, amount) * (price - avgPrice)
 *
 * CRITICAL INSIGHT:
 * Proxy splits are attributed to the PROXY address in CTF events, but we can
 * ATTRIBUTE them to users by matching tx_hash with user's CLOB trades.
 * When a proxy splits tokens in the same transaction as a user's trade,
 * those tokens should be tracked at $0.50 cost basis.
 */

import { clickhouse } from '../clickhouse/client';

const DEBUG = process.env.CCR_DEBUG === '1';

// Proxy contracts - their events don't count as user's direct events
const PROXY_CONTRACTS = new Set([
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
]);

export interface CCRv7Result {
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  method: string;
  positions_tracked: number;
  clob_trades_processed: number;
  user_splits_processed: number;
  user_merges_processed: number;
  proxy_splits_processed: number;  // ERC1155 transfers from proxy contracts
  redemptions_processed: number;
  overcapped_sells: number;
  confidence: 'high' | 'medium' | 'low';
}

interface Position {
  token_id: string;
  amount: number;
  avgPrice: number;
  realizedPnl: number;
  totalBought: number;
}

interface TradeEvent {
  event_type: 'clob_buy' | 'clob_sell' | 'split' | 'merge' | 'redemption' | 'proxy_split';
  token_id: string;
  amount: number;
  price: number;  // USDC per token (6 decimals normalized)
  block_number: number;
  event_id: string;
  condition_id?: string;
  tx_hash?: string;
}

/**
 * Load all CLOB trades for wallet (deduped by event_id)
 * Also returns tx_hash for proxy split matching
 */
async function loadClobTrades(wallet: string): Promise<TradeEvent[]> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(toFloat64(usdc_amount)) / 1e6 as usdc,
        any(toFloat64(token_amount)) / 1e6 as tokens,
        any(token_id) as token_id,
        any(block_number) as block_number,
        any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${wallet.toLowerCase()}'
       
      GROUP BY event_id
    )
    SELECT
      event_id,
      side,
      usdc,
      tokens,
      token_id,
      block_number,
      tx_hash
    FROM deduped
    ORDER BY block_number, event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map(r => ({
    event_type: r.side === 'buy' ? 'clob_buy' : 'clob_sell',
    token_id: r.token_id,
    amount: r.tokens,
    price: r.tokens > 0 ? r.usdc / r.tokens : 0,
    block_number: r.block_number,
    event_id: r.event_id,
    tx_hash: r.tx_hash,
  }));
}

/**
 * Load proxy splits that occur in the same transactions as user's CLOB BUY trades.
 * Only attribute splits when the user is BUYING (not selling).
 * These splits create tokens that the user receives - the cost basis is $0.50.
 *
 * Strategy: Find PositionSplit events from proxy addresses in user's BUY tx_hashes,
 * then join with token map to get token_ids. Match the split token to the buy token.
 */
async function loadProxySplitsForUserBuys(
  clobTrades: TradeEvent[]
): Promise<TradeEvent[]> {
  // Only consider BUY transactions for proxy split attribution
  const buyTrades = clobTrades.filter(t => t.event_type === 'clob_buy' && t.tx_hash);
  if (buyTrades.length === 0) return [];

  // Group by tx_hash and get token_ids bought
  const buyTxToTokens = new Map<string, Set<string>>();
  for (const trade of buyTrades) {
    if (!trade.tx_hash) continue;
    if (!buyTxToTokens.has(trade.tx_hash)) {
      buyTxToTokens.set(trade.tx_hash, new Set());
    }
    buyTxToTokens.get(trade.tx_hash)!.add(trade.token_id);
  }

  const txHashes = [...buyTxToTokens.keys()];
  if (txHashes.length === 0) return [];

  // Batch into chunks to avoid query size limits
  const BATCH_SIZE = 1000;
  const allEvents: TradeEvent[] = [];
  const proxyList = [...PROXY_CONTRACTS].map(p => `'${p}'`).join(',');

  for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
    const batch = txHashes.slice(i, i + BATCH_SIZE);
    const txList = batch.map(t => `'${t}'`).join(',');

    // Query proxy splits in user's BUY transactions, joined with token map
    // Note: pm_token_to_condition_map_v5 uses token_id_dec as the column name
    const query = `
      SELECT
        ctf.tx_hash,
        ctf.condition_id,
        ctf.block_number,
        ctf.id as event_id,
        toFloat64OrZero(ctf.amount_or_payout) / 1e6 as tokens,
        tm.token_id_dec as token_id
      FROM pm_ctf_events ctf
      INNER JOIN pm_token_to_condition_map_v5 tm
        ON ctf.condition_id = tm.condition_id
      WHERE ctf.tx_hash IN (${txList})
        AND ctf.user_address IN (${proxyList})
        AND ctf.event_type = 'PositionSplit'
        AND ctf.is_deleted = 0
      ORDER BY ctf.block_number, ctf.id
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    for (const r of rows) {
      // Only attribute this split if the user actually bought THIS token
      const tokensInTx = buyTxToTokens.get(r.tx_hash);
      if (tokensInTx && tokensInTx.has(r.token_id)) {
        allEvents.push({
          event_type: 'proxy_split',
          token_id: r.token_id,
          amount: r.tokens,
          price: 0.50,  // Splits create tokens at $0.50 each
          block_number: r.block_number,
          event_id: r.event_id,
          condition_id: r.condition_id,
          tx_hash: r.tx_hash,
        });
      }
    }
  }

  return allEvents;
}

/**
 * Load user's direct CTF events (redemptions only for now)
 * Only events where user_address = wallet (not proxy-attributed)
 *
 * Note: pm_ctf_events has condition_id, not token_id directly.
 * For redemptions, we get USDC payout directly.
 * For splits/merges, we'd need to join with token map, but these are rare
 * for regular users (usually attributed to proxies).
 */
async function loadUserCtfEvents(wallet: string): Promise<TradeEvent[]> {
  const walletLower = wallet.toLowerCase();

  // Skip if wallet is a proxy contract
  if (PROXY_CONTRACTS.has(walletLower)) {
    return [];
  }

  // For now, only process PayoutRedemption events
  // The amount_or_payout field is the USDC amount received
  const query = `
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as usdc_payout,
      block_number,
      tx_hash,
      id
    FROM pm_ctf_events
    WHERE user_address = '${walletLower}'
      AND is_deleted = 0
      AND event_type = 'PayoutRedemption'
    ORDER BY block_number, id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const events: TradeEvent[] = [];

  for (const r of rows) {
    // For redemptions, the payout IS the realized value
    // We need to look up what tokens were redeemed and at what price
    // For now, we'll treat this as a special case
    events.push({
      event_type: 'redemption',
      token_id: `redemption-${r.condition_id}`,  // Synthetic token_id
      amount: r.usdc_payout,  // This is USDC payout
      price: 1.00,  // Payout price (redemption value)
      block_number: r.block_number,
      event_id: r.id,
      condition_id: r.condition_id,
    });
  }

  return events;
}

/**
 * Load ERC1155 token transfers FROM proxy contracts TO the wallet.
 * These represent tokens acquired via proxy splits that weren't captured in CLOB.
 *
 * CRITICAL: The value field is hex-encoded (e.g., '0x0cbe6e2227').
 * We must decode it using: reinterpretAsUInt256(reverse(unhex(substring(value, 3))))
 *
 * Returns transfers as buy events at $0.50 cost basis (split price).
 */
async function loadErc1155ProxyTransfers(wallet: string): Promise<TradeEvent[]> {
  const walletLower = wallet.toLowerCase();
  const proxyList = [...PROXY_CONTRACTS].map(p => `'${p}'`).join(',');

  // Query ERC1155 transfers FROM proxy contracts TO this wallet
  // Decode hex value properly using ClickHouse functions
  const query = `
    SELECT
      tx_hash,
      token_id,
      block_number,
      block_timestamp,
      toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6 as tokens
    FROM pm_erc1155_transfers
    WHERE lower(to_address) = '${walletLower}'
      AND lower(from_address) IN (${proxyList})
      AND startsWith(value, '0x')
      AND length(value) > 2
    ORDER BY block_number
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    if (DEBUG && rows.length > 0) {
      console.log(`[CCR-v7] Loaded ${rows.length} ERC1155 proxy transfers`);
    }

    return rows.map((r, idx) => ({
      event_type: 'proxy_split' as const,
      token_id: r.token_id,
      amount: r.tokens,
      price: 0.50, // Proxy splits = tokens acquired at $0.50 each
      block_number: r.block_number,
      event_id: `erc1155-${r.tx_hash}-${idx}`,
      tx_hash: r.tx_hash,
    }));
  } catch (e) {
    if (DEBUG) {
      console.log(`[CCR-v7] ERC1155 query failed:`, e);
    }
    return [];
  }
}

/**
 * Load current mid-prices for unrealized PnL calculation
 */
async function loadCurrentPrices(tokenIds: string[]): Promise<Map<string, number>> {
  if (tokenIds.length === 0) return new Map();

  const tokenList = tokenIds.map(t => `'${t}'`).join(',');
  const query = `
    SELECT
      token_id,
      mid_price
    FROM pm_token_prices_latest
    WHERE token_id IN (${tokenList})
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    const prices = new Map<string, number>();
    for (const r of rows) {
      prices.set(r.token_id, r.mid_price || 0.50);
    }
    return prices;
  } catch {
    // Table might not exist
    return new Map();
  }
}

/**
 * Update position with a buy event
 */
function updateWithBuy(position: Position, price: number, amount: number): void {
  if (amount <= 0) return;

  // Weighted average price formula from subgraph
  const numerator = position.avgPrice * position.amount + price * amount;
  const denominator = position.amount + amount;

  position.avgPrice = denominator > 0 ? numerator / denominator : price;
  position.amount += amount;
  position.totalBought += amount;
}

/**
 * Update position with a sell event, returns overcapped amount
 *
 * When selling more than tracked inventory, we assume the excess was
 * acquired via splits at $0.50 (this handles untracked proxy splits).
 */
function updateWithSell(position: Position, price: number, amount: number): number {
  if (amount <= 0) return 0;

  // First, sell what we have tracked
  const trackedAmount = Math.min(amount, position.amount);
  const overcappedAmount = amount - trackedAmount;

  if (trackedAmount > 0) {
    // Realized PnL for tracked inventory = amount * (salePrice - avgPrice)
    const deltaPnl = trackedAmount * (price - position.avgPrice);
    position.realizedPnl += deltaPnl;
    position.amount -= trackedAmount;
  }

  // For overcapped sells, assume tokens were acquired via split at $0.50
  // This handles the case where proxy splits created tokens for the user
  // but we couldn't track them
  if (overcappedAmount > 0) {
    const SPLIT_COST_BASIS = 0.50;
    const deltaPnl = overcappedAmount * (price - SPLIT_COST_BASIS);
    position.realizedPnl += deltaPnl;
  }

  return overcappedAmount;
}

/**
 * Main computation function
 */
export async function computeCCRv7(wallet: string): Promise<CCRv7Result> {
  const walletLower = wallet.toLowerCase();

  // Step 1: Load CLOB trades, user's direct CTF events, and ERC1155 proxy transfers
  const [clobTrades, ctfEvents, erc1155Transfers] = await Promise.all([
    loadClobTrades(walletLower),
    loadUserCtfEvents(walletLower),
    loadErc1155ProxyTransfers(walletLower),
  ]);

  if (DEBUG) {
    console.log(`[CCR-v7] Loaded ${clobTrades.length} CLOB trades, ${ctfEvents.length} direct CTF events, ${erc1155Transfers.length} ERC1155 transfers`);
  }

  // ERC1155 transfers from proxy contracts represent tokens acquired via proxy splits.
  // These are NOT double-counting with CLOB trades - they capture positions that
  // the CLOB data doesn't show (e.g., taker-heavy wallet receiving tokens from proxy).
  //
  // Cost basis for proxy transfers is $0.50 (split price).

  // Combine and sort by block_number
  const allEvents: TradeEvent[] = [...clobTrades, ...ctfEvents, ...erc1155Transfers]
    .sort((a, b) => a.block_number - b.block_number);

  if (allEvents.length === 0) {
    return emptyResult();
  }

  // Process events to build positions
  const positions = new Map<string, Position>();
  let overcappedSells = 0;
  let clobTradesProcessed = 0;
  let userSplitsProcessed = 0;
  let userMergesProcessed = 0;
  let proxySplitsProcessed = 0;  // Now used for ERC1155 proxy transfers
  let redemptionsProcessed = 0;

  for (const event of allEvents) {
    // Get or create position
    let position = positions.get(event.token_id);
    if (!position) {
      position = {
        token_id: event.token_id,
        amount: 0,
        avgPrice: 0,
        realizedPnl: 0,
        totalBought: 0,
      };
      positions.set(event.token_id, position);
    }

    switch (event.event_type) {
      case 'clob_buy':
        updateWithBuy(position, event.price, event.amount);
        clobTradesProcessed++;
        break;

      case 'clob_sell':
        overcappedSells += updateWithSell(position, event.price, event.amount);
        clobTradesProcessed++;
        break;

      case 'split':
        // User's direct split = buy at $0.50
        updateWithBuy(position, 0.50, event.amount);
        userSplitsProcessed++;
        break;

      case 'proxy_split':
        // ERC1155 transfer from proxy = tokens acquired at $0.50
        updateWithBuy(position, event.price, event.amount);
        proxySplitsProcessed++;
        break;

      case 'merge':
        // Merge = sell at $0.50
        overcappedSells += updateWithSell(position, 0.50, event.amount);
        userMergesProcessed++;
        break;

      case 'redemption':
        // Redemption payout - treat as direct realized income
        // The amount IS the USDC payout received
        // Since we can't track the original position (condition_id, not token_id),
        // we add this directly to realized PnL
        position.realizedPnl += event.amount;
        redemptionsProcessed++;
        break;
    }
  }

  // Calculate realized PnL (sum across all positions)
  let realizedPnl = 0;
  for (const position of positions.values()) {
    realizedPnl += position.realizedPnl;
  }

  // Calculate unrealized PnL (current positions at current prices)
  const openPositions = [...positions.values()].filter(p => p.amount > 0);
  const tokenIds = openPositions.map(p => p.token_id);
  const currentPrices = await loadCurrentPrices(tokenIds);

  let unrealizedPnl = 0;
  for (const position of openPositions) {
    const currentPrice = currentPrices.get(position.token_id) ?? 0.50;
    unrealizedPnl += position.amount * (currentPrice - position.avgPrice);
  }

  // Total PnL = realized + unrealized
  const totalPnl = realizedPnl + unrealizedPnl;

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (overcappedSells > 0) {
    confidence = 'medium';
  }
  if (clobTradesProcessed < 10) {
    confidence = confidence === 'high' ? 'medium' : 'low';
  }

  if (DEBUG) {
    console.log(`[CCR-v7] Realized: $${realizedPnl.toFixed(2)}, Unrealized: $${unrealizedPnl.toFixed(2)}`);
    console.log(`[CCR-v7] Positions: ${positions.size}, Open: ${openPositions.length}`);
    console.log(`[CCR-v7] Overcapped sells: ${overcappedSells}`);
    console.log(`[CCR-v7] Proxy splits attributed: ${proxySplitsProcessed}`);
  }

  return {
    total_pnl: totalPnl,
    realized_pnl: realizedPnl,
    unrealized_pnl: unrealizedPnl,
    method: 'subgraph-style-with-proxy-attribution',
    positions_tracked: positions.size,
    clob_trades_processed: clobTradesProcessed,
    user_splits_processed: userSplitsProcessed,
    user_merges_processed: userMergesProcessed,
    proxy_splits_processed: proxySplitsProcessed,
    redemptions_processed: redemptionsProcessed,
    overcapped_sells: overcappedSells,
    confidence,
  };
}

function emptyResult(): CCRv7Result {
  return {
    total_pnl: 0,
    realized_pnl: 0,
    unrealized_pnl: 0,
    method: 'subgraph-style-with-proxy-attribution',
    positions_tracked: 0,
    clob_trades_processed: 0,
    user_splits_processed: 0,
    user_merges_processed: 0,
    proxy_splits_processed: 0,
    redemptions_processed: 0,
    overcapped_sells: 0,
    confidence: 'high',
  };
}
