/**
 * Market Tag Enrichment V3 - API-First Approach
 *
 * Uses Polymarket's native categories and tags as primary source
 * Falls back to keyword matching only when API provides no category
 *
 * Priority order:
 * 1. raw.category or raw.events[0].category (from API)
 * 2. raw.mailchimpTag (from API)
 * 3. raw.events[0].series[0].title (from API - e.g., "NBA", "UFC")
 * 4. Keyword matching (fallback only)
 */

export interface EnrichmentResult {
  originalTags: string[];    // Tags from API
  enrichedTags: string[];    // All tags after enrichment
  addedTags: string[];       // Tags added by enrichment
  category: string;          // Single top-level category
  source: 'api' | 'keyword'; // Where category came from
}

/**
 * Map Polymarket API categories to our normalized categories
 */
const API_CATEGORY_MAP: Record<string, string> = {
  // Politics & Government
  'politics': 'Politics',
  'us-politics': 'Politics',
  'US-current-affairs': 'Politics',
  'us-current-affairs': 'Politics',
  'elections': 'Elections',
  'geopolitics': 'Geopolitics',
  'world': 'World',

  // Sports
  'sports': 'Sports',
  'nfl': 'Sports',
  'nba': 'Sports',
  'mlb': 'Sports',
  'nhl': 'Sports',
  'soccer': 'Sports',
  'mma': 'Sports',
  'ufc': 'Sports',

  // Finance & Economy
  'finance': 'Finance',
  'economy': 'Economy',
  'business': 'Finance',
  'stocks': 'Finance',
  'commodities': 'Finance',
  'earnings': 'Earnings',

  // Crypto
  'crypto': 'Crypto',
  'cryptocurrency': 'Crypto',
  'bitcoin': 'Crypto',
  'ethereum': 'Crypto',

  // Tech
  'technology': 'Tech',
  'tech': 'Tech',
  'ai': 'Tech',
  'science': 'Tech',

  // Culture & Entertainment
  'culture': 'Culture',
  'entertainment': 'Culture',
  'pop-culture': 'Culture',
  'gaming': 'Culture',
  'esports': 'Culture',

  // Other
  'other': 'Other',
  '': 'Other',
};

/**
 * Enrich market using API-first approach
 *
 * @param question Market question (used for fallback keyword matching)
 * @param existingTags Tags already extracted from API (category, series, etc.)
 * @param apiCategory Category from raw.category or raw.events[0].category
 * @returns Enrichment result with tags and category
 */
export function enrichMarketTags(
  question: string,
  existingTags: string[] = [],
  apiCategory: string = ''
): EnrichmentResult {
  const allTags = new Set<string>(existingTags);
  let category = 'Other';
  let source: 'api' | 'keyword' = 'api';

  // Normalize API category
  const normalizedApiCategory = (apiCategory || '').toLowerCase().trim();

  // PRIMARY: Use API category if available
  if (normalizedApiCategory && API_CATEGORY_MAP[normalizedApiCategory]) {
    category = API_CATEGORY_MAP[normalizedApiCategory];

    // Add the category as a tag too
    allTags.add(category);

    // Add normalized version of API category as a tag
    if (apiCategory && apiCategory.length > 0) {
      allTags.add(apiCategory);
    }
  } else {
    // FALLBACK: No API category, so category remains 'Other'
    // We keep existingTags (which includes series titles like NBA, UFC, etc.)
    // but don't do aggressive keyword matching
    source = 'keyword';
  }

  const enrichedTags = Array.from(allTags).sort();
  const addedTags = enrichedTags.filter(tag => !existingTags.includes(tag));

  return {
    originalTags: existingTags,
    enrichedTags,
    addedTags,
    category,
    source,
  };
}
