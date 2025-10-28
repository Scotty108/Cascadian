/**
 * Canonical Category Mapper
 *
 * Maps Polymarket event categories and tags to a small set of canonical buckets
 * for product use (wallet specialization, filtering, reporting).
 *
 * Priority:
 * 1. Use event.category if non-empty
 * 2. Map event.tags to canonical categories
 * 3. Return "Uncategorized" if no match
 */

export interface EventData {
  category?: string | null
  tags?: Array<{ label: string; slug?: string }>
}

export interface CanonicalCategoryResult {
  canonical_category: string
  raw_tags: string[]
  source: 'category_field' | 'tags' | 'none'
}

/**
 * Canonical category buckets (in priority order)
 */
const CATEGORY_MAPPINGS: Array<{
  canonical: string
  keywords: string[]
}> = [
  {
    canonical: 'Politics / Geopolitics',
    keywords: [
      'politics',
      'geopolitics',
      'election',
      'elections',
      'senate',
      'house',
      'biden',
      'trump',
      'ukraine',
      'world',
      'foreign policy',
      'war',
      'congress',
      'president',
      'presidential',
      'governor',
      'mayor',
      'campaign',
      'vote',
      'voting',
      'ballot',
      'democracy',
      'republican',
      'democrat',
      'gop',
      'us-current-affairs',
      'russia',
      'china',
      'taiwan',
      'israel',
      'palestine',
      'putin',
      'xi',
      'nato'
    ]
  },
  {
    canonical: 'Macro / Economy',
    keywords: [
      'macro',
      'economy',
      'economic',
      'inflation',
      'rates',
      'rate',
      'fed',
      'federal reserve',
      'interest rate',
      'cpi',
      'jobs',
      'payrolls',
      'gdp',
      'recession',
      'unemployment',
      'fomc',
      'yield',
      'treasury',
      'bond',
      'fiscal',
      'monetary',
      'currency',
      'dollar',
      'banking',
      'finance'
    ]
  },
  {
    canonical: 'Earnings / Business',
    keywords: [
      'earnings',
      'revenue',
      'stock',
      'guidance',
      'profit',
      'layoffs',
      'amazon',
      'tesla',
      'nvda',
      'nvidia',
      'corporate',
      'ceo',
      'merger',
      'acquisition',
      'ipo',
      'business',
      'company',
      'tech',
      'startup',
      'valuation',
      'market cap',
      'apple',
      'google',
      'microsoft',
      'meta',
      'netflix',
      'uber',
      'airbnb',
      'spacex',
      'twitter',
      'x corp',
      'musk'
    ]
  },
  {
    canonical: 'Crypto / DeFi',
    keywords: [
      'crypto',
      'cryptocurrency',
      'bitcoin',
      'btc',
      'eth',
      'ethereum',
      'solana',
      'sol',
      'token',
      'defi',
      'airdrop',
      'staking',
      'onchain',
      'blockchain',
      'nft',
      'nfts',
      'web3',
      'degen',
      'altcoin',
      'coinbase',
      'binance',
      'ftx',
      'sbf',
      'metamask',
      'uniswap',
      'opensea'
    ]
  },
  {
    canonical: 'Sports',
    keywords: [
      'sports',
      'nba',
      'nfl',
      'mlb',
      'nhl',
      'ufc',
      'mma',
      'soccer',
      'football',
      'tennis',
      'golf',
      'playoffs',
      'finals',
      'championship',
      'super bowl',
      'world series',
      'world cup',
      'olympics',
      'march madness',
      'ncaa',
      'espn',
      'athlete',
      'team',
      'game',
      'match',
      'season',
      'mvp'
    ]
  },
  {
    canonical: 'Pop Culture / Media',
    keywords: [
      'pop-culture',
      'pop culture',
      'celebrity',
      'entertainment',
      'music',
      'tv',
      'television',
      'movie',
      'film',
      'award',
      'awards',
      'taylor swift',
      'kardashian',
      'beyonce',
      'drake',
      'netflix',
      'disney',
      'hbo',
      'oscar',
      'grammy',
      'emmy',
      'golden globe',
      'box office',
      'billboard',
      'streaming',
      'influencer',
      'youtube',
      'tiktok',
      'instagram'
    ]
  },
  {
    canonical: 'Legal / Enforcement',
    keywords: [
      'legal',
      'law',
      'indictment',
      'trial',
      'lawsuit',
      'litigation',
      'supreme court',
      'scotus',
      'doj',
      'justice department',
      'appeal',
      'charges',
      'prosecution',
      'defense',
      'verdict',
      'sentence',
      'conviction',
      'acquittal',
      'judge',
      'jury',
      'court',
      'criminal',
      'civil',
      'sec',
      'ftc',
      'antitrust',
      'regulation',
      'enforcement'
    ]
  },
  {
    canonical: 'Weather / Disaster / Misc Event Risk',
    keywords: [
      'weather',
      'hurricane',
      'storm',
      'tornado',
      'climate',
      'wildfire',
      'fire',
      'heatwave',
      'cold',
      'snow',
      'flood',
      'earthquake',
      'tsunami',
      'catastrophe',
      'disaster',
      'emergency',
      'evacuation',
      'temperature',
      'forecast',
      'meteorology'
    ]
  }
]

/**
 * Get canonical category for an event
 *
 * @param event - Event data with category and/or tags
 * @returns Canonical category, raw tags, and source
 */
export function getCanonicalCategoryForEvent(event: EventData): CanonicalCategoryResult {
  // Extract raw tag labels
  const rawTags = event.tags?.map(t => t.label || t.slug || '').filter(Boolean) || []

  // Priority 1: Use category field if non-empty
  if (event.category && event.category.trim() !== '') {
    return {
      canonical_category: event.category,
      raw_tags: rawTags,
      source: 'category_field'
    }
  }

  // Priority 2: Map tags to canonical categories
  if (rawTags.length > 0) {
    // Normalize tags for matching (lowercase, trim)
    const normalizedTags = rawTags.map(t => t.toLowerCase().trim())

    // Check each canonical category in priority order
    for (const mapping of CATEGORY_MAPPINGS) {
      // Check if any tag matches any keyword for this category
      const hasMatch = normalizedTags.some(tag =>
        mapping.keywords.some(keyword => {
          // Exact match or tag contains keyword
          return tag === keyword || tag.includes(keyword) || keyword.includes(tag)
        })
      )

      if (hasMatch) {
        return {
          canonical_category: mapping.canonical,
          raw_tags: rawTags,
          source: 'tags'
        }
      }
    }
  }

  // No match found
  return {
    canonical_category: 'Uncategorized',
    raw_tags: rawTags,
    source: 'none'
  }
}

/**
 * Batch process multiple events
 */
export function getCanonicalCategoriesForEvents(
  events: EventData[]
): Map<number, CanonicalCategoryResult> {
  const results = new Map<number, CanonicalCategoryResult>()

  for (let i = 0; i < events.length; i++) {
    results.set(i, getCanonicalCategoryForEvent(events[i]))
  }

  return results
}
