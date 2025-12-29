/**
 * Market Tag Enrichment V2
 *
 * Comprehensive keyword-based tag enrichment system
 * Uses polymarket-taxonomy.ts for keyword → tags mapping
 *
 * Features:
 * - Scans market question for keywords (case-insensitive by default)
 * - Applies ALL matching tags (can be many)
 * - Determines single category via tag-to-category mapping
 * - Handles META categories (Mentions, Earnings) correctly
 */

import {
  KEYWORD_TO_TAGS,
  TAG_TO_CATEGORY,
  META_CATEGORIES,
  CATEGORY_PRIORITY_DEFAULT,
  CATEGORY_PRIORITY_IF_SPORTS_CONTEXT,
  type KeywordMapping,
} from './polymarket-taxonomy';

export interface EnrichmentResult {
  originalTags: string[];  // Tags from API
  enrichedTags: string[];  // All tags after enrichment
  addedTags: string[];     // Tags added by enrichment
  category: string;        // Single top-level category
  matchedKeywords: string[]; // Debug: which keywords matched
}

/**
 * Enrich market tags based on question content and slug
 *
 * @param question Market question/title
 * @param existingTags Tags already on the market (from API)
 * @param slug Market slug (optional, used for league detection)
 * @returns Enrichment result with tags and category
 */
export function enrichMarketTags(
  question: string,
  existingTags: string[] = [],
  slug: string = ''
): EnrichmentResult {
  const allTags = new Set<string>(existingTags);
  const matchedKeywords: string[] = [];

  // Normalize question and slug for matching
  const normalizedQuestion = question.toLowerCase();
  const normalizedSlug = slug.toLowerCase();

  // CONTEXT DETECTION: Determine if this is a sports market
  // Sports context = slug contains league prefix OR existing tags include league tags OR question contains league names
  const isSportsContext =
    normalizedSlug.includes('nba-') ||
    normalizedSlug.includes('mlb-') ||
    normalizedSlug.includes('nfl-') ||
    normalizedSlug.includes('nhl-') ||
    normalizedSlug.includes('/nba') ||
    normalizedSlug.includes('/mlb') ||
    normalizedSlug.includes('/nfl') ||
    normalizedSlug.includes('/nhl') ||
    normalizedQuestion.includes('nba') ||
    normalizedQuestion.includes('mlb') ||
    normalizedQuestion.includes('nfl') ||
    normalizedQuestion.includes('nhl') ||
    existingTags.some(tag => ['NBA', 'MLB', 'NFL', 'NHL'].includes(tag));

  // SLUG-BASED ENRICHMENT (PRIORITY): Check slug for league indicators
  // This catches markets like "nba-det-atl-2025-11-18" with no team names in question
  if (normalizedSlug.includes('nba-') || normalizedSlug.includes('/nba')) {
    allTags.add('NBA');
    allTags.add('Sports');
    allTags.add('Basketball');
    matchedKeywords.push('nba (slug)');
  }
  if (normalizedSlug.includes('mlb-') || normalizedSlug.includes('/mlb')) {
    allTags.add('MLB');
    allTags.add('Sports');
    allTags.add('Baseball');
    matchedKeywords.push('mlb (slug)');
  }
  if (normalizedSlug.includes('nfl-') || normalizedSlug.includes('/nfl')) {
    allTags.add('NFL');
    allTags.add('Sports');
    allTags.add('Football');
    matchedKeywords.push('nfl (slug)');
  }
  if (normalizedSlug.includes('nhl-') || normalizedSlug.includes('/nhl')) {
    allTags.add('NHL');
    allTags.add('Sports');
    allTags.add('Hockey');
    matchedKeywords.push('nhl (slug)');
  }

  // KEYWORD-BASED ENRICHMENT: Scan question for keyword matches
  for (const mapping of KEYWORD_TO_TAGS) {
    // DOMAIN FILTERING: Skip political and tech keywords when in sports context
    // This prevents:
    // - "vance" in "To Advance" and "mcconnell" in "T.J. McConnell" (politics)
    // - "agi" in "Magic" and "rocket" in "Rockets" (tech)
    if (isSportsContext && (mapping.domain === 'politics' || mapping.domain === 'tech')) {
      continue; // Skip this keyword
    }

    const keyword = mapping.caseSensitive ? mapping.keyword : mapping.keyword.toLowerCase();
    const questionToSearch = mapping.caseSensitive ? question : normalizedQuestion;

    let matched = false;

    if (mapping.wholeWord) {
      // Whole word match (with word boundaries)
      const regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i');
      matched = regex.test(questionToSearch);
    } else {
      // Partial match (default)
      matched = questionToSearch.includes(keyword);
    }

    if (matched) {
      matchedKeywords.push(mapping.keyword);
      // Add all tags from this mapping
      for (const tag of mapping.tags) {
        allTags.add(tag);
      }
    }
  }

  // Convert to array
  const enrichedTags = Array.from(allTags).sort();
  const addedTags = enrichedTags.filter(tag => !existingTags.includes(tag));

  // Determine primary category (with context-aware priority)
  const category = determineCategory(enrichedTags, isSportsContext);

  return {
    originalTags: existingTags,
    enrichedTags,
    addedTags,
    category,
    matchedKeywords,
  };
}

