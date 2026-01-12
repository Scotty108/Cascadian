/**
 * PnL Engine V44 - Unified Formula for All Cohorts
 *
 * ACCURACY: Works for maker_heavy, taker_heavy, and mixed wallets
 *
 * Key Breakthroughs (Jan 10, 2026):
 * 1. Self-fill collapse: When wallet is both maker+taker in same tx, keep only taker
 * 2. Short position liability: Subtract losses from short positions that win
 *
 * The Unified Formula:
 * PnL = Cash_flow + Long_wins - Short_losses
 *
 * Where:
 * - Cash_flow = Σ(sell_usdc) - Σ(buy_usdc)
 * - Long_wins = Σ(net_tokens) where net_tokens > 0 AND outcome won
 * - Short_losses = Σ(|net_tokens|) where net_tokens < 0 AND outcome won
 *
 * Why This Works:
 * - Canonical fills with self-fill collapse eliminate double-counting
 * - Short liability term handles negative inventory correctly
 * - Same formula works for all cohort types (maker, taker, mixed)
 *
 * Confidence Tiers:
 * - High: No phantom inventory (sell <= buy * 1.01 for both YES and NO)
 * - Low: Has phantom inventory → use API fallback (V7)
 *
 * @author Claude Code
 * @version 44.0.0
 * @created 2026-01-10
 */

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV44 {
  wallet: string;
  realized_pnl: number;
  cash_flow: number;
  long_wins: number;
  short_losses: number;
  position_count: number;
  confidence: 'high' | 'low';
  has_phantom_inventory: boolean;
  warning?: string;
}

/**
 * Build canonical fills with self-fill collapse for a wallet
 * Rule: If tx has both maker+taker for same wallet, keep only taker
 */
async function getCanonicalFills(wallet: string): Promise<any[]> {
  const walletLower = wallet.toLowerCase();

  const query = `
    WITH
      -- Identify self-fill transactions
      self_fill_txs AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${walletLower}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),
      -- Get canonical fills: for self-fills keep taker only, else keep all
      canonical AS (
        SELECT
          t.transaction_hash,
          t.token_id,
          t.side,
          t.usdc_amount,
          t.token_amount,
          t.role
        FROM pm_trader_events_v3 t
        WHERE lower(t.trader_wallet) = '${walletLower}'
          AND (
            t.transaction_hash NOT IN (SELECT transaction_hash FROM self_fill_txs)
            OR t.role = 'taker'
          )
      )
    SELECT
      c.transaction_hash,
      m.condition_id,
      m.outcome_index,
      c.side,
      c.usdc_amount / 1e6 as usdc,
      c.token_amount / 1e6 as tokens
    FROM canonical c
    JOIN pm_token_to_condition_map_v5 m ON c.token_id = m.token_id_dec
    WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as any[];
}

/**
 * Check if wallet has phantom inventory
 * Phantom = selling more tokens than bought (indicates off-CLOB minting)
 */
async function checkPhantomInventory(wallet: string): Promise<boolean> {
  const walletLower = wallet.toLowerCase();

  const query = `
    WITH
      self_fill_txs AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${walletLower}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),
      canonical AS (
        SELECT t.token_id, t.side, t.token_amount
        FROM pm_trader_events_v3 t
        WHERE lower(t.trader_wallet) = '${walletLower}'
          AND (t.transaction_hash NOT IN (SELECT transaction_hash FROM self_fill_txs) OR t.role = 'taker')
      ),
      inventory AS (
        SELECT
          sumIf(c.token_amount, m.outcome_index = 0 AND c.side = 'buy') as yes_bought,
          sumIf(c.token_amount, m.outcome_index = 0 AND c.side = 'sell') as yes_sold,
          sumIf(c.token_amount, m.outcome_index = 1 AND c.side = 'buy') as no_bought,
          sumIf(c.token_amount, m.outcome_index = 1 AND c.side = 'sell') as no_sold
        FROM canonical c
        JOIN pm_token_to_condition_map_v5 m ON c.token_id = m.token_id_dec
        WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
      )
    SELECT
      yes_sold > yes_bought * 1.01 OR no_sold > no_bought * 1.01 as has_phantom
    FROM inventory
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows[0]?.has_phantom === 1;
}

