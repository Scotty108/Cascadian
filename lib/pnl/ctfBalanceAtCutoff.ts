/**
 * ============================================================================
 * CTF Balance at Cutoff
 * ============================================================================
 *
 * Compute accurate token balances for a wallet by combining:
 * 1. CLOB trades (buy = +tokens, sell = -tokens)
 * 2. ERC1155 transfers (inbound = +tokens, outbound = -tokens)
 * 3. CTF redemptions (burn tokens to receive collateral)
 *
 * This allows us to understand if V17's final_shares (CLOB-only) differs
 * from the actual token balance that includes transfers.
 */

import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface TokenBalance {
  token_id: string;
  condition_id: string;
  outcome_index: number;
  // Balance components
  clob_buys: number;
  clob_sells: number;
  erc1155_inbound: number;
  erc1155_outbound: number;
  ctf_redemptions: number;
  // Computed balances
  clob_only_balance: number; // What V17 uses
  full_balance: number; // Including transfers
  balance_delta: number; // full - clob_only
}

export interface WalletBalanceSummary {
  wallet: string;
  cutoff: Date | null;
  token_balances: TokenBalance[];
  // Aggregates
  total_clob_only_balance: number;
  total_full_balance: number;
  total_balance_delta: number;
  tokens_with_delta: number;
}

// ============================================================================
// CLOB Balance Component
// ============================================================================

interface ClobBalance {
  token_id: string;
  buys: number;
  sells: number;
}

async function getClobBalances(wallet: string, cutoff: Date | null): Promise<Map<string, ClobBalance>> {
  const cutoffClause = cutoff ? `AND trade_time <= toDateTime('${cutoff.toISOString()}', 'UTC')` : '';

  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = lower('${wallet}')
        ${cutoffClause}
      GROUP BY event_id
    )
    SELECT
      token_id,
      sum(CASE WHEN side = 'buy' THEN abs(tokens) ELSE 0 END) as buys,
      sum(CASE WHEN side = 'sell' THEN abs(tokens) ELSE 0 END) as sells
    FROM deduped
    GROUP BY token_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const map = new Map<string, ClobBalance>();
  for (const r of rows) {
    map.set(r.token_id, {
      token_id: r.token_id,
      buys: Number(r.buys),
      sells: Number(r.sells),
    });
  }

  return map;
}

// ============================================================================
// ERC1155 Transfer Component
// ============================================================================

interface Erc1155Balance {
  token_id: string;
  inbound: number;
  outbound: number;
}

// Helper to convert hex token_id to decimal string
function hexToDecimal(hexStr: string): string {
  // Remove 0x prefix if present
  const cleanHex = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
  try {
    return BigInt('0x' + cleanHex).toString();
  } catch {
    return hexStr; // Return as-is if conversion fails
  }
}

async function getErc1155Balances(wallet: string, cutoff: Date | null): Promise<Map<string, Erc1155Balance>> {
  const cutoffClause = cutoff ? `AND block_timestamp <= toDateTime('${cutoff.toISOString()}', 'UTC')` : '';

  // Use ClickHouse hex conversion for value field (0x... format)
  // reinterpretAsUInt256(reverse(unhex(substring(value, 3)))) converts hex string to uint
  const query = `
    SELECT
      token_id,
      sumIf(
        toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6,
        lower(to_address) = lower('${wallet}')
      ) as inbound,
      sumIf(
        toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6,
        lower(from_address) = lower('${wallet}')
      ) as outbound
    FROM pm_erc1155_transfers
    WHERE (lower(from_address) = lower('${wallet}') OR lower(to_address) = lower('${wallet}'))
      AND is_deleted = 0
      ${cutoffClause}
    GROUP BY token_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const map = new Map<string, Erc1155Balance>();
  for (const r of rows) {
    // Convert hex token_id to decimal to match CLOB format
    const decimalTokenId = hexToDecimal(r.token_id);
    map.set(decimalTokenId, {
      token_id: decimalTokenId,
      inbound: Number(r.inbound) || 0,
      outbound: Number(r.outbound) || 0,
    });
  }

  return map;
}

// ============================================================================
// CTF Redemption Component
// ============================================================================

interface CtfRedemption {
  condition_id: string;
  tokens_burned: number;
}

async function getCtfRedemptions(wallet: string, cutoff: Date | null): Promise<Map<string, number>> {
  const cutoffClause = cutoff ? `AND event_timestamp <= toDateTime('${cutoff.toISOString()}', 'UTC')` : '';

  // PayoutRedemption burns tokens to get collateral
  // amount_or_payout is the collateral received, not tokens burned
  // We need to understand the token burn amount differently
  const query = `
    SELECT
      condition_id,
      sum(toFloat64OrNull(amount_or_payout) / 1e6) as payout_received
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
      ${cutoffClause}
    GROUP BY condition_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // For redemptions, we'll track by condition_id
  // The payout_received equals tokens_burned for winning outcomes (resolution_price = 1)
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.condition_id.toLowerCase(), Number(r.payout_received) || 0);
  }

  return map;
}

