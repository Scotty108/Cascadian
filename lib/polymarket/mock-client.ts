/**
 * MOCK POLYMARKET API CLIENT
 *
 * Stub implementation for MVP development.
 * Returns realistic mock data without making real API calls.
 *
 * Use this in development/testing. Switch to real client for production.
 */

export interface MockMarket {
  id: string
  condition_id: string
  question: string
  description: string
  category: string
  end_date: string
  volume: number
  liquidity: number
  current_price: number
  yes_price: number
  no_price: number
  yes_shares: number
  no_shares: number
  probability: number
  trending: boolean
  tags: string[]
}

/**
 * Mock market data - Politics category
 */
const MOCK_POLITICS_MARKETS: MockMarket[] = [
  {
    id: 'politics-1',
    condition_id: 'cond-politics-1',
    question: 'Will Democrats win the 2024 election?',
    description: 'This market resolves to YES if Democrats win the presidential election in 2024.',
    category: 'Politics',
    end_date: '2024-11-06T00:00:00Z',
    volume: 2500000,
    liquidity: 750000,
    current_price: 0.52,
    yes_price: 0.52,
    no_price: 0.48,
    yes_shares: 1300000,
    no_shares: 1200000,
    probability: 0.52,
    trending: true,
    tags: ['politics', 'election', 'presidential'],
  },
  {
    id: 'politics-2',
    condition_id: 'cond-politics-2',
    question: 'Will Trump be indicted in 2024?',
    description: 'Market for whether Trump receives criminal indictment in 2024.',
    category: 'Politics',
    end_date: '2024-12-31T23:59:59Z',
    volume: 1800000,
    liquidity: 550000,
    current_price: 0.68,
    yes_price: 0.68,
    no_price: 0.32,
    yes_shares: 1224000,
    no_shares: 576000,
    probability: 0.68,
    trending: true,
    tags: ['politics', 'trump', 'legal'],
  },
  {
    id: 'politics-3',
    condition_id: 'cond-politics-3',
    question: 'Will Biden run for reelection?',
    description: 'Resolves YES if Biden officially announces reelection campaign.',
    category: 'Politics',
    end_date: '2024-06-30T23:59:59Z',
    volume: 950000,
    liquidity: 280000,
    current_price: 0.42,
    yes_price: 0.42,
    no_price: 0.58,
    yes_shares: 399000,
    no_shares: 551000,
    probability: 0.42,
    trending: false,
    tags: ['politics', 'biden', 'election'],
  },
]

/**
 * Mock market data - Crypto category
 */
const MOCK_CRYPTO_MARKETS: MockMarket[] = [
  {
    id: 'crypto-1',
    condition_id: 'cond-crypto-1',
    question: 'Will Bitcoin reach $100k in 2024?',
    description: 'Resolves YES if BTC price reaches $100,000 any time in 2024.',
    category: 'Crypto',
    end_date: '2024-12-31T23:59:59Z',
    volume: 3200000,
    liquidity: 1100000,
    current_price: 0.35,
    yes_price: 0.35,
    no_price: 0.65,
    yes_shares: 1120000,
    no_shares: 2080000,
    probability: 0.35,
    trending: true,
    tags: ['crypto', 'bitcoin', 'price'],
  },
  {
    id: 'crypto-2',
    condition_id: 'cond-crypto-2',
    question: 'Will Ethereum hit $5k in 2024?',
    description: 'Market for ETH reaching $5,000 price point.',
    category: 'Crypto',
    end_date: '2024-12-31T23:59:59Z',
    volume: 1600000,
    liquidity: 480000,
    current_price: 0.28,
    yes_price: 0.28,
    no_price: 0.72,
    yes_shares: 448000,
    no_shares: 1152000,
    probability: 0.28,
    trending: false,
    tags: ['crypto', 'ethereum', 'price'],
  },
]

/**
 * Mock market data - Sports category
 */
