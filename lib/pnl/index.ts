/**
 * PnL Module
 *
 * Provides PnL calculation engines for Cascadian analytics.
 *
 * Exports:
 * - V3 Activity PnL Engine: Cost-basis realized PnL matching Polymarket UI
 * - Validation Guards: Safety checks before PnL calculations
 * - Data Normalizers: Format standardization utilities
 */

export {
  // Main entry points
  computeWalletActivityPnlV3,
  computeWalletActivityPnlV3Extended,
  computeWalletActivityPnlV3Debug,

  // Core algorithm (for custom use)
  calculateActivityPnL,

  // Data loading functions (for custom pipelines)
  getClobFillsForWallet,
  getRedemptionsForWallet,
  getResolutionsForConditions,

  // Types
  type WalletActivityMetrics,
  type WalletActivityMetricsExtended,
  type WalletActivityMetricsDebug,
  type ActivityEvent,
  type OutcomeState,
  type ResolutionInfo,
} from './uiActivityEngineV3';

// Validation Guards
export {
  validatePnlInputs,
  validateTokenMappings,
  validatePositions,
  validateResolutions,
  checkEventDuplicates,
  guardPnlInputs,
  calculateMappingCoverage,
  formatValidationResult,
  PnlValidationError,
  ValidationErrorCodes,
  ValidationWarningCodes,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  type ValidationStats,
  type TokenMappingInput,
  type PositionInput,
  type TradeEventInput,
  type ResolutionInput,
  type PnlInputData,
} from './validationGuards';

// Re-export normalizers for convenience
export {
  normalizeAddress,
  normalizeTokenId,
  normalizeConditionId,
  normalizeTxHash,
  normalizeSide,
  toUsdc,
  rawToUsdc,
  fromUsdc,
  addressEquals,
  tokenIdEquals,
  conditionIdEquals,
  txHashEquals,
  conditionIdForClobApi,
  tokenIdToHex,
  isValidAddress,
  isValidTxHash,
  isValidConditionId,
  formatAddressShort,
  formatTokenIdShort,
  formatConditionIdShort,
  clickhouseTxHashSql,
  usdcSql,
  tokenAmountSql,
  addressSql,
  normalizeAddresses,
  normalizeTokenIds,
  isBuy,
  isSell,
  type NormalizedSide,
} from '../polymarket/normalizers';