/**
 * Determine single category from tags
 *
 * Logic:
 * 1. Filter out META categories (Mentions, Earnings) from consideration
 * 2. If no non-META categories remain, use highest-priority META category
 * 3. Otherwise, use highest-priority non-META category
 * 4. Use CONTEXT-AWARE priority: Sports > Politics in sports context, Politics > Sports otherwise
 *
 * Examples:
 * - ["Politics", "Mentions"] → "Politics" (not "Mentions")
 * - ["Tech", "Earnings", "Apple"] → "Tech" (not "Earnings")
 * - ["NBA", "JD Vance"] in sports context → "Sports" (Sports wins)
 * - ["NBA", "JD Vance"] in default context → "Politics" (Politics wins)
 * - ["Mentions"] → "Mentions" (only META category)
 */
function determineCategory(tags: string[], isSportsContext: boolean = false): string {
  // Get categories for each tag
  const categories = tags
    .map(tag => TAG_TO_CATEGORY[tag])
    .filter(Boolean); // Remove undefined

  if (categories.length === 0) {
    return 'Other';
  }

  // Split into META and non-META categories
  const metaCategories = categories.filter(cat => META_CATEGORIES.has(cat));
  const nonMetaCategories = categories.filter(cat => !META_CATEGORIES.has(cat));

  // If we have non-META categories, use highest priority one (with context-aware priority)
  if (nonMetaCategories.length > 0) {
    return getHighestPriorityCategory(nonMetaCategories, isSportsContext);
  }

  // Otherwise, use highest priority META category
  if (metaCategories.length > 0) {
    return getHighestPriorityCategory(metaCategories, isSportsContext);
  }

  return 'Other';
}

/**
 * Get highest priority category from list
 * Higher index in priority array = higher priority
 * Uses context-aware priority: Sports > Politics in sports context
 */
function getHighestPriorityCategory(categories: string[], isSportsContext: boolean = false): string {
  let highestPriority = -1;
  let highestCategory = 'Other';

  // Choose priority array based on context
  const priorityArray = isSportsContext
    ? CATEGORY_PRIORITY_IF_SPORTS_CONTEXT
    : CATEGORY_PRIORITY_DEFAULT;

  for (const category of categories) {
    const priority = priorityArray.indexOf(category);
    if (priority > highestPriority) {
      highestPriority = priority;
      highestCategory = category;
    }
  }

  return highestCategory;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Test the enrichment system with example markets
 */
export function testEnrichment() {
  const testCases = [
    {
      question: 'Will Trump win the 2024 election?',
      expected: { category: 'Politics', tags: ['Trump', 'Politics', 'US Politics', 'Elections'] },
    },
    {
      question: 'Will Bitcoin reach $100,000 by EOY?',
      expected: { category: 'Crypto', tags: ['Bitcoin', 'Crypto'] },
    },
    {
      question: 'How many times will Biden mention Trump in the State of the Union?',
      expected: { category: 'Politics', tags: ['Biden', 'Trump', 'Politics', 'US Politics', 'Mentions', 'SOTU'] },
    },
    {
      question: 'Will Apple beat Q3 earnings estimates?',
      expected: { category: 'Tech', tags: ['Apple', 'Tech', 'Earnings', 'Q3'] },
    },
    {
      question: 'Will the Chiefs win the Super Bowl?',
      expected: { category: 'Sports', tags: ['Chiefs', 'NFL', 'Sports', 'Super Bowl'] },
    },
    {
      question: 'Will Solana reach $200 by 4h close?',
      expected: { category: 'Crypto', tags: ['Solana', 'Crypto', '4h'] },
    },
  ];

  console.log('\n🧪 TESTING TAG ENRICHMENT V2\n');
  console.log('='.repeat(80));

  for (const testCase of testCases) {
    const result = enrichMarketTags(testCase.question);

    console.log(`\n📋 Question: "${testCase.question}"`);
    console.log(`   Matched keywords: ${result.matchedKeywords.join(', ')}`);
    console.log(`   Tags: [${result.enrichedTags.join(', ')}]`);
    console.log(`   Category: ${result.category}`);
    console.log(`   Expected category: ${testCase.expected.category}`);
    console.log(`   ✓ Match: ${result.category === testCase.expected.category ? 'YES' : 'NO'}`);
  }

  console.log('\n' + '='.repeat(80));
}

// Run tests if executed directly
if (require.main === module) {
  testEnrichment();
}
