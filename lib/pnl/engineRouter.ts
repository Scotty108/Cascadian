/**
 * ============================================================================
 * PNL ENGINE ROUTER
 * ============================================================================
 *
 * Central router for all PnL engine versions.
 * Allows switching between engines via environment variable or explicit parameter.
 *
 * USAGE:
 *   // Via environment variable
 *   export PNL_ENGINE_VERSION=polymarket_avgcost_v1
 *
 *   // Or explicit in code
 *   import { computePnL } from '@/lib/pnl/engineRouter';
 *   const result = await computePnL(wallet, 'polymarket_avgcost_v1');
 *
 * AVAILABLE ENGINES:
 *   - maker_fifo_v1: Maker-only FIFO (DEPRECATED)
 *   - v19b_v1: V19b unified ledger (DEPRECATED)
 *   - v19b_dedup_v1: V19b with deduplication (DEPRECATED)
 *   - polymarket_avgcost_v1: Polymarket-accurate weighted average (NEW)
 *
 * CREATED: 2025-12-17
 * ============================================================================
 */

import { computePolymarketPnl, WalletPnlResult } from './polymarketAccurateEngine';
import { calculateV19bPnL } from './uiActivityEngineV19b';

// ============================================================================
// Types
// ============================================================================

export type EngineVersion =
  | 'maker_fifo_v1'
  | 'v19b_v1'
  | 'v19b_dedup_v1'
  | 'polymarket_avgcost_v1';

export interface PnLResult {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  engineVersion: EngineVersion;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Default Engine
// ============================================================================

const DEFAULT_ENGINE: EngineVersion = 'polymarket_avgcost_v1';

function getDefaultEngine(): EngineVersion {
  const envEngine = process.env.PNL_ENGINE_VERSION as EngineVersion | undefined;
  if (envEngine && isValidEngine(envEngine)) {
    return envEngine;
  }
  return DEFAULT_ENGINE;
}

function isValidEngine(version: string): version is EngineVersion {
  return [
    'maker_fifo_v1',
    'v19b_v1',
    'v19b_dedup_v1',
    'polymarket_avgcost_v1',
  ].includes(version);
}

// ============================================================================
// Engine Implementations
// ============================================================================

async function computeMakerFifoV1(wallet: string): Promise<PnLResult> {
  // This would call the maker-only FIFO engine
  // For now, throw an error directing users to the batch script
  throw new Error(
    'maker_fifo_v1 engine is implemented in scripts/pnl/fast-compute-priority-wallets.ts. ' +
    'Use that script directly or switch to polymarket_avgcost_v1.'
  );
}

async function computeV19bV1(wallet: string): Promise<PnLResult> {
  const result = await calculateV19bPnL(wallet);
  return {
    wallet: wallet.toLowerCase(),
    realizedPnl: result.realized_pnl,
    unrealizedPnl: result.unrealized_pnl,
    totalPnl: result.total_pnl,
    engineVersion: 'v19b_v1',
    metadata: {
      positions: result.positions,
      resolved: result.resolved,
      syntheticResolved: result.synthetic_resolved,
    },
  };
}

async function computeV19bDedupV1(wallet: string): Promise<PnLResult> {
  // V19b with explicit deduplication
  // This would need a separate implementation with GROUP BY event_id
  // For now, use V19b and note that deduplication should be applied
  console.warn('v19b_dedup_v1: Using v19b_v1 - manual deduplication may be needed');
  return computeV19bV1(wallet);
}

async function computePolymarketAvgCostV1(wallet: string): Promise<PnLResult> {
  const result = await computePolymarketPnl(wallet);
  return {
    wallet: result.wallet,
    realizedPnl: result.realizedPnl,
    unrealizedPnl: result.unrealizedPnl,
    totalPnl: result.totalPnl,
    engineVersion: 'polymarket_avgcost_v1',
    metadata: {
      positionCount: result.positionCount,
      tradeCount: result.tradeCount,
      splitCount: result.splitCount,
      mergeCount: result.mergeCount,
      redemptionCount: result.redemptionCount,
      skippedSells: result.skippedSells,
      clampedTokens: result.clampedTokens,
      autoSettledPnl: result.metadata?.autoSettledPnl,
      transferExposure: result.transferExposure,
      confidence: result.confidence,
    },
  };
}

// ============================================================================
// Main Router
// ============================================================================

/**
 * Compute PnL for a wallet using the specified engine version.
 *
 * @param wallet - Wallet address
 * @param engineVersion - Engine version to use (defaults to PNL_ENGINE_VERSION env var or polymarket_avgcost_v1)
 * @returns PnL result with engine metadata
 */
export async function computePnL(
  wallet: string,
  engineVersion?: EngineVersion
): Promise<PnLResult> {
  const version = engineVersion || getDefaultEngine();

  switch (version) {
    case 'maker_fifo_v1':
      return computeMakerFifoV1(wallet);

    case 'v19b_v1':
      return computeV19bV1(wallet);

    case 'v19b_dedup_v1':
      return computeV19bDedupV1(wallet);

    case 'polymarket_avgcost_v1':
      return computePolymarketAvgCostV1(wallet);

    default:
      throw new Error(`Unknown engine version: ${version}`);
  }
}

/**
 * Get the current default engine version.
 */
export function getCurrentEngine(): EngineVersion {
  return getDefaultEngine();
}

/**
 * List all available engine versions.
 */
export function listEngines(): EngineVersion[] {
  return [
    'maker_fifo_v1',
    'v19b_v1',
    'v19b_dedup_v1',
    'polymarket_avgcost_v1',
  ];
}

/**
 * Get engine description.
 */
export function getEngineDescription(version: EngineVersion): string {
  const descriptions: Record<EngineVersion, string> = {
    maker_fifo_v1: 'Maker-only FIFO cost basis (DEPRECATED - does not match UI)',
    v19b_v1: 'V19b unified ledger with cash flow formula (DEPRECATED)',
    v19b_dedup_v1: 'V19b with event deduplication (DEPRECATED)',
    polymarket_avgcost_v1: 'Polymarket-accurate weighted average cost basis (RECOMMENDED)',
  };
  return descriptions[version];
}
