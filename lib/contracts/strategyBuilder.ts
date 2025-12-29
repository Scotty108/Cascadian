/**
 * Strategy Builder Contracts
 *
 * Central source of truth for all Strategy Builder node I/O types,
 * API request/response shapes, and cross-terminal contracts.
 *
 * Terminal 1 (PnL/Tier A) and Terminal 2 (Strategy Builder) both use these.
 */

// ============================================================================
// Market Types
// ============================================================================

export type MarketStatus = "open" | "closed" | "resolved" | "suspended";

export interface MarketFilterInput {
  // Market identity filters
  conditionIds?: string[];
  marketIds?: string[];
  eventSlugs?: string[];

  // Classification
  categories?: string[];     // e.g. ["politics", "sports"]
  tags?: string[];           // free form, matched against Dome tags

  // Liquidity and activity
  minVolumeUsd?: number;
  maxVolumeUsd?: number;
  minNumTrades?: number;

  // Price related filters
  minYesPrice?: number;
  maxYesPrice?: number;
  minNoPrice?: number;
  maxNoPrice?: number;

  // Time filters (ISO strings)
  startTimeGte?: string;
  startTimeLte?: string;
  endTimeGte?: string;
  endTimeLte?: string;

  // Status
  statuses?: MarketStatus[];

  // Pagination
  limit?: number;
  offset?: number;
}

export interface MarketSummary {
  marketId: string;
  conditionId: string;
  eventSlug?: string;
  eventTitle?: string;
  title: string;
  status: MarketStatus;
  category?: string;
  tags?: string[];
  yesPrice?: number | null;
  noPrice?: number | null;
  volumeUsd?: number | null;
  numTrades?: number | null;
  startTime?: string | null;
  endTime?: string | null;
}

export interface MarketSearchResponse {
  filters: MarketFilterInput;
  total: number;
  markets: MarketSummary[];
  source: "dome";
}

// ============================================================================
// Candle Types
// ============================================================================

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface Candle {
  t: string;   // ISO time
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
}

export interface MarketCandlesRequest {
  marketId?: string;
  conditionId?: string;
  interval: CandleInterval;
  startTime?: string;
  endTime?: string;
  limit?: number;
}

export interface MarketCandlesResponse {
  marketId?: string;
  conditionId?: string;
  interval: CandleInterval;
  candles: Candle[];
  source: "dome";
}

// ============================================================================
// Market Price Types
// ============================================================================

export interface MarketPriceRequest {
  marketId?: string;
  conditionId?: string;
}

export interface MarketPriceResponse {
  marketId?: string;
  conditionId?: string;
  yesPrice: number | null;
  noPrice: number | null;
  lastTradedAt?: string | null;
  source: "dome";
}

// ============================================================================
// Trade Types
// ============================================================================

export interface TradeSample {
  tradeId: string;
  timestamp: string;
  side: "buy" | "sell";
  outcome: string; // "yes" or "no" or outcome index label
  price: number;
  size: number;
  notionalUsd?: number;
}

export interface MarketTradesRequest {
  marketId?: string;
  conditionId?: string;
  limit?: number;
  offset?: number;
}

export interface MarketTradesResponse {
  marketId?: string;
  conditionId?: string;
  trades: TradeSample[];
  source: "dome";
}

// ============================================================================
// Wallet Cohort Types
// ============================================================================

export type WalletCohortSource = "internal_clickhouse" | "tier_a_manifest" | "mock";

export interface WalletCohortFilter {
  percentileTopByRealizedPnl?: number; // e.g. 1 for top 1 percent
  minRealizedPnlUsd?: number;
  minTradeCount?: number;
  clobOnly?: boolean;
  allPositionsClosed?: boolean;

  // Omega related filters (V1 disabled)
  omegaEnabled?: boolean; // ignore for now
  minOmega?: number;      // ignore for now
}

export interface WalletCohortWallet {
  walletAddress: string;
  realizedPnlUsd: number;
  tradeCount: number;
  marketCount: number;
  clobOnly: boolean;
  allPositionsClosed: boolean;
  firstTradeAt?: string | null;
  lastTradeAt?: string | null;

  // Omega placeholders
  omegaReady: boolean;
  omegaScore?: number | null;
  omegaInputsMissing?: string[];
}