/**
 * Calculate PnL using the unified formula
 * Works for all cohorts: maker_heavy, taker_heavy, mixed
 */
export async function getWalletPnLV44(wallet: string): Promise<PnLResultV44> {
  const walletLower = wallet.toLowerCase();

  // Check phantom inventory first
  const hasPhantom = await checkPhantomInventory(wallet);

  // Main PnL calculation using unified formula
  const query = `
    WITH
      self_fill_txs AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${walletLower}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),
      canonical AS (
        SELECT t.token_id, t.side, t.usdc_amount, t.token_amount
        FROM pm_trader_events_v3 t
        WHERE lower(t.trader_wallet) = '${walletLower}'
          AND (t.transaction_hash NOT IN (SELECT transaction_hash FROM self_fill_txs) OR t.role = 'taker')
      ),
      trades_mapped AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          c.side,
          c.usdc_amount / 1e6 as usdc,
          c.token_amount / 1e6 as tokens
        FROM canonical c
        JOIN pm_token_to_condition_map_v5 m ON c.token_id = m.token_id_dec
        WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
      ),
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
          sum(CASE WHEN side = 'sell' THEN usdc ELSE -usdc END) as cash_flow
        FROM trades_mapped
        GROUP BY condition_id, outcome_index
      ),
      pnl_calc AS (
        SELECT
          p.condition_id,
          p.outcome_index,
          p.net_tokens,
          p.cash_flow,
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as is_winner,
          CASE WHEN p.net_tokens > 0 AND is_winner THEN p.net_tokens ELSE 0 END as long_win,
          CASE WHEN p.net_tokens < 0 AND is_winner THEN -p.net_tokens ELSE 0 END as short_loss
        FROM positions p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
      )
    SELECT
      count() as position_count,
      round(sum(cash_flow), 4) as total_cash_flow,
      round(sum(long_win), 4) as total_long_wins,
      round(sum(short_loss), 4) as total_short_losses,
      round(sum(cash_flow) + sum(long_win) - sum(short_loss), 4) as realized_pnl
    FROM pnl_calc
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const data = rows[0] || {};

  const confidence = hasPhantom ? 'low' : 'high';
  const warning = hasPhantom
    ? 'Wallet has phantom inventory (sells > buys). PnL may be inaccurate. Consider using API fallback.'
    : undefined;

  return {
    wallet: walletLower,
    realized_pnl: Number(data.realized_pnl) || 0,
    cash_flow: Number(data.total_cash_flow) || 0,
    long_wins: Number(data.total_long_wins) || 0,
    short_losses: Number(data.total_short_losses) || 0,
    position_count: Number(data.position_count) || 0,
    confidence,
    has_phantom_inventory: hasPhantom,
    warning,
  };
}

/**
 * Hybrid PnL: Use V44 for high-confidence, API for low-confidence
 */
export async function getWalletPnLHybrid(wallet: string): Promise<PnLResultV44 & { source: 'clob' | 'api' }> {
  const v44Result = await getWalletPnLV44(wallet);

  if (v44Result.confidence === 'high') {
    return { ...v44Result, source: 'clob' };
  }

  // Fall back to API for low-confidence wallets
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/value?user=${wallet.toLowerCase()}`
    );
    if (res.ok) {
      const data = await res.json();
      const apiPnl = Number(data.pnl) || 0;
      return {
        ...v44Result,
        realized_pnl: apiPnl,
        source: 'api',
        warning: 'Used API fallback due to phantom inventory',
      };
    }
  } catch (e) {
    // API failed, return V44 result with warning
  }

  return { ...v44Result, source: 'clob' };
}

export default { getWalletPnLV44, getWalletPnLHybrid };
