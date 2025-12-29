/**
 * Polymarket Data Vocabulary
 *
 * Centralized reference for field name variations across different data sources.
 * Use these constants and helpers to avoid confusion about field names.
 *
 * Common sources of confusion:
 * - wallet vs trader_wallet vs user_address vs from_address
 * - token_id vs token_ID vs asset_id
 * - condition_id vs conditionId vs market_id
 * - side vs trade_type vs BUY/SELL
 * - amount vs usdc_amount vs amount_or_payout
 *
 * @example
 * import { FieldNames, mapFieldName } from '@/lib/polymarket/vocabulary';
 *
 * // Get the correct field name for a specific table
 * const walletField = FieldNames.wallet.pm_trader_events_v2; // 'trader_wallet'
 */

// ============================================================================
// Field Name Mappings by Table
// ============================================================================

/**
 * Canonical field names mapped to their table-specific variations
 */
export const FieldNames = {
  /**
   * Wallet/Address field variations
   *
   * pm_trader_events_v2: trader_wallet
   * pm_ctf_events: user_address
   * pm_erc1155_transfers: from_address / to_address
   * API responses: often just 'wallet' or 'address'
   */
  wallet: {
    canonical: 'wallet',
    pm_trader_events_v2: 'trader_wallet',
    pm_ctf_events: 'user_address',
    pm_erc1155_transfers_from: 'from_address',
    pm_erc1155_transfers_to: 'to_address',
    api: 'wallet',
    subgraph: 'user',
  },

  /**
   * Token ID field variations
   *
   * pm_trader_events_v2: token_id (decimal string)
   * pm_erc1155_transfers: id (hex or decimal depending on query)
   * CLOB API: token_id (decimal string)
   */
  tokenId: {
    canonical: 'token_id',
    pm_trader_events_v2: 'token_id',
    pm_erc1155_transfers: 'id',
    pm_ctf_events: 'token_id',
    clobApi: 'token_id',
    subgraph: 'outcomeTokenId',
  },

  /**
   * Condition ID field variations
   *
   * pm_ctf_events: condition_id (without 0x, lowercase)
   * CLOB API: conditionId (with 0x prefix)
   * Subgraph: condition (entity reference)
   */
  conditionId: {
    canonical: 'condition_id',
    pm_ctf_events: 'condition_id',
    pm_market_metadata_v5: 'condition_id',
    clobApi: 'conditionId',
    subgraph: 'condition',
  },

  /**
   * Trade side field variations
   *
   * pm_trader_events_v2: side ('buy' or 'sell', lowercase)
   * Subgraph: type (0 = BUY, 1 = SELL)
   * Some APIs: 'BUY'/'SELL' (uppercase)
   */
  side: {
    canonical: 'side',
    pm_trader_events_v2: 'side',
    subgraph: 'type',
    values: {
      buy: ['buy', 'BUY', '0', 0],
      sell: ['sell', 'SELL', '1', 1],
    },
  },

  /**
   * USDC amount field variations
   *
   * pm_trader_events_v2: usdc_amount (raw, divide by 1e6)
   * pm_ctf_events: amount_or_payout (raw, divide by 1e6)
   * API responses: often already converted to decimal
   */
  usdcAmount: {
    canonical: 'usdc_amount',
    pm_trader_events_v2: 'usdc_amount',
    pm_ctf_events: 'amount_or_payout',
    clobApi: 'price', // per-token, not total
    note: 'All raw values are scaled by 1e6 (USDC has 6 decimals)',
  },

  /**
   * Token amount field variations
   *
   * pm_trader_events_v2: token_amount (raw, divide by 1e6)
   * pm_erc1155_transfers: value (raw bigint)
   */
  tokenAmount: {
    canonical: 'token_amount',
    pm_trader_events_v2: 'token_amount',
    pm_erc1155_transfers: 'value',
    pm_ctf_events: 'amount_or_payout', // for splits/merges, this is the token count
    note: 'CTF tokens also use 6 decimals (1e6 scale)',
  },

  /**
   * Transaction hash field variations
   *
   * pm_trader_events_v2: transaction_hash (binary, use hex())
   * pm_ctf_events: tx_hash (lowercase with 0x)
   */
  txHash: {
    canonical: 'tx_hash',
    pm_trader_events_v2: 'transaction_hash',
    pm_ctf_events: 'tx_hash',
    pm_erc1155_transfers: 'transaction_hash',
    note: 'pm_trader_events_v2 stores binary; use lower(concat("0x", hex(transaction_hash)))',
  },

  /**
   * Event ID (unique trade identifier)
   *
   * pm_trader_events_v2: event_id (string, unique per fill)
   */
  eventId: {
    canonical: 'event_id',
    pm_trader_events_v2: 'event_id',
    note: 'CRITICAL: Always GROUP BY event_id to handle duplicates',
  },

  /**
   * CTF Event type field
   *
   * pm_ctf_events: event_type
   * Values: 'PositionSplit', 'PositionsMerge', 'PayoutRedemption'
   */
  eventType: {
    canonical: 'event_type',
    pm_ctf_events: 'event_type',
    values: {
      split: 'PositionSplit',
      merge: 'PositionsMerge',
      redeem: 'PayoutRedemption',
    },
  },

  /**
   * Timestamp field variations
   */
  timestamp: {
    canonical: 'timestamp',
    pm_trader_events_v2: 'trade_time',
    pm_ctf_events: 'event_timestamp',
    pm_erc1155_transfers: 'block_timestamp',
  },
} as const;

