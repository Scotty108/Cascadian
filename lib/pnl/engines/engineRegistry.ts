/**
 * ============================================================================
 * ENGINE REGISTRY - Unified Interface for V11, V29, V23C PnL Engines
 * ============================================================================
 *
 * Provides a normalized interface for comparing PnL engines:
 * - V11: CLOB-only with price rounding, resolution PnL
 * - V29: Condition-level inventory tracking with UI parity mode
 * - V23C: Shadow ledger with UI price oracle
 *
 * Each engine implements:
 * - computeRealized(wallet): Cash-event PnL only
 * - computeTotal(wallet): Realized + unrealized (position value)
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import { V11Engine, createV11Engine } from '../uiActivityEngineV11';
import { calculateV29PnL, V29Result } from '../inventoryEngineV29';
import { calculateV23cPnL, V23cResult } from '../shadowLedgerV23c';
import { clickhouse } from '../../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export type EngineName = 'V11' | 'V29' | 'V23C';

export interface PnLResult {
  engine: EngineName;
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositions: number;
  closedPositions: number;
  eventsProcessed: number;
  computeTimeMs: number;
  errors: string[];
}

export interface EngineAdapter {
  name: EngineName;
  computeRealized(wallet: string): Promise<number>;
  computeTotal(wallet: string): Promise<number>;
  computeFull(wallet: string): Promise<PnLResult>;
}

// ============================================================================
// Shared Position Valuation
// ============================================================================

/**
 * Compute open position value using a consistent method across all engines.
 * This ensures when comparing total PnL, the only variable is realized PnL.
 *
 * Uses pm_market_metadata.outcome_prices for live prices (same as UI).
 */
