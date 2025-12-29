/**
 * Polymarket Data Normalizers
 *
 * Centralized utility functions to handle format inconsistencies across:
 * - Transaction hashes (0x prefix, case)
 * - Wallet addresses (case sensitivity)
 * - Token IDs (decimal vs hex)
 * - Condition IDs (0x prefix, case)
 * - Side fields (BUY/SELL vs buy/sell)
 * - Amount units (raw vs USDC)
 *
 * USAGE: Import and use these functions at data boundaries (queries, API calls)
 * to ensure consistent formats throughout the codebase.
 *
 * @example
 * import { normalizeAddress, normalizeTxHash, toUsdc } from '@/lib/polymarket/normalizers';
 *
 * const wallet = normalizeAddress(rawWallet); // -> '0x925ad88d...'
 * const txHash = normalizeTxHash(rawHash);    // -> '0xabcdef...'
 * const amount = toUsdc(rawAmount);           // -> 136.65
 */

// ============================================================================
// Address Normalization
// ============================================================================

/**
 * Normalize Ethereum address to lowercase with 0x prefix
 * Polygon addresses are case-insensitive, but we standardize to lowercase
 *
 * @example
 * normalizeAddress('0x925AD88D18DBC7BFEFF3B71DB7B96ED4BB572C2E')
 * // -> '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e'
 *
 * normalizeAddress('925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e')
 * // -> '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e'
 */
export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return '';
  const trimmed = address.trim();
  const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  return withPrefix.toLowerCase();
}

/**
 * Check if two addresses are equal (case-insensitive comparison)
 */
export function addressEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

// ============================================================================
// Transaction Hash Normalization
// ============================================================================

/**
 * Normalize transaction hash to lowercase with 0x prefix
 * ClickHouse stores as binary, often retrieved via hex() function
 *
 * @example
 * normalizeTxHash('ABCDEF1234567890...')
 * // -> '0xabcdef1234567890...'
 *
 * normalizeTxHash('0xABCDEF1234567890...')
 * // -> '0xabcdef1234567890...'
 */
export function normalizeTxHash(hash: string | null | undefined): string {
  if (!hash) return '';
  const trimmed = hash.trim();
  const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  return withPrefix.toLowerCase();
}

/**
 * Check if two transaction hashes are equal
 */
export function txHashEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeTxHash(a) === normalizeTxHash(b);
}

/**
 * Convert raw ClickHouse binary to normalized tx hash
 * Use with: lower(concat('0x', hex(transaction_hash))) in SQL
 *
 * @example SQL pattern:
 * SELECT lower(concat('0x', hex(transaction_hash))) as tx_hash FROM ...
 */
export function clickhouseTxHashSql(column: string = 'transaction_hash'): string {
  return `lower(concat('0x', hex(${column})))`;
}

// ============================================================================
// Condition ID Normalization
// ============================================================================

/**
 * Normalize condition ID to lowercase without 0x prefix (64 hex chars)
 * This is the standard format used in ClickHouse tables
 *
 * @example
 * normalizeConditionId('0x3487d414a87c0a7c19221fb63d8ed30c46f9be33f8d36fb47f5d3488f5e6f6dd')
 * // -> '3487d414a87c0a7c19221fb63d8ed30c46f9be33f8d36fb47f5d3488f5e6f6dd'
 */
export function normalizeConditionId(conditionId: string | null | undefined): string {
  if (!conditionId) return '';
  const trimmed = conditionId.trim().toLowerCase();
  return trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
}

/**
 * Format condition ID for CLOB API (with 0x prefix)
 *
 * @example
 * conditionIdForClobApi('3487d414a87c0a7c...')
 * // -> '0x3487d414a87c0a7c...'
 */
export function conditionIdForClobApi(conditionId: string): string {
  const normalized = normalizeConditionId(conditionId);
  return `0x${normalized}`;
}

/**
 * Check if two condition IDs are equal
 */
export function conditionIdEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeConditionId(a) === normalizeConditionId(b);
}

// ============================================================================
// Token ID Normalization
// ============================================================================

/**
 * Normalize token ID to decimal string (canonical format)
 * pm_trader_events_v2 uses decimal strings, ERC1155 tables use hex
 *
 * @example
 * normalizeTokenId('0xe15aa97c3ad23d...')
 * // -> '101930576911425...'
 *
 * normalizeTokenId('101930576911425...')
 * // -> '101930576911425...' (already decimal)
 */
