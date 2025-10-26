import { GraphQLClient } from 'graphql-request'

// Goldsky public endpoints (no auth required!)
export const GOLDSKY_ENDPOINTS = {
  activity:
    'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn',
  positions:
    'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn',
  pnl: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
  orders:
    'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn',
  openInterest:
    'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/oi-subgraph/0.0.6/gn',
}

// Create GraphQL clients
export const activityClient = new GraphQLClient(GOLDSKY_ENDPOINTS.activity)
export const positionsClient = new GraphQLClient(GOLDSKY_ENDPOINTS.positions)
export const pnlClient = new GraphQLClient(GOLDSKY_ENDPOINTS.pnl)
export const orderbookClient = new GraphQLClient(GOLDSKY_ENDPOINTS.orders)

// GraphQL Queries
// Activity subgraph uses FPMM positions
export const GET_FPMM_POSITIONS = /* GraphQL */ `
  query GetFPMMPositions($fpmmId: String!, $limit: Int!) {
    fixedProductMarketMaker(id: $fpmmId) {
      id
      conditions {
        id
      }
    }
    positions(
      where: { fpmm: $fpmmId }
      first: $limit
      orderBy: valueBought
      orderDirection: desc
    ) {
      id
      user
      fpmm
      tokenId
      valueBought
      valueSold
      netPosition
    }
  }
`

// Positions subgraph uses userBalances
// Note: condition is nested under asset field, and condition is an object reference
export const GET_USER_BALANCES_BY_CONDITION = /* GraphQL */ `
  query GetUserBalancesByCondition($conditionId: String!, $limit: Int!) {
    userBalances(
      where: { asset_: { condition: $conditionId } }
      first: $limit
      orderBy: balance
      orderDirection: desc
    ) {
      id
      user
      asset {
        id
        condition {
          id
        }
        outcomeIndex
      }
      balance
    }
  }
`

// Get net positions (YES - NO)
export const GET_NET_USER_BALANCES = /* GraphQL */ `
  query GetNetUserBalances($conditionId: String!, $limit: Int!) {
    netUserBalances(
      where: { asset_: { condition: $conditionId } }
      first: $limit
      orderBy: netBalance
      orderDirection: desc
    ) {
      id
      user
      asset {
        id
        condition {
          id
        }
        outcomeIndex
      }
      netBalance
    }
  }
`

export const GET_WALLET_POSITIONS_PNL = /* GraphQL */ `
  query GetWalletPositionsPnL($wallet: String!) {
    userPositions(where: { user: $wallet }, first: 1000) {
      id
      user
      tokenId
      amount
      avgPrice
      realizedPnl
      totalBought
    }
  }
`

// TypeScript interfaces
export interface Condition {
  id: string
}

export interface TokenIdCondition {
  id: string // This IS the token ID
  condition: Condition
  outcomeIndex: string
}

export interface UserBalance {
  id: string
  user: string
  asset: TokenIdCondition
  balance: string
}

export interface NetUserBalance {
  id: string
  user: string
  asset: TokenIdCondition
  netBalance: string
}

export interface FPMMPosition {
  id: string
  user: string
  fpmm: string
  tokenId: string
  valueBought: string
  valueSold: string
  netPosition: string
}

// Helper functions
// Fetch user balances by condition ID (for position analysis)
export async function fetchUserBalancesByCondition(
  conditionId: string,
  limit: number = 100
): Promise<UserBalance[]> {
  try {
    const data = await positionsClient.request<{ userBalances: UserBalance[] }>(
      GET_USER_BALANCES_BY_CONDITION,
      {
        conditionId: conditionId.toLowerCase(),
        limit,
      }
    )

    return data.userBalances || []
  } catch (error) {
    console.error(`[Goldsky] Failed to fetch user balances for ${conditionId}:`, error)
    throw error
  }
}

// Fetch net balances (for power law analysis)
export async function fetchNetUserBalances(
  conditionId: string,
  limit: number = 100
): Promise<NetUserBalance[]> {
  try {
    const data = await positionsClient.request<{ netUserBalances: NetUserBalance[] }>(
      GET_NET_USER_BALANCES,
      {
        conditionId: conditionId.toLowerCase(),
        limit,
      }
    )

    return data.netUserBalances || []
  } catch (error) {
    console.error(`[Goldsky] Failed to fetch net balances for ${conditionId}:`, error)
    throw error
  }
}