// ============================================================================
// Table Schema Quick Reference
// ============================================================================

/**
 * Quick reference for table schemas and their key fields
 */
export const TableSchemas = {
  pm_trader_events_v2: {
    description: 'CLOB fills from Polymarket orderbook',
    walletField: 'trader_wallet',
    tokenField: 'token_id',
    amountFields: ['usdc_amount', 'token_amount'],
    sideField: 'side',
    timestampField: 'trade_time',
    uniqueKeyField: 'event_id',
    dedupPattern: 'GROUP BY event_id',
    notes: [
      'Has duplicate rows - ALWAYS dedupe by event_id',
      'Amounts are raw (divide by 1e6)',
      'Side is lowercase: "buy" or "sell"',
    ],
  },

  pm_ctf_events: {
    description: 'CTF contract events (splits, merges, redemptions)',
    walletField: 'user_address',
    conditionField: 'condition_id',
    tokenField: 'token_id',
    amountField: 'amount_or_payout',
    typeField: 'event_type',
    timestampField: 'event_timestamp',
    txHashField: 'tx_hash',
    notes: [
      'user_address may be Exchange contract for splits via CLOB',
      'Use tx_hash join to link CLOB trades to splits',
      'condition_id is 64 hex chars without 0x prefix',
    ],
  },

  pm_erc1155_transfers: {
    description: 'Raw ERC1155 token transfers',
    fromField: 'from_address',
    toField: 'to_address',
    tokenField: 'id',
    amountField: 'value',
    timestampField: 'block_timestamp',
    txHashField: 'transaction_hash',
    notes: [
      'Lower-level than CLOB - shows all token movements',
      'Token ID may be hex or decimal',
      'Includes mints (from=0x0) and burns (to=0x0)',
    ],
  },

  pm_market_metadata_v5: {
    description: 'Market/condition metadata and resolution status',
    conditionField: 'condition_id',
    resolutionFields: ['resolution_source', 'resolution_payout'],
    statusFields: ['is_resolved', 'active', 'closed'],
    notes: ['Source of truth for market resolution status', 'May lag actual resolution'],
  },

  pm_token_to_condition_patch: {
    description: 'Manual token→condition mappings from calibration',
    tokenField: 'token_id',
    conditionField: 'condition_id',
    outcomeField: 'outcome_index',
    notes: ['Created via greedy optimization', 'Persisted mappings for all wallets to use'],
  },
} as const;

// ============================================================================
// SQL Pattern Templates
// ============================================================================