export interface WalletCohortResponse {
  filters: WalletCohortFilter;
  total: number;
  wallets: WalletCohortWallet[];
  source: WalletCohortSource;
  notes?: string;
}

// ============================================================================
// Copy Trade Watcher Types
// ============================================================================

export interface CopyTradeWatchRequest {
  wallets: string[];
}

export interface CopyTradeEvent {
  walletAddress: string;
  timestamp: string;
  marketId: string;
  conditionId: string;
  eventSlug?: string;
  side: "buy" | "sell";
  outcome: string;
  price: number;
  size: number;
  notionalUsd?: number;
}

export interface CopyTradeWatchSnapshot {
  walletAddress: string;
  lastTradeAt?: string | null;
  lastMarketId?: string | null;
  lastEventSlug?: string | null;
}

export interface CopyTradeWatchResponse {
  snapshot: CopyTradeWatchSnapshot[];
  recentEvents: CopyTradeEvent[];
  source: "internal" | "dome_ws" | "mock";
}

// ============================================================================
// Projection Types
// ============================================================================

export interface MarketProjectionRequest {
  marketId?: string;
  conditionId?: string;
  interval: CandleInterval;
  lookbackCandles: number;
}

export interface MarketProjectionStats {
  slope: number;                // price trend
  volatility: number;           // simple stddev
  recentRange: { min: number; max: number };
  sampleSize: number;
}

export interface MarketProjectionResponse {
  marketId?: string;
  conditionId?: string;
  interval: CandleInterval;
  stats: MarketProjectionStats;
  experimental: true;
}

// ============================================================================
// Manual Copy Trade Types
// ============================================================================

export type ConsensusMode =
  | "any"          // 1-of-N
  | "two_agree"    // 2-of-N
  | "n_of_m"       // configurable N
  | "all";

export interface ManualCopyTradeConfig {
  walletsCsv: string;

  consensusMode: ConsensusMode;
  nRequired?: number;          // used if consensusMode = "n_of_m"

  // Optional safety filters
  minSourceNotionalUsd?: number;
  maxCopyPerTradeUsd?: number; // enforced by adapter even in dry-run

  // Behavior flags
  dryRun: boolean;             // default true
  enableLogging: boolean;      // default true
}

export interface CopyTradeDecision {
  decisionId: string;
  timestamp: string;

  // Source trade
  sourceWallet: string;
  sourceTradeId?: string;
  marketId: string;
  conditionId: string;
  eventSlug?: string;
  side: "buy" | "sell";
  outcome: string;
  price: number;
  size: number;
  notionalUsd?: number;

  // Consensus
  consensusKey: string;
  consensusMode: ConsensusMode;
  matchedWallets: string[];
  matchedCount: number;
  requiredCount: number;

  // Result
  status: "executed" | "simulated" | "skipped" | "filtered" | "error";
  reason?: string;

  // Execution details
  dryRun: boolean;
  txHash?: string | null;
  errorMessage?: string | null;
}

export interface ManualCopyTradeNodeOutput {
  type: "ManualCopyTrade";
  config: ManualCopyTradeConfig;
  lastDecisions: CopyTradeDecision[];
}

// ============================================================================
// Node Output Types (for Strategy Builder graph)
// ============================================================================

export interface MarketFilterNodeOutput {
  type: "MarketFilter";
  filters: MarketFilterInput;
}

export interface MarketUniverseNodeOutput {
  type: "MarketUniverse";
  filters: MarketFilterInput;
  total: number;
  sampleMarkets: MarketSummary[];
}

export interface MarketMonitorNodeOutput {
  type: "MarketMonitor";
  marketId: string;
  conditionId: string;
  latestPrice: MarketPriceResponse;
  recentCandles: MarketCandlesResponse;
}

export interface ProjectionNodeOutput {
  type: "MarketProjection";
  marketId: string;
  conditionId: string;
  projection: MarketProjectionResponse;
}

export interface WalletCohortNodeOutput {
  type: "WalletCohort";
  filters: WalletCohortFilter;
  wallets: WalletCohortWallet[];
}

export interface CopyTradeWatchNodeOutput {
  type: "CopyTradeWatch";
  snapshot: CopyTradeWatchSnapshot[];
  recentEvents: CopyTradeEvent[];
}
