/**
 * Dimension Table Types
 *
 * Stable interfaces for markets_dim and events_dim from Path B.
 * These are the foundation for category attribution and market metadata.
 */

export interface MarketDimension {
  condition_id: string
  market_id: string
  event_id: string
  resolved_outcome: 0 | 1 | null // 0=NO won, 1=YES won, null=unresolved
  payout_yes: number // 0 or 1
  payout_no: number // 0 or 1
  question: string
}

export interface EventDimension {
  event_id: string
  category: string
  tags: string[]
  title: string
  status: 'active' | 'closed' | 'resolved'
}

export interface WalletMarketActivity {
  wallet_address: string
  condition_id: string
  market_id: string
  event_id: string
  side: 'YES' | 'NO'
  timestamp: Date
  shares: number
}

export interface EventMetadata {
  event_id: string
  category: string
  tags: string[]
  title: string
  status: 'active' | 'closed' | 'resolved'
}