export function normalizeTokenId(tokenId: string | null | undefined): string {
  if (!tokenId) return '';
  const trimmed = tokenId.trim();

  // If it starts with 0x or contains only hex chars a-f, convert from hex
  if (trimmed.startsWith('0x')) {
    return BigInt(trimmed).toString(10);
  }

  // If it's a valid decimal number, return as-is
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // If it looks like hex without prefix, try to convert
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length > 20) {
    try {
      return BigInt('0x' + trimmed).toString(10);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

/**
 * Convert token ID to hex format (for ERC1155 queries)
 */
export function tokenIdToHex(tokenId: string): string {
  const normalized = normalizeTokenId(tokenId);
  return '0x' + BigInt(normalized).toString(16);
}

/**
 * Check if two token IDs are equal (handles hex/decimal mismatch)
 */
export function tokenIdEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeTokenId(a) === normalizeTokenId(b);
}

// ============================================================================
// Side Field Normalization
// ============================================================================

export type NormalizedSide = 'buy' | 'sell';

/**
 * Normalize trade side to lowercase ('buy' or 'sell')
 * Different data sources use different cases
 *
 * @example
 * normalizeSide('BUY')  // -> 'buy'
 * normalizeSide('Sell') // -> 'sell'
 * normalizeSide(0)      // -> 'buy' (TradeType enum)
 * normalizeSide(1)      // -> 'sell' (TradeType enum)
 */
export function normalizeSide(side: string | number | null | undefined): NormalizedSide {
  if (side === null || side === undefined) return 'buy';

  if (typeof side === 'number') {
    return side === 0 ? 'buy' : 'sell';
  }

  const lower = side.toString().toLowerCase().trim();
  return lower === 'sell' || lower === '1' ? 'sell' : 'buy';
}

/**
 * Check if side is a buy
 */
export function isBuy(side: string | number | null | undefined): boolean {
  return normalizeSide(side) === 'buy';
}

/**
 * Check if side is a sell
 */
export function isSell(side: string | number | null | undefined): boolean {
  return normalizeSide(side) === 'sell';
}

// ============================================================================
// Amount / Price Normalization
// ============================================================================

const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS; // 1,000,000

/**
 * Convert raw USDC amount (integer) to human-readable USDC (float)
 * USDC has 6 decimals, so divide by 1e6
 *
 * @example
 * toUsdc(136650000) // -> 136.65
 * toUsdc('136650000') // -> 136.65
 * toUsdc(136650000n) // -> 136.65
 */
export function toUsdc(rawAmount: number | string | bigint | null | undefined): number {
  if (rawAmount === null || rawAmount === undefined) return 0;

  if (typeof rawAmount === 'bigint') {
    return Number(rawAmount) / USDC_SCALE;
  }

  if (typeof rawAmount === 'string') {
    const parsed = parseFloat(rawAmount);
    // If already looks like USDC (small number), return as-is
    if (!isNaN(parsed) && Math.abs(parsed) < 1_000_000) {
      // Heuristic: if < 1M, probably already converted
      // Check if it's an integer that should be converted
      if (Number.isInteger(parsed) && Math.abs(parsed) > 1000) {
        return parsed / USDC_SCALE;
      }
      return parsed;
    }
    return parsed / USDC_SCALE;
  }

  // For numbers, if > 1M assume it's raw and needs conversion
  if (typeof rawAmount === 'number') {
    if (Math.abs(rawAmount) > 1_000_000) {
      return rawAmount / USDC_SCALE;
    }
    // Small numbers are probably already USDC
    return rawAmount;
  }

  return 0;
}

/**
 * Convert USDC to raw amount (multiply by 1e6)
 *
 * @example
 * fromUsdc(136.65) // -> 136650000
 */
export function fromUsdc(usdcAmount: number): number {
  return Math.round(usdcAmount * USDC_SCALE);
}

/**
 * Safely convert to USDC from known raw format
 * Use when you KNOW the input is raw (not already converted)
 *
 * @example
 * rawToUsdc(136650000) // -> 136.65
 */
export function rawToUsdc(rawAmount: number | string | bigint | null | undefined): number {
  if (rawAmount === null || rawAmount === undefined) return 0;

  if (typeof rawAmount === 'bigint') {
    return Number(rawAmount) / USDC_SCALE;
  }

  const num = typeof rawAmount === 'string' ? parseFloat(rawAmount) : rawAmount;
  return num / USDC_SCALE;
}

// ============================================================================
// SQL Helper Functions
// ============================================================================

/**
 * Generate SQL for normalized USDC amount
 * Use in SELECT clauses
 */
export function usdcSql(column: string): string {
  return `toFloat64OrZero(${column}) / 1e6`;
}

/**
 * Generate SQL for normalized token amount
 */
export function tokenAmountSql(column: string): string {
  return `${column} / 1e6`;
}

/**
 * Generate SQL for lowercase address comparison
 */
export function addressSql(column: string): string {
  return `lower(${column})`;
}

// ============================================================================
// Batch Normalization (for arrays)
// ============================================================================

/**
 * Normalize array of addresses
 */
export function normalizeAddresses(addresses: (string | null | undefined)[]): string[] {
  return addresses.map(normalizeAddress).filter(Boolean);
}

/**
 * Normalize array of token IDs
 */
export function normalizeTokenIds(tokenIds: (string | null | undefined)[]): string[] {
  return tokenIds.map(normalizeTokenId).filter(Boolean);
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if string looks like a valid Ethereum address
 */
export function isValidAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeAddress(value);
  return /^0x[a-f0-9]{40}$/.test(normalized);
}

/**
 * Check if string looks like a valid transaction hash
 */
export function isValidTxHash(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeTxHash(value);
  return /^0x[a-f0-9]{64}$/.test(normalized);
}

/**
 * Check if string looks like a valid condition ID
 */
export function isValidConditionId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeConditionId(value);
  return /^[a-f0-9]{64}$/.test(normalized);
}

// ============================================================================
// Debug Helpers
// ============================================================================

/**
 * Format address for display (truncated)
 */
export function formatAddressShort(address: string | null | undefined): string {
  const normalized = normalizeAddress(address);
  if (!normalized || normalized.length < 10) return normalized || '';
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

/**
 * Format token ID for display (truncated)
 */
export function formatTokenIdShort(tokenId: string | null | undefined): string {
  const normalized = normalizeTokenId(tokenId);
  if (!normalized || normalized.length < 20) return normalized || '';
  return `${normalized.slice(0, 10)}...${normalized.slice(-4)}`;
}

/**
 * Format condition ID for display (truncated)
 */
export function formatConditionIdShort(conditionId: string | null | undefined): string {
  const normalized = normalizeConditionId(conditionId);
  if (!normalized || normalized.length < 20) return normalized || '';
  return `${normalized.slice(0, 10)}...${normalized.slice(-4)}`;
}
