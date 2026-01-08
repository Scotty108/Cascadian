/**
 * Polymarket Constants
 *
 * Exact copy of values from polymarket-subgraph/common/constants.template.ts
 *
 * These MUST match the subgraph exactly or PnL calculations will be off.
 */

// COLLATERAL_SCALE = BigInt.fromI32(10).pow(6) = 1,000,000
// USDC has 6 decimals, so all prices/amounts are scaled by 10^6
export const COLLATERAL_SCALE = 1_000_000n;

// FIFTY_CENTS = COLLATERAL_SCALE.div(BigInt.fromI32(2)) = 500,000
// Used for SPLIT and MERGE events - both outcomes priced at $0.50
export const FIFTY_CENTS = COLLATERAL_SCALE / 2n;

// Contract addresses (for reference, not used in calculation)
export const USDC_ADDRESS = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'; // Polygon USDC
export const NEG_RISK_WRAPPED_COLLATERAL = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
export const NEG_RISK_ADAPTER = '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296';
export const EXCHANGE = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
export const NEG_RISK_EXCHANGE = '0xc5d563a36ae78145c45a50134d48a1215220f80a';

// Trade types (matching subgraph enum)
export enum TradeType {
  BUY = 0,
  SELL = 1,
}

/**
 * Token ID Format Conversion Helpers
 *
 * Different tables use different token ID formats:
 * - pm_trader_events_v3: decimal string (e.g., "101930576911425...")
 * - pm_erc1155_transfers: hex string (e.g., "0xe15aa97c3ad23d...")
 *
 * The engine uses decimal strings as the canonical format.
 */

/**
 * Convert hex token ID to decimal string
 * @example hexToDecimalTokenId("0xe15aa97c...") -> "101930576911425..."
 */
export function hexToDecimalTokenId(hex: string): string {
  const normalized = hex.startsWith('0x') ? hex : '0x' + hex;
  return BigInt(normalized).toString(10);
}

/**
 * Convert decimal token ID to hex string (with 0x prefix)
 * @example decimalToHexTokenId("101930576911425...") -> "0xe15aa97c..."
 */
export function decimalToHexTokenId(dec: string): string {
  return '0x' + BigInt(dec).toString(16);
}

/**
 * Convert hex value string to bigint (for ERC1155 transfer values)
 * @example hexValueToBigInt("0x19394e50") -> 424018512n
 */
export function hexValueToBigInt(hexValue: string): bigint {
  const normalized = hexValue.startsWith('0x') ? hexValue : '0x' + hexValue;
  return BigInt(normalized);
}