/**
 * Common SQL patterns with correct field names and normalization
 */
export const SqlPatterns = {
  /**
   * Deduped CLOB aggregates for a wallet
   */
  clobDeduped: (wallet: string) => `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet.toLowerCase()}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT * FROM deduped
  `,

  /**
   * Net positions by token for a wallet
   */
  netPositions: (wallet: string) => `
    WITH deduped AS (
      SELECT event_id, any(token_id) as token_id, any(side) as side, any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet.toLowerCase()}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT token_id, sum(if(side = 'buy', tokens, -tokens)) as net_position
    FROM deduped
    GROUP BY token_id
  `,

  /**
   * Redemptions for a wallet (direct user_address match)
   */
  redemptions: (wallet: string) => `
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemption_amount
    FROM pm_ctf_events
    WHERE lower(user_address) = '${wallet.toLowerCase()}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    GROUP BY condition_id
  `,

  /**
   * Splits via tx_hash join (for CLOB trades)
   */
  splitsViaTxHash: (wallet: string) => `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet.toLowerCase()}' AND is_deleted = 0
    )
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_amount
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit' AND is_deleted = 0
    GROUP BY condition_id
  `,

  /**
   * Token to condition mapping lookup
   */
  tokenConditionMap: (tokenIds: string[]) => `
    SELECT token_id, condition_id, outcome_index
    FROM pm_token_to_condition_patch
    WHERE token_id IN (${tokenIds.map((t) => `'${t}'`).join(',')})
  `,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the correct field name for a given table
 */
export function getFieldName(
  canonicalName: keyof typeof FieldNames,
  tableName: string
): string | undefined {
  const mapping = FieldNames[canonicalName] as Record<string, unknown>;
  return mapping[tableName] as string | undefined;
}

/**
 * Get the wallet field name for a specific table
 */
export function getWalletField(tableName: string): string {
  switch (tableName) {
    case 'pm_trader_events_v2':
      return 'trader_wallet';
    case 'pm_ctf_events':
      return 'user_address';
    case 'pm_erc1155_transfers':
      return 'from_address'; // or to_address depending on context
    default:
      return 'wallet';
  }
}

/**
 * Get the token ID field name for a specific table
 */
export function getTokenIdField(tableName: string): string {
  switch (tableName) {
    case 'pm_trader_events_v2':
      return 'token_id';
    case 'pm_erc1155_transfers':
      return 'id';
    case 'pm_ctf_events':
      return 'token_id';
    default:
      return 'token_id';
  }
}

/**
 * Get the amount field name for a specific table
 */
export function getAmountField(tableName: string): string {
  switch (tableName) {
    case 'pm_trader_events_v2':
      return 'usdc_amount';
    case 'pm_ctf_events':
      return 'amount_or_payout';
    case 'pm_erc1155_transfers':
      return 'value';
    default:
      return 'amount';
  }
}

// ============================================================================
// Type Definitions for Row Shapes
// ============================================================================

/**
 * Normalized row shape after processing any source
 * Use this as the target format for all data
 */
export interface NormalizedTradeRow {
  wallet: string; // lowercase with 0x
  tokenId: string; // decimal string
  conditionId?: string; // 64 hex chars, no 0x
  side: 'buy' | 'sell';
  usdcAmount: number; // in USDC (not raw)
  tokenAmount: number; // in tokens (not raw)
  timestamp: Date;
  txHash: string; // lowercase with 0x
  eventId?: string;
}

export interface NormalizedCtfEventRow {
  wallet: string; // lowercase with 0x
  conditionId: string; // 64 hex chars, no 0x
  eventType: 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
  amount: number; // in USDC/tokens (not raw)
  timestamp: Date;
  txHash: string; // lowercase with 0x
}

export interface NormalizedPositionRow {
  tokenId: string; // decimal string
  conditionId?: string; // 64 hex chars, no 0x
  outcomeIndex?: number; // 0 or 1
  netPosition: number; // positive = long, negative = sold
  winner?: boolean | null; // true, false, or null (unresolved)
}
