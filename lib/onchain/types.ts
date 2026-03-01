/**
 * Shared types for on-chain data ingestion
 */

/** Raw log from eth_getLogs RPC response */
export interface RpcLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string // hex
  transactionHash: string
  logIndex: string // hex
  blockHash: string
  removed: boolean
}

/** Row for pm_canonical_fills_v4 (CLOB fills) */
export interface CanonicalFillRow {
  fill_id: string
  event_time: string
  block_number: number
  tx_hash: string
  wallet: string
  condition_id: string
  outcome_index: number
  tokens_delta: number
  usdc_delta: number
  source: string
  is_self_fill: number
  is_maker: number
}

/** Row for pm_ctf_events (CTF split/merge/redemption) */
export interface CTFRow {
  event_type: string
  user_address: string
  collateral_token: string
  parent_collection_id: string
  condition_id: string
  partition_index_sets: string
  amount_or_payout: string
  event_timestamp: string
  block_number: number
  tx_hash: string
  id: string
}

/** Row for pm_neg_risk_conversions_v1 */
export interface NegRiskRow {
  event_type: string
  user_address: string
  market_id: string
  index_set: string
  amount: string
  event_timestamp: string
  block_number: number
  tx_hash: string
  id: string
}

/** Row for pm_condition_resolutions */
export interface ResolutionRow {
  condition_id: string
  payout_numerators: string
  payout_denominator: string
  resolved_at: string
  block_number: number
  tx_hash: string
  is_deleted: number
}

/** Watermark record from pm_ingest_watermarks_v1 */
export interface OnchainWatermark {
  source: string
  last_block_number: number
  last_event_time: string
  rows_processed: number
}

/** Per-source result from a single ingestion run */
export interface SourceResult {
  rows: number
  fromBlock?: number
  toBlock?: number
  error?: string
}