// ============================================================================
// Token Mapping
// ============================================================================

interface TokenMapping {
  token_id: string;
  condition_id: string;
  outcome_index: number;
}

async function getTokenMappings(tokenIds: string[]): Promise<Map<string, TokenMapping>> {
  if (tokenIds.length === 0) return new Map();

  const tokenIdList = tokenIds.map((t) => `'${t}'`).join(',');

  const query = `
    SELECT token_id_dec as token_id, condition_id, outcome_index
    FROM pm_token_to_condition_map_v3
    WHERE token_id_dec IN (${tokenIdList})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const map = new Map<string, TokenMapping>();
  for (const r of rows) {
    map.set(r.token_id, {
      token_id: r.token_id,
      condition_id: r.condition_id.toLowerCase(),
      outcome_index: Number(r.outcome_index),
    });
  }

  return map;
}

// ============================================================================
// Main Function
// ============================================================================

export async function computeWalletBalances(
  wallet: string,
  cutoff: Date | null = null
): Promise<WalletBalanceSummary> {
  // Load all components in parallel
  const [clobBalances, erc1155Balances, ctfRedemptions] = await Promise.all([
    getClobBalances(wallet, cutoff),
    getErc1155Balances(wallet, cutoff),
    getCtfRedemptions(wallet, cutoff),
  ]);

  // Collect all unique token IDs
  const allTokenIds = new Set<string>();
  for (const tokenId of clobBalances.keys()) allTokenIds.add(tokenId);
  for (const tokenId of erc1155Balances.keys()) allTokenIds.add(tokenId);

  // Get token mappings
  const tokenMappings = await getTokenMappings(Array.from(allTokenIds));

  // Build token balances
  const tokenBalances: TokenBalance[] = [];
  let total_clob_only = 0;
  let total_full = 0;
  let tokens_with_delta = 0;

  for (const tokenId of allTokenIds) {
    const mapping = tokenMappings.get(tokenId);
    if (!mapping) continue; // Skip unmapped tokens

    const clob = clobBalances.get(tokenId) || { buys: 0, sells: 0 };
    const erc1155 = erc1155Balances.get(tokenId) || { inbound: 0, outbound: 0 };

    // For redemptions, we only know by condition_id, not token_id
    // A redemption burns all winning tokens for a condition
    // This is a simplification - in reality we'd need to know which outcome was redeemed
    const redemption = ctfRedemptions.get(mapping.condition_id) || 0;

    const clob_only_balance = clob.buys - clob.sells;

    // Full balance includes ERC1155 transfers
    // Note: redemptions reduce token balance, but they're tracked separately
    // ERC1155 transfers might overlap with CLOB trades (CLOB = operator-mediated transfers)
    // We need to be careful about double-counting
    const erc1155_net = erc1155.inbound - erc1155.outbound;

    // Key insight: CLOB trades ARE ERC1155 transfers (the exchange is the operator)
    // So we shouldn't add them - the ERC1155 transfers already include CLOB activity
    // We want to identify NON-CLOB transfers
    // This is complex because we can't easily distinguish CLOB vs direct transfers

    // For now, let's compute both ways and see the delta
    const full_balance = erc1155_net; // ERC1155 should be comprehensive
    const balance_delta = full_balance - clob_only_balance;

    tokenBalances.push({
      token_id: tokenId,
      condition_id: mapping.condition_id,
      outcome_index: mapping.outcome_index,
      clob_buys: clob.buys,
      clob_sells: clob.sells,
      erc1155_inbound: erc1155.inbound,
      erc1155_outbound: erc1155.outbound,
      ctf_redemptions: redemption,
      clob_only_balance,
      full_balance,
      balance_delta,
    });

    total_clob_only += clob_only_balance;
    total_full += full_balance;
    if (Math.abs(balance_delta) > 0.01) tokens_with_delta++;
  }

  return {
    wallet,
    cutoff,
    token_balances: tokenBalances.sort((a, b) => Math.abs(b.balance_delta) - Math.abs(a.balance_delta)),
    total_clob_only_balance: total_clob_only,
    total_full_balance: total_full,
    total_balance_delta: total_full - total_clob_only,
    tokens_with_delta,
  };
}