// Legacy compatibility function
export async function fetchMarketPositions(
  conditionId: string,
  limit: number = 100
): Promise<UserBalance[]> {
  return fetchUserBalancesByCondition(conditionId, limit)
}

export interface UserPositionPnL {
  id: string
  user: string
  tokenId: string
  amount: string
  avgPrice: string
  realizedPnl: string
  totalBought: string
}

export async function fetchWalletPnL(wallet: string) {
  try {
    const data = await pnlClient.request<{ userPositions: UserPositionPnL[] }>(
      GET_WALLET_POSITIONS_PNL,
      {
        wallet: wallet.toLowerCase(),
      }
    )

    if (!data.userPositions || data.userPositions.length === 0) {
      return null
    }

    // Calculate total realized PnL across all positions
    const totalRealizedPnl = data.userPositions.reduce((sum, pos) => {
      return sum + parseFloat(pos.realizedPnl)
    }, 0)

    return {
      wallet: wallet.toLowerCase(),
      positions: data.userPositions,
      totalRealizedPnl,
      positionCount: data.userPositions.length,
    }
  } catch (error) {
    console.error(`[Goldsky] Failed to fetch PnL for ${wallet}:`, error)
    return null
  }
}

// Utility: Get top wallets by balance in a condition
export async function getTopWalletsByCondition(
  conditionId: string,
  topN: number = 20
): Promise<string[]> {
  const balances = await fetchUserBalancesByCondition(conditionId, topN)

  return balances.map((b) => b.user)
}

// Utility: Get top wallets by net position (for market signals)
export async function getTopWalletsByNetPosition(
  conditionId: string,
  topN: number = 20
): Promise<string[]> {
  const netBalances = await fetchNetUserBalances(conditionId, topN)

  return netBalances.map((b) => b.user)
}

// ============================================
// Orderbook Subgraph (Trade History)
// ============================================

export const GET_WALLET_TRADES = /* GraphQL */ `
  query GetWalletTrades($wallet: String!, $limit: Int!, $skip: Int!) {
    orderFilledEvents(
      where: { or: [{ maker: $wallet }, { taker: $wallet }] }
      first: $limit
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      orderHash
      maker
      taker
      makerAssetId
      takerAssetId
      makerAmountFilled
      takerAmountFilled
      fee
      timestamp
      transactionHash
    }
  }
`

export const GET_TOKEN_ID_INFO = /* GraphQL */ `
  query GetTokenIdInfo($tokenId: String!) {
    tokenIdCondition(id: $tokenId) {
      id
      condition {
        id
      }
      outcomeIndex
    }
  }
`

// TypeScript interfaces for orderbook
export interface OrderFilledEvent {
  id: string
  orderHash: string
  maker: string
  taker: string
  makerAssetId: string
  takerAssetId: string
  makerAmountFilled: string
  takerAmountFilled: string
  fee: string
  timestamp: string
  transactionHash: string
}

// Fetch wallet trades from orderbook
export async function fetchWalletTrades(
  wallet: string,
  limit: number = 100,
  skip: number = 0
): Promise<OrderFilledEvent[]> {
  try {
    const data = await orderbookClient.request<{ orderFilledEvents: OrderFilledEvent[] }>(
      GET_WALLET_TRADES,
      {
        wallet: wallet.toLowerCase(),
        limit,
        skip,
      }
    )

    return data.orderFilledEvents || []
  } catch (error) {
    console.error(`[Goldsky] Failed to fetch trades for ${wallet}:`, error)
    throw error
  }
}

// Fetch all trades for a wallet (pagination)
export async function fetchAllWalletTrades(wallet: string): Promise<OrderFilledEvent[]> {
  const allTrades: OrderFilledEvent[] = []
  const batchSize = 1000
  let skip = 0
  let hasMore = true

  while (hasMore) {
    const trades = await fetchWalletTrades(wallet, batchSize, skip)
    allTrades.push(...trades)

    if (trades.length < batchSize) {
      hasMore = false
    } else {
      skip += batchSize
    }
  }

  return allTrades
}

// Resolve token ID to condition and outcome
export async function resolveTokenId(tokenId: string): Promise<TokenIdCondition | null> {
  try {
    const data = await positionsClient.request<{ tokenIdCondition: TokenIdCondition | null }>(
      GET_TOKEN_ID_INFO,
      {
        tokenId,
      }
    )

    return data.tokenIdCondition
  } catch (error) {
    console.error(`[Goldsky] Failed to resolve token ID ${tokenId}:`, error)
    return null
  }
}
