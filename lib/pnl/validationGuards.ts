/**
 * PnL Validation Guards
 *
 * Safety catches to prevent PnL calculations with incomplete data.
 * Use these functions BEFORE running any PnL engine to ensure data integrity.
 *
 * Key scenarios these guards protect against:
 * 1. Unmapped tokens (can't determine winner/loser)
 * 2. Missing outcome assignments (0 vs 1)
 * 3. Duplicate event IDs in CLOB data
 * 4. Missing resolution data for closed markets
 * 5. Position sign confusion (short vs long)
 *
 * @example
 * import { validateWalletDataForPnl, PnlValidationError } from '@/lib/pnl/validationGuards';
 *
 * const result = await validateWalletDataForPnl(walletAddress);
 * if (!result.isValid) {
 *   console.error('Cannot calculate PnL:', result.errors);
 *   return;
 * }
 */

import { normalizeAddress, normalizeTokenId, normalizeConditionId } from '../polymarket/normalizers';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stats: ValidationStats;
}

export interface ValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationStats {
  totalTokens: number;
  mappedTokens: number;
  unmappedTokens: number;
  resolvedMarkets: number;
  unresolvedMarkets: number;
  duplicateEventIds: number;
}

// Error codes for categorization
export const ValidationErrorCodes = {
  UNMAPPED_TOKENS: 'UNMAPPED_TOKENS',
  MISSING_RESOLUTION: 'MISSING_RESOLUTION',
  DUPLICATE_EVENTS: 'DUPLICATE_EVENTS',
  MISSING_CONDITION_ID: 'MISSING_CONDITION_ID',
  INVALID_POSITION_SIGN: 'INVALID_POSITION_SIGN',
  INCOMPLETE_MAPPING: 'INCOMPLETE_MAPPING',
  MISSING_WINNER_FLAG: 'MISSING_WINNER_FLAG',
} as const;

// Warning codes
export const ValidationWarningCodes = {
  PARTIAL_MAPPING: 'PARTIAL_MAPPING',
  UNRESOLVED_MARKETS: 'UNRESOLVED_MARKETS',
  POTENTIAL_DUPLICATES: 'POTENTIAL_DUPLICATES',
  ZERO_POSITIONS: 'ZERO_POSITIONS',
} as const;

// ============================================================================
// Token Mapping Validation
// ============================================================================

export interface TokenMappingInput {
  tokenId: string;
  conditionId?: string | null;
  outcomeIndex?: number | null;
  winner?: boolean | null;
}

/**
 * Validate that all tokens have required mapping data
 * Returns errors for tokens missing condition_id or outcome_index
 */