const MOCK_SPORTS_MARKETS: MockMarket[] = [
  {
    id: 'sports-1',
    condition_id: 'cond-sports-1',
    question: 'Will Lakers win the NBA championship?',
    description: 'Resolves YES if Lakers win 2024 NBA Finals.',
    category: 'Sports',
    end_date: '2024-06-30T23:59:59Z',
    volume: 850000,
    liquidity: 320000,
    current_price: 0.22,
    yes_price: 0.22,
    no_price: 0.78,
    yes_shares: 187000,
    no_shares: 663000,
    probability: 0.22,
    trending: false,
    tags: ['sports', 'nba', 'lakers'],
  },
  {
    id: 'sports-2',
    condition_id: 'cond-sports-2',
    question: 'Will Mahomes win MVP in 2024?',
    description: 'Patrick Mahomes to win NFL MVP award.',
    category: 'Sports',
    end_date: '2025-02-10T23:59:59Z',
    volume: 620000,
    liquidity: 210000,
    current_price: 0.45,
    yes_price: 0.45,
    no_price: 0.55,
    yes_shares: 279000,
    no_shares: 341000,
    probability: 0.45,
    trending: true,
    tags: ['sports', 'nfl', 'mvp'],
  },
]

/**
 * All mock markets
 */
const ALL_MOCK_MARKETS = [
  ...MOCK_POLITICS_MARKETS,
  ...MOCK_CRYPTO_MARKETS,
  ...MOCK_SPORTS_MARKETS,
]

/**
 * Fetch mock markets with optional filters
 */
export async function fetchMockMarkets(options?: {
  categories?: string[]
  minVolume?: number
  limit?: number
  trending?: boolean
}): Promise<MockMarket[]> {
  // Simulate network delay
  await sleep(300)

  let markets = [...ALL_MOCK_MARKETS]

  // Apply category filter
  if (options?.categories && options.categories.length > 0) {
    markets = markets.filter((m) => options.categories!.includes(m.category))
  }

  // Apply volume filter
  if (options?.minVolume) {
    markets = markets.filter((m) => m.volume >= options.minVolume!)
  }

  // Apply trending filter
  if (options?.trending !== undefined) {
    markets = markets.filter((m) => m.trending === options.trending)
  }

  // Apply limit
  if (options?.limit) {
    markets = markets.slice(0, options.limit)
  }

  return markets
}

/**
 * Fetch single mock market by ID
 */
export async function fetchMockMarket(marketId: string): Promise<MockMarket | null> {
  await sleep(100)
  return ALL_MOCK_MARKETS.find((m) => m.id === marketId) || null
}

/**
 * Simulate placing a buy order (no-op for mock)
 */
export async function placeMockBuyOrder(
  marketId: string,
  outcome: 'Yes' | 'No',
  amount: number
): Promise<{
  success: boolean
  orderId: string
  executedPrice: number
  shares: number
}> {
  await sleep(500)

  const market = ALL_MOCK_MARKETS.find((m) => m.id === marketId)
  if (!market) {
    throw new Error(`Market ${marketId} not found`)
  }

  const price = outcome === 'Yes' ? market.yes_price : market.no_price
  const shares = amount / price

  return {
    success: true,
    orderId: `mock-order-${Date.now()}`,
    executedPrice: price,
    shares,
  }
}

/**
 * Get mock market categories
 */
export function getMockCategories(): string[] {
  return ['Politics', 'Crypto', 'Sports']
}

/**
 * Get mock market statistics
 */
export async function getMockStatistics(): Promise<{
  totalMarkets: number
  totalVolume: number
  totalLiquidity: number
  avgProbability: number
}> {
  await sleep(200)

  const totalVolume = ALL_MOCK_MARKETS.reduce((sum, m) => sum + m.volume, 0)
  const totalLiquidity = ALL_MOCK_MARKETS.reduce((sum, m) => sum + m.liquidity, 0)
  const avgProbability =
    ALL_MOCK_MARKETS.reduce((sum, m) => sum + m.probability, 0) / ALL_MOCK_MARKETS.length

  return {
    totalMarkets: ALL_MOCK_MARKETS.length,
    totalVolume,
    totalLiquidity,
    avgProbability,
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Check if in mock mode (environment variable)
 */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_POLYMARKET === 'true' || process.env.NODE_ENV === 'test'
}

/**
 * Get appropriate client based on environment
 */
export async function getPolymarketClient() {
  if (isMockMode()) {
    return {
      fetchMarkets: fetchMockMarkets,
      fetchMarket: fetchMockMarket,
      placeBuyOrder: placeMockBuyOrder,
      getCategories: getMockCategories,
      getStatistics: getMockStatistics,
    }
  }

  // Import real client dynamically
  const realClient = await import('./client')
  return realClient
}