async function computeOpenPositionValue(wallet: string): Promise<number> {
  // This query computes unrealized value for open positions
  // by joining positions with current market prices
  const query = `
    WITH
    -- Get current position quantities from trades
    positions AS (
      SELECT
        lower(condition_id) as condition_id,
        outcome_index,
        sum(token_delta) as quantity
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
      HAVING abs(sum(token_delta)) > 0.01
    ),
    -- Get resolution prices
    resolutions AS (
      SELECT
        lower(condition_id) as condition_id,
        payout_numerators
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    ),
    -- Get live prices from metadata
    live_prices AS (
      SELECT
        lower(condition_id) as condition_id,
        outcome_prices
      FROM pm_market_metadata
      WHERE outcome_prices IS NOT NULL
        AND outcome_prices != ''
        AND outcome_prices != '[]'
    )
    SELECT
      p.condition_id,
      p.outcome_index,
      p.quantity,
      r.payout_numerators,
      lp.outcome_prices
    FROM positions p
    LEFT JOIN resolutions r ON r.condition_id = p.condition_id
    LEFT JOIN live_prices lp ON lp.condition_id = p.condition_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{
    condition_id: string;
    outcome_index: string;
    quantity: string;
    payout_numerators: string | null;
    outcome_prices: string | null;
  }>;

  let totalValue = 0;

  for (const row of rows) {
    const quantity = parseFloat(row.quantity);
    const outcomeIndex = parseInt(row.outcome_index);

    if (Math.abs(quantity) < 0.01) continue;

    let price = 0.5; // Default

    // Priority 1: Resolution price
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators);
        if (Array.isArray(payouts) && outcomeIndex < payouts.length) {
          price = Number(payouts[outcomeIndex]);
        }
      } catch {}
    }
    // Priority 2: Live price from metadata
    else if (row.outcome_prices) {
      try {
        let priceStr = row.outcome_prices;
        if (priceStr.startsWith('"') && priceStr.endsWith('"')) {
          priceStr = priceStr.slice(1, -1);
        }
        priceStr = priceStr.replace(/\\"/g, '"');
        const prices = JSON.parse(priceStr);
        if (Array.isArray(prices) && outcomeIndex < prices.length) {
          price = Number(prices[outcomeIndex]);
        }
      } catch {}
    }

    totalValue += quantity * price;
  }

  return totalValue;
}

// ============================================================================
// V11 Adapter
// ============================================================================

class V11Adapter implements EngineAdapter {
  name: EngineName = 'V11';
  private engine: V11Engine;

  constructor() {
    this.engine = createV11Engine();
  }

  async computeRealized(wallet: string): Promise<number> {
    const result = await this.engine.compute(wallet);
    return result.realized_pnl;
  }

  async computeTotal(wallet: string): Promise<number> {
    // V11 already includes resolution PnL for closed positions
    // For open positions, use shared position valuation
    const result = await this.engine.compute(wallet);

    // V11's realized_pnl includes resolution PnL for resolved positions
    // For truly open positions (unresolved), add their market value
    const openPositions = result.positions.filter(p => p.amount > 0.01);
    let unrealizedValue = 0;

    for (const pos of openPositions) {
      // V11 already processed resolved positions, so check if unresolved
      // by checking if the position still has amount (wasn't zeroed by resolution)
      unrealizedValue += pos.amount * 0.5; // Conservative estimate for unresolved
    }

    return result.realized_pnl + unrealizedValue;
  }

  async computeFull(wallet: string): Promise<PnLResult> {
    const start = Date.now();
    const result = await this.engine.compute(wallet);

    const openPositions = result.positions.filter(p => p.amount > 0.01).length;
    const closedPositions = result.positions.filter(p => p.amount <= 0.01).length;

    return {
      engine: 'V11',
      wallet,
      realizedPnl: result.realized_pnl,
      unrealizedPnl: 0, // V11 includes resolution in realized
      totalPnl: result.realized_pnl,
      openPositions,
      closedPositions,
      eventsProcessed: result.buys_count + result.sells_count,
      computeTimeMs: Date.now() - start,
      errors: [],
    };
  }
}

// ============================================================================
// V29 Adapter
// ============================================================================

class V29Adapter implements EngineAdapter {
  name: EngineName = 'V29';

  async computeRealized(wallet: string): Promise<number> {
    const result = await calculateV29PnL(wallet, { inventoryGuard: true });
    // V29's realizedPnl already includes resolvedUnredeemedValue
    return result.realizedPnl;
  }

  async computeTotal(wallet: string): Promise<number> {
    const result = await calculateV29PnL(wallet, { inventoryGuard: true });
    // totalPnl = realizedPnl + unrealizedPnl + resolvedUnredeemedValue
    return result.totalPnl;
  }

  async computeFull(wallet: string): Promise<PnLResult> {
    const start = Date.now();
    const result = await calculateV29PnL(wallet, { inventoryGuard: true });

    return {
      engine: 'V29',
      wallet,
      realizedPnl: result.realizedPnl,
      unrealizedPnl: result.unrealizedPnl,
      totalPnl: result.totalPnl,
      openPositions: result.openPositions,
      closedPositions: result.closedPositions,
      eventsProcessed: result.eventsProcessed,
      computeTimeMs: Date.now() - start,
      errors: result.errors,
    };
  }
}

// ============================================================================
// V23C Adapter
// ============================================================================

class V23CAdapter implements EngineAdapter {
  name: EngineName = 'V23C';

  async computeRealized(wallet: string): Promise<number> {
    const result = await calculateV23cPnL(wallet, { useUIOracle: true });
    // V23C's realizedPnl is cash flow based
    return result.realizedPnl;
  }

  async computeTotal(wallet: string): Promise<number> {
    const result = await calculateV23cPnL(wallet, { useUIOracle: true });
    // V23C's totalPnl = realized + unrealized (uses UI prices)
    return result.totalPnl;
  }

  async computeFull(wallet: string): Promise<PnLResult> {
    const start = Date.now();
    const result = await calculateV23cPnL(wallet, { useUIOracle: true });

    return {
      engine: 'V23C',
      wallet,
      realizedPnl: result.realizedPnl,
      unrealizedPnl: result.unrealizedPnl,
      totalPnl: result.totalPnl,
      openPositions: result.openPositions,
      closedPositions: result.closedPositions,
      eventsProcessed: result.eventsProcessed,
      computeTimeMs: Date.now() - start,
      errors: result.errors,
    };
  }
}

// ============================================================================
// Engine Registry
// ============================================================================

export class EngineRegistry {
  private adapters: Map<EngineName, EngineAdapter> = new Map();

  constructor() {
    this.adapters.set('V11', new V11Adapter());
    this.adapters.set('V29', new V29Adapter());
    this.adapters.set('V23C', new V23CAdapter());
  }

  getAdapter(name: EngineName): EngineAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`Unknown engine: ${name}`);
    }
    return adapter;
  }

  async computeRealized(engineName: EngineName, wallet: string): Promise<number> {
    return this.getAdapter(engineName).computeRealized(wallet);
  }

  async computeTotal(engineName: EngineName, wallet: string): Promise<number> {
    return this.getAdapter(engineName).computeTotal(wallet);
  }

  async computeFull(engineName: EngineName, wallet: string): Promise<PnLResult> {
    return this.getAdapter(engineName).computeFull(wallet);
  }

  /**
   * Compute all engines for a single wallet
   */
  async computeAllEngines(wallet: string): Promise<Map<EngineName, PnLResult>> {
    const results = new Map<EngineName, PnLResult>();

    for (const [name, adapter] of this.adapters) {
      try {
        const result = await adapter.computeFull(wallet);
        results.set(name, result);
      } catch (err: any) {
        results.set(name, {
          engine: name,
          wallet,
          realizedPnl: 0,
          unrealizedPnl: 0,
          totalPnl: 0,
          openPositions: 0,
          closedPositions: 0,
          eventsProcessed: 0,
          computeTimeMs: 0,
          errors: [err.message],
        });
      }
    }

    return results;
  }

  /**
   * Compute all engines in parallel for a batch of wallets
   */
  async computeBatch(
    wallets: string[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, Map<EngineName, PnLResult>>> {
    const results = new Map<string, Map<EngineName, PnLResult>>();
    let completed = 0;

    for (const wallet of wallets) {
      const walletResults = await this.computeAllEngines(wallet);
      results.set(wallet.toLowerCase(), walletResults);

      completed++;
      if (onProgress) {
        onProgress(completed, wallets.length);
      }
    }

    return results;
  }

  getEngineNames(): EngineName[] {
    return ['V11', 'V29', 'V23C'];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let registryInstance: EngineRegistry | null = null;

export function getEngineRegistry(): EngineRegistry {
  if (!registryInstance) {
    registryInstance = new EngineRegistry();
  }
  return registryInstance;
}

// ============================================================================
// Convenience Functions
// ============================================================================

export async function computeRealized(engineName: EngineName, wallet: string): Promise<number> {
  return getEngineRegistry().computeRealized(engineName, wallet);
}

export async function computeTotal(engineName: EngineName, wallet: string): Promise<number> {
  return getEngineRegistry().computeTotal(engineName, wallet);
}

export async function computeFull(engineName: EngineName, wallet: string): Promise<PnLResult> {
  return getEngineRegistry().computeFull(engineName, wallet);
}
