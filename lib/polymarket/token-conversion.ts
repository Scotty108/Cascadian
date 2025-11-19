/**
 * Token ID Conversion Utilities
 *
 * Purpose: Convert ERC-1155 token IDs between HEX and DECIMAL formats
 *
 * Background:
 * - Blockchain (erc1155_transfers): HEX format "0x + 64 chars"
 * - CLOB API (gamma_markets.tokens[]): DECIMAL format "77-78 char strings"
 * - Same token, different encoding
 *
 * Conversion Formula (ClickHouse):
 * - HEX → DECIMAL: reinterpretAsUInt256(reverse(unhex(replaceAll(token_id, '0x', ''))))
 * - DECIMAL → HEX: lower(hex(reverse(reinterpretAsFixedString(token_id_decimal))))
 *
 * Why reverse()? ERC-1155 uses big-endian on blockchain, ClickHouse UInt256 is little-endian
 *
 * In TypeScript: We reverse byte order when converting
 */

/**
 * Convert HEX token ID to DECIMAL
 *
 * @param hex - Token ID in hex format (with or without 0x prefix)
 * @returns Token ID in decimal string format
 *
 * @example
 * hexToDecimal('0xde52...b0c1')
 * // Returns: '113043668869578619670...'
 */
export function hexToDecimal(hex: string): string {
  // Remove 0x prefix if present
  const cleanHex = hex.toLowerCase().replace('0x', '');

  // Validate hex format
  if (!/^[0-9a-f]+$/.test(cleanHex)) {
    throw new Error(`Invalid hex format: ${hex}`);
  }

  // Pad to 64 characters (32 bytes) if needed
  const paddedHex = cleanHex.padStart(64, '0');

  // Convert to bytes (big-endian from hex)
  const bytes: number[] = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
  }

  // Reverse byte order (big-endian → little-endian)
  bytes.reverse();

  // Convert reversed bytes to BigInt (now in little-endian order)
  // Read bytes as little-endian: least significant byte first
  let decimal = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    decimal = decimal + (BigInt(bytes[i]) << BigInt(i * 8));
  }

  return decimal.toString();
}

/**
 * Convert DECIMAL token ID to HEX
 *
 * @param decimal - Token ID in decimal string format
 * @returns Token ID in hex format (64 chars, lowercase, no 0x)
 *
 * @example
 * decimalToHex('113043668869578619670...')
 * // Returns: 'de52...b0c1'
 */
export function decimalToHex(decimal: string): string {
  // Validate decimal format
  if (!/^\d+$/.test(decimal)) {
    throw new Error(`Invalid decimal format: ${decimal}`);
  }

  // Convert to BigInt
  let value = BigInt(decimal);

  // Check for negative (shouldn't happen with token IDs)
  if (value < 0) {
    throw new Error(`Negative values not supported: ${decimal}`);
  }

  // Convert to bytes (little-endian format)
  const bytes: number[] = [];
  for (let i = 0; i < 32; i++) {
    bytes.push(Number(value & BigInt(0xFF)));
    value = value >> BigInt(8);
  }

  // Reverse from little-endian to big-endian for hex representation
  bytes.reverse();

  // Convert to hex string
  const hex = bytes
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return hex.toLowerCase();
}

/**
 * Normalize token ID (remove 0x, lowercase)
 *
 * @param tokenId - Token ID in any format
 * @returns Normalized token ID (lowercase, no 0x)
 */
export function normalizeTokenId(tokenId: string): string {
  if (!tokenId || tokenId.length === 0) {
    throw new Error('Token ID cannot be empty');
  }

  const cleaned = tokenId.toLowerCase().replace('0x', '');

  // Validate hex format
  if (!/^[0-9a-f]+$/.test(cleaned)) {
    throw new Error(`Invalid token ID format: ${tokenId}`);
  }

  return cleaned;
}

/**
 * Check if conversion is working correctly (utility for debugging)
 *
 * @param hexInput - Hex token ID
 * @param expectedDecimal - Expected decimal output
 * @returns True if conversion matches expected
 */
export function validateConversion(hexInput: string, expectedDecimal: string): boolean {
  try {
    const converted = hexToDecimal(hexInput);
    return converted === expectedDecimal;
  } catch (error) {
    console.error('Conversion validation failed:', error);
    return false;
  }
}

/**
 * Batch convert hex tokens to decimal
 *
 * @param hexTokens - Array of hex token IDs
 * @returns Array of decimal token IDs
 */
export function batchHexToDecimal(hexTokens: string[]): string[] {
  return hexTokens.map(hexToDecimal);
}

/**
 * Batch convert decimal tokens to hex
 *
 * @param decimalTokens - Array of decimal token IDs
 * @returns Array of hex token IDs
 */
export function batchDecimalToHex(decimalTokens: string[]): string[] {
  return decimalTokens.map(decimalToHex);
}