export function validateTokenMappings(tokens: TokenMappingInput[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const unmappedTokens: string[] = [];
  const missingOutcome: string[] = [];
  const missingWinner: string[] = [];

  for (const token of tokens) {
    const tokenId = normalizeTokenId(token.tokenId);

    if (!token.conditionId) {
      unmappedTokens.push(tokenId);
    }

    if (token.conditionId && token.outcomeIndex === null && token.outcomeIndex === undefined) {
      missingOutcome.push(tokenId);
    }

    // For resolved markets, winner flag should be set
    if (token.conditionId && token.winner === null && token.winner === undefined) {
      missingWinner.push(tokenId);
    }
  }

  if (unmappedTokens.length > 0) {
    errors.push({
      code: ValidationErrorCodes.UNMAPPED_TOKENS,
      message: `${unmappedTokens.length} tokens have no condition_id mapping`,
      details: {
        count: unmappedTokens.length,
        samples: unmappedTokens.slice(0, 5).map((t) => t.slice(0, 20) + '...'),
      },
    });
  }

  if (missingOutcome.length > 0) {
    errors.push({
      code: ValidationErrorCodes.INCOMPLETE_MAPPING,
      message: `${missingOutcome.length} tokens have condition_id but missing outcome_index`,
      details: {
        count: missingOutcome.length,
        samples: missingOutcome.slice(0, 5).map((t) => t.slice(0, 20) + '...'),
      },
    });
  }

  if (missingWinner.length > 0) {
    warnings.push({
      code: ValidationWarningCodes.UNRESOLVED_MARKETS,
      message: `${missingWinner.length} tokens have no winner flag (may be unresolved)`,
      details: {
        count: missingWinner.length,
      },
    });
  }

  const stats: ValidationStats = {
    totalTokens: tokens.length,
    mappedTokens: tokens.length - unmappedTokens.length,
    unmappedTokens: unmappedTokens.length,
    resolvedMarkets: tokens.filter((t) => t.winner !== null && t.winner !== undefined).length,
    unresolvedMarkets: tokens.filter((t) => t.winner === null || t.winner === undefined).length,
    duplicateEventIds: 0,
  };

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

// ============================================================================
// Position Validation
// ============================================================================

export interface PositionInput {
  tokenId: string;
  position: number; // Net position (can be negative for shorts)
  side?: 'buy' | 'sell';
}

/**
 * Validate position data for consistency
 * Checks for sign confusion, zero positions, and invalid values
 */
export function validatePositions(positions: PositionInput[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const zeroPositions: string[] = [];
  const negativePositions: string[] = [];
  const invalidPositions: string[] = [];

  for (const pos of positions) {
    const tokenId = normalizeTokenId(pos.tokenId);

    if (pos.position === 0) {
      zeroPositions.push(tokenId);
    }

    if (pos.position < 0) {
      negativePositions.push(tokenId);
    }

    if (!Number.isFinite(pos.position) || Number.isNaN(pos.position)) {
      invalidPositions.push(tokenId);
    }
  }

  if (invalidPositions.length > 0) {
    errors.push({
      code: ValidationErrorCodes.INVALID_POSITION_SIGN,
      message: `${invalidPositions.length} positions have invalid values (NaN/Infinity)`,
      details: {
        count: invalidPositions.length,
        samples: invalidPositions.slice(0, 5),
      },
    });
  }

  if (zeroPositions.length > 0) {
    warnings.push({
      code: ValidationWarningCodes.ZERO_POSITIONS,
      message: `${zeroPositions.length} positions are exactly zero (no held value)`,
      details: {
        count: zeroPositions.length,
      },
    });
  }

  if (negativePositions.length > 0) {
    warnings.push({
      code: ValidationWarningCodes.POTENTIAL_DUPLICATES,
      message: `${negativePositions.length} positions are negative (short positions or sold)`,
      details: {
        count: negativePositions.length,
        note: 'Negative positions may indicate sold tokens, not actual short positions',
      },
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats: {
      totalTokens: positions.length,
      mappedTokens: positions.length,
      unmappedTokens: 0,
      resolvedMarkets: 0,
      unresolvedMarkets: 0,
      duplicateEventIds: 0,
    },
  };
}

// ============================================================================
// Event Deduplication Check
// ============================================================================

export interface TradeEventInput {
  eventId: string;
  tokenId?: string;
  side?: string;
  amount?: number;
}

/**
 * Check for duplicate event IDs (common in pm_trader_events_v2)
 * Returns count of duplicates and affected event IDs
 */
export function checkEventDuplicates(events: TradeEventInput[]): {
  hasDuplicates: boolean;
  duplicateCount: number;
  uniqueCount: number;
  duplicateIds: string[];
} {
  const eventIdCounts = new Map<string, number>();

  for (const event of events) {
    const id = event.eventId;
    eventIdCounts.set(id, (eventIdCounts.get(id) || 0) + 1);
  }

  const duplicates: string[] = [];
  let duplicateCount = 0;

  for (const [eventId, count] of eventIdCounts) {
    if (count > 1) {
      duplicates.push(eventId);
      duplicateCount += count - 1; // Extra copies
    }
  }

  return {
    hasDuplicates: duplicates.length > 0,
    duplicateCount,
    uniqueCount: eventIdCounts.size,
    duplicateIds: duplicates.slice(0, 10), // Sample
  };
}

// ============================================================================
// Resolution Validation
// ============================================================================

export interface ResolutionInput {
  conditionId: string;
  resolutionPrice?: number | null;
  winningOutcome?: number | null;
  isResolved?: boolean;
}

/**
 * Validate resolution data for markets
 */
export function validateResolutions(resolutions: ResolutionInput[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const missingResolution: string[] = [];
  const invalidPrice: string[] = [];

  for (const res of resolutions) {
    const conditionId = normalizeConditionId(res.conditionId);

    if (res.isResolved && (res.resolutionPrice === null || res.resolutionPrice === undefined)) {
      missingResolution.push(conditionId);
    }

    if (
      res.resolutionPrice !== null &&
      res.resolutionPrice !== undefined &&
      (res.resolutionPrice < 0 || res.resolutionPrice > 1)
    ) {
      invalidPrice.push(conditionId);
    }
  }

  if (missingResolution.length > 0) {
    errors.push({
      code: ValidationErrorCodes.MISSING_RESOLUTION,
      message: `${missingResolution.length} resolved markets missing resolution price`,
      details: {
        count: missingResolution.length,
        samples: missingResolution.slice(0, 5).map((c) => c.slice(0, 20) + '...'),
      },
    });
  }

  if (invalidPrice.length > 0) {
    warnings.push({
      code: ValidationWarningCodes.PARTIAL_MAPPING,
      message: `${invalidPrice.length} markets have resolution price outside [0, 1]`,
      details: {
        count: invalidPrice.length,
      },
    });
  }

  const resolved = resolutions.filter((r) => r.isResolved).length;

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats: {
      totalTokens: 0,
      mappedTokens: 0,
      unmappedTokens: 0,
      resolvedMarkets: resolved,
      unresolvedMarkets: resolutions.length - resolved,
      duplicateEventIds: 0,
    },
  };
}

// ============================================================================
// Combined Pre-PnL Validation
// ============================================================================

export interface PnlInputData {
  walletAddress: string;
  tokens?: TokenMappingInput[];
  positions?: PositionInput[];
  events?: TradeEventInput[];
  resolutions?: ResolutionInput[];
}

/**
 * Comprehensive validation before running PnL calculation
 * Combines all checks into a single validation result
 */
export function validatePnlInputs(data: PnlInputData): ValidationResult {
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationWarning[] = [];
  const stats: ValidationStats = {
    totalTokens: 0,
    mappedTokens: 0,
    unmappedTokens: 0,
    resolvedMarkets: 0,
    unresolvedMarkets: 0,
    duplicateEventIds: 0,
  };

  // Validate tokens
  if (data.tokens && data.tokens.length > 0) {
    const tokenResult = validateTokenMappings(data.tokens);
    allErrors.push(...tokenResult.errors);
    allWarnings.push(...tokenResult.warnings);
    stats.totalTokens = tokenResult.stats.totalTokens;
    stats.mappedTokens = tokenResult.stats.mappedTokens;
    stats.unmappedTokens = tokenResult.stats.unmappedTokens;
  }

  // Validate positions
  if (data.positions && data.positions.length > 0) {
    const posResult = validatePositions(data.positions);
    allErrors.push(...posResult.errors);
    allWarnings.push(...posResult.warnings);
  }

  // Check for duplicate events
  if (data.events && data.events.length > 0) {
    const dupResult = checkEventDuplicates(data.events);
    if (dupResult.hasDuplicates) {
      allWarnings.push({
        code: ValidationWarningCodes.POTENTIAL_DUPLICATES,
        message: `${dupResult.duplicateCount} duplicate event IDs found (will be deduped)`,
        details: {
          duplicateCount: dupResult.duplicateCount,
          uniqueCount: dupResult.uniqueCount,
          samples: dupResult.duplicateIds.slice(0, 3),
        },
      });
      stats.duplicateEventIds = dupResult.duplicateCount;
    }
  }

  // Validate resolutions
  if (data.resolutions && data.resolutions.length > 0) {
    const resResult = validateResolutions(data.resolutions);
    allErrors.push(...resResult.errors);
    allWarnings.push(...resResult.warnings);
    stats.resolvedMarkets = resResult.stats.resolvedMarkets;
    stats.unresolvedMarkets = resResult.stats.unresolvedMarkets;
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    stats,
  };
}

// ============================================================================
// Guard Functions (throw on invalid)
// ============================================================================

/**
 * Guard function that throws if validation fails
 * Use at the start of PnL calculation functions
 */
export function guardPnlInputs(data: PnlInputData): void {
  const result = validatePnlInputs(data);

  if (!result.isValid) {
    const errorMessages = result.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new PnlValidationError(`PnL validation failed: ${errorMessages}`, result);
  }
}

/**
 * Custom error class for PnL validation failures
 */
export class PnlValidationError extends Error {
  readonly validationResult: ValidationResult;

  constructor(message: string, result: ValidationResult) {
    super(message);
    this.name = 'PnlValidationError';
    this.validationResult = result;
  }
}

// ============================================================================
// Mapping Coverage Check
// ============================================================================

/**
 * Calculate mapping coverage percentage
 * Useful for determining if we should proceed with partial data
 */
export function calculateMappingCoverage(tokens: TokenMappingInput[]): {
  coveragePercent: number;
  mapped: number;
  total: number;
  canProceed: boolean;
  threshold: number;
} {
  const total = tokens.length;
  const mapped = tokens.filter((t) => t.conditionId && t.outcomeIndex !== null).length;
  const coveragePercent = total > 0 ? (mapped / total) * 100 : 0;

  // Require 95% coverage to proceed
  const threshold = 95;
  const canProceed = coveragePercent >= threshold;

  return {
    coveragePercent,
    mapped,
    total,
    canProceed,
    threshold,
  };
}

// ============================================================================
// Utility: Format Validation Result for Logging
// ============================================================================

/**
 * Format validation result for console output
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push(`=== VALIDATION ${result.isValid ? '✅ PASSED' : '❌ FAILED'} ===`);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push('ERRORS:');
    for (const err of result.errors) {
      lines.push(`  ❌ [${err.code}] ${err.message}`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('WARNINGS:');
    for (const warn of result.warnings) {
      lines.push(`  ⚠️  [${warn.code}] ${warn.message}`);
    }
    lines.push('');
  }

  lines.push('STATS:');
  lines.push(`  Total tokens: ${result.stats.totalTokens}`);
  lines.push(`  Mapped: ${result.stats.mappedTokens}`);
  lines.push(`  Unmapped: ${result.stats.unmappedTokens}`);
  lines.push(`  Resolved markets: ${result.stats.resolvedMarkets}`);
  lines.push(`  Unresolved markets: ${result.stats.unresolvedMarkets}`);
  lines.push(`  Duplicate events: ${result.stats.duplicateEventIds}`);

  return lines.join('\n');
}
