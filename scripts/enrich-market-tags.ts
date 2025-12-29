/**
 * Market Tag Enrichment Script
 *
 * Enriches market metadata tags by:
 * 1. Adding parent categories (NBA → Sports)
 * 2. Pattern matching on question text
 * 3. Context-aware disambiguation
 * 4. Entity recognition
 * 5. Multi-signal validation
 *
 * Expected improvement: 50% → 90%+ coverage
 *
 * Usage:
 *   npx tsx scripts/enrich-market-tags.ts              # Full production run
 *   npx tsx scripts/enrich-market-tags.ts --dry-run    # Test on 1000 markets
 *   npx tsx scripts/enrich-market-tags.ts --test       # Run unit tests
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// ============================================================================
// Data Structures
// ============================================================================

interface TagHierarchy {
  [child: string]: string;  // child → parent
}

const TAG_HIERARCHY: TagHierarchy = {
  // Sports - Basketball
  'NBA': 'Sports',
  'WNBA': 'Sports',
  'NCAA Basketball': 'Sports',
  'College Basketball': 'Sports',
  'EuroLeague': 'Sports',

  // Sports - Football (American)
  'NFL': 'Sports',
  'NCAA Football': 'Sports',
  'College Football': 'Sports',
  'CFL': 'Sports',

  // Sports - Baseball
  'MLB': 'Sports',
  'NCAA Baseball': 'Sports',
  'College Baseball': 'Sports',

  // Sports - Hockey
  'NHL': 'Sports',
  'AHL': 'Sports',
  'NCAA Hockey': 'Sports',

  // Sports - Soccer
  'EPL': 'Sports',
  'MLS': 'Sports',
  'La Liga': 'Sports',
  'Serie A': 'Sports',
  'Bundesliga': 'Sports',
  'Champions League': 'Sports',
  'UEFA': 'Sports',
  'FIFA': 'Sports',
  'World Cup': 'Sports',
  'Premier League': 'Sports',

  // Sports - Combat
  'UFC': 'Sports',
  'MMA': 'Sports',
  'Boxing': 'Sports',
  'WWE': 'Sports',

  // Sports - Individual
  'Tennis': 'Sports',
  'Golf': 'Sports',
  'Formula 1': 'Sports',
  'F1': 'Sports',
  'NASCAR': 'Sports',
  'IndyCar': 'Sports',

  // Sports - Other
  'Olympics': 'Sports',
  'Olympic Games': 'Sports',

  // Crypto
  'Bitcoin': 'Crypto',
  'BTC': 'Crypto',
  'Ethereum': 'Crypto',
  'ETH': 'Crypto',
  'Solana': 'Crypto',
  'SOL': 'Crypto',
  'Cardano': 'Crypto',
  'ADA': 'Crypto',
  'Dogecoin': 'Crypto',
  'DOGE': 'Crypto',
  'XRP': 'Crypto',
  'Ripple': 'Crypto',
  'DeFi': 'Crypto',
  'NFT': 'Crypto',

  // Crypto - Derivative series (captures "XRP Multi Strikes", "Solana Neg Risk", etc.)
  'BTC Up or Down 15m': 'Crypto',
  'BTC Up or Down Hourly': 'Crypto',
  'BTC Multi Strikes 4H': 'Crypto',
  'Bitcoin Multi Strikes 4H': 'Crypto',
  'ETH Up or Down 15m': 'Crypto',
  'ETH Up or Down Hourly': 'Crypto',
  'Solana Up or Down Hourly': 'Crypto',
  'Solana Multi Strikes Weekly': 'Crypto',
  'Solana Neg Risk Weekly': 'Crypto',
  'XRP Up or Down Hourly': 'Crypto',
  'XRP Multi Strikes 4H': 'Crypto',

  // Tech (sub-categories)
  'AI': 'Technology',
  'Artificial Intelligence': 'Technology',
  'Machine Learning': 'Technology',

  // Business (sub-categories)
  'Stock Market': 'Business',
  'CPI': 'Business',
  'GDP': 'Business',
  'Federal Reserve': 'Business',
  'Fed': 'Business',
};

interface PatternConfig {
  pattern: RegExp;
  category: string;
  confidence: number;
  blockers?: RegExp[];
}

const SPECIFIC_PATTERNS: PatternConfig[] = [
  // ========== SPORTS - Team Names (Ambiguous) ==========
  {
    pattern: /\b(Miami\s+)?Heat\s+(vs\.?|versus|v\.?|@|beat|def(eat(ed)?)?|play(ing)?|face|faces|facing|make|playoff)\b/i,
    category: 'Sports',
    confidence: 0.98,
    blockers: [/heat\s+wave/i, /extreme\s+heat/i, /record\s+heat/i]
  },
  {
    pattern: /\b(Oklahoma\s+City\s+)?Thunder\s+(vs\.?|versus|v\.?|@|beat|play|face|make|playoff)\b/i,
    category: 'Sports',
    confidence: 0.98,
    blockers: [/thunder\s+storm/i, /lightning.*thunder/i]
  },
  {
    pattern: /\b(Brooklyn\s+)?Nets\s+(vs\.?|versus|v\.?|@|beat|play|face|make|playoff|win)\b/i,
    category: 'Sports',
    confidence: 0.98,
    blockers: [/net\s+(income|profit|revenue|earnings?|loss)/i]
  },
  {
    pattern: /\b(Phoenix\s+)?Suns\s+(vs\.?|versus|v\.?|@|beat|play|face)\b/i,
    category: 'Sports',
    confidence: 0.98,
    blockers: [/\bthe\s+sun\b/i, /solar/i, /sunrise|sunset/i]
  },
  {
    pattern: /\b(Orlando\s+)?Magic\s+(vs\.?|versus|v\.?|@|beat|play|face)\b/i,
    category: 'Sports',
    confidence: 0.98,
    blockers: [/magic\s+(trick|show|johnson)/i]
  },
  {
    pattern: /\b(Dallas\s+)?Stars\s+(vs\.?|versus|v\.?|@|beat|play|face)\b/i,
    category: 'Sports',
    confidence: 0.98,
    blockers: [/movie\s+star/i, /film\s+star/i, /\d+\s+star/i]
  },
  {
    pattern: /\b(Utah\s+)?Jazz\s+(vs\.?|versus|v\.?|@|beat|play|face)\b/i,
    category: 'Sports',
    confidence: 0.98,
    blockers: [/jazz\s+(music|musician|festival)/i]
  },
  {
    pattern: /\b(Houston\s+)?Rockets\s+(vs\.?|versus|v\.?|@|beat|play|face)\b/i,
    category: 'Sports',
    confidence: 0.98,
    blockers: [/space.*rocket/i, /SpaceX.*rocket/i, /missile/i]
  },

  // ========== SPORTS - General Patterns ==========
  {
    pattern: /\b(spread|over|under|total):\s*[\w\s]+([-+]?\d+\.?\d*)/i,
    category: 'Sports',
    confidence: 0.95
  },
  {
    pattern: /\bUS\s+Open\b/i,
    category: 'Sports',
    confidence: 0.99
  },
  {
    pattern: /\bWorld\s+Series\b/i,
    category: 'Sports',
    confidence: 1.0
  },
  {
    pattern: /\bSuper\s+Bowl\b/i,
    category: 'Sports',
    confidence: 1.0
  },
  {
    pattern: /\bplayoff\s+series\b/i,
    category: 'Sports',
    confidence: 0.98
  },
  {
    pattern: /\bhome\s+run/i,
    category: 'Sports',
    confidence: 0.98
  },
  {
    pattern: /\btouchdown/i,
    category: 'Sports',
    confidence: 0.99
  },
  {
    pattern: /\bgoal\s+(scored?|against)\b/i,
    category: 'Sports',
    confidence: 0.90
  },

  // ========== TECHNOLOGY ==========
  {
    pattern: /\bOpenAI\b/i,
    category: 'Technology',
    confidence: 1.0
  },
  {
    pattern: /\bopen\s+source\b/i,
    category: 'Technology',
    confidence: 0.95
  },
  {
    pattern: /\b(ChatGPT|GPT-\d|Claude|Gemini|Bard)\b/i,
    category: 'Technology',
    confidence: 0.99
  },
  {
    pattern: /\b(iPhone|iPad|Android|Windows|iOS|MacOS)\b/i,
    category: 'Technology',
    confidence: 0.95
  },
  {
    pattern: /\b(SpaceX|NASA)\b.*\b(rocket|launch|Mars|space|satellite)\b/i,
    category: 'Technology',
    confidence: 0.98
  },
  {
    pattern: /\bAI\s+(model|system|chatbot|assistant|technology)\b/i,
    category: 'Technology',
    confidence: 0.98
  },

  // ========== BUSINESS ==========
  {
    pattern: /\b(bear|bull)\s+market\b/i,
    category: 'Business',
    confidence: 0.99
  },
  {
    pattern: /\bChicago\s+(Bears|Bulls)\b/i,
    category: 'Sports',
    confidence: 1.0
  },
  {
    pattern: /\bgold\s+(price|hits?|above|below|reach)/i,
    category: 'Business',
    confidence: 0.95
  },
  {
    pattern: /\bgold\s+medal/i,
    category: 'Sports',
    confidence: 0.99
  },
  {
    pattern: /\bSeries\s+[A-D]\s+(funding|round|investment)\b/i,
    category: 'Business',
    confidence: 0.98
  },
  {
    pattern: /\bnet\s+(income|profit|revenue|earnings?|loss)\b/i,
    category: 'Business',
    confidence: 0.98
  },
  {
    pattern: /\b(stock|share|IPO|market\s+cap|earnings?)\b/i,
    category: 'Business',
    confidence: 0.85
  },
  {
    pattern: /\b(CPI|inflation|GDP|unemployment|jobs?\s+report)\b/i,
    category: 'Business',
    confidence: 0.95
  },
  {
    pattern: /\b(Federal\s+Reserve|FOMC|interest\s+rate|Powell)\b/i,
    category: 'Business',
    confidence: 0.95
  },
  {
    pattern: /\b(recession|bull\s+market|bear\s+market|crash|rally)\b/i,
    category: 'Business',
    confidence: 0.90
  },

  // ========== POLITICS ==========
  {
    pattern: /\brun\s+for\s+(president|office|governor|senate|congress|house)\b/i,
    category: 'Politics',
    confidence: 0.98
  },
  {
    pattern: /\b(Biden|Trump|Harris|DeSantis|Pence|RFK)\b/i,
    category: 'Politics',
    confidence: 0.95
  },
  {
    pattern: /\b(President|Congress|Senate|House|Governor|Mayor)\b/i,
    category: 'Politics',
    confidence: 0.90
  },
  {
    pattern: /\b(election|vote|poll|primary|caucus|ballot)\b/i,
    category: 'Politics',
    confidence: 0.85
  },
  {
    pattern: /\b(bill|law|policy|regulation|executive\s+order)\b/i,
    category: 'Politics',
    confidence: 0.80
  },
  {
    pattern: /\b(Supreme\s+Court|SCOTUS|indictment|trial|impeach)\b/i,
    category: 'Politics',
    confidence: 0.90
  },
  {
    pattern: /\blabor\s+strike\b/i,
    category: 'Politics',
    confidence: 0.90
  },
  {
    pattern: /\b(SEC|CFTC|FDA|FTC|FCC)\b.*\b(approve|approval|regulation|regulator|rule|ruling|decision)\b/i,
    category: 'Politics',
    confidence: 0.95
  },

  // ========== CRYPTO ==========
  {
    pattern: /\b(Bitcoin|BTC|Ethereum|ETH|crypto|cryptocurrency|blockchain)\b/i,
    category: 'Crypto',
    confidence: 0.95
  },
  {
    pattern: /\b(DeFi|NFT|token|coin|altcoin)\b/i,
    category: 'Crypto',
    confidence: 0.90
  },
  {
    pattern: /\b(wallet|exchange|mining|staking|yield)\b.*\b(crypto|Bitcoin|Ethereum)\b/i,
    category: 'Crypto',
    confidence: 0.92
  },
  {
    pattern: /\$(BTC|ETH|SOL|ADA|DOGE|XRP)\b/,
    category: 'Crypto',
    confidence: 0.98
  },
  {
    pattern: /\b(crypto|Bitcoin)\s+(ETF|spot\s+ETF)\b/i,
    category: 'Crypto',
    confidence: 0.98
  },

  // ========== POP CULTURE ==========
  {
    pattern: /\b(Oscar|Academy\s+Award|box\s+office|film|movie)\b/i,
    category: 'Pop-Culture',
    confidence: 0.85
  },
  {
    pattern: /\b(Emmy|Netflix|HBO|Disney\+|streaming|TV\s+show)\b/i,
    category: 'Pop-Culture',
    confidence: 0.85
  },
  {
    pattern: /\b(Grammy|Billboard|album|concert|tour|music)\b/i,
    category: 'Pop-Culture',
    confidence: 0.85
  },
  {
    pattern: /\bwin\s+Survivor\b/i,
    category: 'Pop-Culture',
    confidence: 0.99
  },

  // ========== SCIENCE ==========
  {
    pattern: /\b(COVID|coronavirus|pandemic|vaccine|FDA|drug)\b/i,
    category: 'Science',
    confidence: 0.90
  },
  {
    pattern: /\b(climate\s+change|global\s+warming|emissions|carbon)\b/i,
    category: 'Science',
    confidence: 0.95
  },

  // ========== WORLD EVENTS ==========
  {
    pattern: /\b(Ukraine|Russia.*war|Israel|Palestine|Gaza)\b/i,
    category: 'World Events',
    confidence: 0.92
  },

  // ========== KEY FIGURES (Politicians, Business Leaders, etc.) ==========
  // These add the person's name as a tag for searchability
  {
    pattern: /\bJerome\s+Powell\b/i,
    category: 'Jerome Powell',
    confidence: 1.0
  },
  {
    pattern: /\bDonald\s+Trump\b/i,
    category: 'Donald Trump',
    confidence: 1.0
  },
  {
    pattern: /\bJoe\s+Biden\b/i,
    category: 'Joe Biden',
    confidence: 1.0
  },
  {
    pattern: /\bKamala\s+Harris\b/i,
    category: 'Kamala Harris',
    confidence: 1.0
  },
  {
    pattern: /\bElon\s+Musk\b/i,
    category: 'Elon Musk',
    confidence: 1.0
  },
  {
    pattern: /\bMark\s+Zuckerberg\b/i,
    category: 'Mark Zuckerberg',
    confidence: 1.0
  },
  {
    pattern: /\bJeff\s+Bezos\b/i,
    category: 'Jeff Bezos',
    confidence: 1.0
  },
  {
    pattern: /\bVladimir\s+Putin\b/i,
    category: 'Vladimir Putin',
    confidence: 1.0
  },
];

// ============================================================================
// Enrichment Logic
// ============================================================================

interface EnrichmentResult {
  originalTags: string[];
  enrichedTags: string[];
  addedTags: string[];
  confidence: number;
  category: string;  // Single top-level category (Sports, Crypto, Politics, etc.)
}

/**
 * Determine the single top-level category from enriched tags
 * Priority order: Sports > Crypto > Politics > Business > Technology > Pop-Culture > World Events > Science > Other
 */
function determineCategory(tags: string[]): string {
  const categoryPriority = [
    'Sports',
    'Crypto',
    'Politics',
    'Business',
    'Technology',
    'Pop-Culture',
    'World Events',
    'Science'
  ];

  // Return the highest priority category found in tags
  for (const category of categoryPriority) {
    if (tags.includes(category)) {
      return category;
    }
  }

  // Default to "Other" if no category match
  return 'Other';
}

function expandHierarchy(existingTags: string[]): Set<string> {
  const expanded = new Set<string>(existingTags);

  for (const tag of existingTags) {
    const parent = TAG_HIERARCHY[tag];
    if (parent && !expanded.has(parent)) {
      expanded.add(parent);
    }
  }

  return expanded;
}

function matchSpecificPatterns(question: string): Map<string, number> {
  const matches = new Map<string, number>();

  for (const config of SPECIFIC_PATTERNS) {
    if (config.pattern.test(question)) {
      // Check blockers
      const blocked = config.blockers?.some(blocker => blocker.test(question)) ?? false;

      if (!blocked) {
        const existing = matches.get(config.category) || 0;
        matches.set(config.category, Math.max(existing, config.confidence));
      }
    }
  }

  return matches;
}

function validateWithMultipleSignals(
  candidates: Map<string, number>,
  minSignals = 1
): string[] {
  // Count signals per category
  const signalCounts = new Map<string, { count: number; maxConf: number }>();

  for (const [category, confidence] of candidates) {
    if (!signalCounts.has(category)) {
      signalCounts.set(category, { count: 0, maxConf: 0 });
    }
    const stats = signalCounts.get(category)!;
    stats.count++;
    stats.maxConf = Math.max(stats.maxConf, confidence);
  }

  // Filter: require minSignals OR high confidence
  const validated = Array.from(signalCounts.entries())
    .filter(([_, stats]) =>
      stats.count >= minSignals ||
      stats.maxConf >= 0.95
    )
    .sort((a, b) => {
      // Sort by: signals DESC, then confidence DESC
      if (a[1].count !== b[1].count) return b[1].count - a[1].count;
      return b[1].maxConf - a[1].maxConf;
    })
    .map(([category, _]) => category)
    .slice(0, 5);  // Max 5 tags

  return validated;
}

export function enrichMarketTags(
  question: string,
  existingTags: string[]
): EnrichmentResult {
  const allCandidates = new Map<string, number>();

  // Phase 1: Hierarchy expansion (100% confidence)
  const hierarchyTags = expandHierarchy(existingTags);
  for (const tag of hierarchyTags) {
    if (!existingTags.includes(tag)) {
      allCandidates.set(tag, 1.0);
    }
  }

  // Phase 2: Specific patterns (95-99% confidence)
  const specificMatches = matchSpecificPatterns(question);
  for (const [category, confidence] of specificMatches) {
    const existing = allCandidates.get(category) || 0;
    allCandidates.set(category, Math.max(existing, confidence));
  }

  // Phase 3: Multi-signal validation
  const validatedTags = validateWithMultipleSignals(allCandidates);

  // Combine with original tags
  const finalTags = Array.from(new Set([...existingTags, ...validatedTags]));

  // Calculate overall confidence
  const avgConfidence = validatedTags.length > 0
    ? validatedTags.reduce((sum, tag) => sum + (allCandidates.get(tag) || 0), 0) / validatedTags.length
    : 0;

  // Determine single top-level category
  const category = determineCategory(finalTags);

  return {
    originalTags: existingTags,
    enrichedTags: finalTags,
    addedTags: validatedTags,
    confidence: avgConfidence,
    category,
  };
}

// ============================================================================
// Database Operations
// ============================================================================

interface Market {
  condition_id: string;
  question: string;
  tags: string[];
}

async function fetchAllMarkets(): Promise<Market[]> {
  const query = `
    SELECT
      condition_id,
      question,
      tags
    FROM pm_market_metadata
    ORDER BY condition_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return result.json();
}

async function updateMarketTags(batch: { condition_id: string; tags: string[] }[]): Promise<void> {
  if (batch.length === 0) return;

  const escape = (str: string) => str.replace(/'/g, "\\'").replace(/\n/g, ' ');

  const values = batch.map(({ condition_id, tags }) => {
    const tagsArray = `[${tags.map(t => `'${escape(t)}'`).join(', ')}]`;
    return `('${escape(condition_id)}', ${tagsArray}, ${Date.now()})`;
  }).join(',\n');

  const query = `
    INSERT INTO pm_market_metadata (
      condition_id,
      tags,
      ingested_at
    ) VALUES
    ${values}
  `;

  await clickhouse.command({ query });
}

// ============================================================================
// Main Processing
// ============================================================================

async function enrichAllMarkets(dryRun = false) {
  console.log('\n' + '='.repeat(70));
  console.log('🏷️  MARKET TAG ENRICHMENT');
  console.log('='.repeat(70));
  console.log(`Mode: ${dryRun ? 'DRY RUN (1000 markets)' : 'PRODUCTION (all markets)'}`);
  console.log('');

  // Fetch markets
  console.log('📡 Fetching markets from database...');
  const allMarkets = await fetchAllMarkets();
  const markets = dryRun ? allMarkets.slice(0, 1000) : allMarkets;
  console.log(`  Loaded ${markets.length.toLocaleString()} markets`);
  console.log('');

  // Statistics
  let processed = 0;
  let enriched = 0;
  let totalTagsAdded = 0;
  const categoryStats = new Map<string, number>();

  const BATCH_SIZE = 1000;
  const batch: { condition_id: string; tags: string[] }[] = [];

  for (const market of markets) {
    const result = enrichMarketTags(market.question, market.tags);

    if (result.addedTags.length > 0) {
      enriched++;
      totalTagsAdded += result.addedTags.length;

      // Track category stats
      for (const tag of result.addedTags) {
        categoryStats.set(tag, (categoryStats.get(tag) || 0) + 1);
      }
    }

    batch.push({
      condition_id: market.condition_id,
      tags: result.enrichedTags
    });

    processed++;

    // Save batch
    if (batch.length >= BATCH_SIZE) {
      if (!dryRun) {
        await updateMarketTags(batch);
      }
      console.log(`  💾 Processed ${processed.toLocaleString()}/${markets.length.toLocaleString()} (${enriched.toLocaleString()} enriched)`);
      batch.length = 0;  // Clear batch
    }
  }

  // Save final batch
  if (batch.length > 0 && !dryRun) {
    await updateMarketTags(batch);
  }

  // Final report
  console.log('\n' + '='.repeat(70));
  console.log('📊 ENRICHMENT SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total markets:      ${processed.toLocaleString()}`);
  console.log(`Enriched:           ${enriched.toLocaleString()} (${(enriched / processed * 100).toFixed(1)}%)`);
  console.log(`Tags added:         ${totalTagsAdded.toLocaleString()}`);
  console.log(`Avg tags/market:    ${(totalTagsAdded / processed).toFixed(2)}`);
  console.log('');
  console.log('Top 10 Categories Added:');
  const topCategories = Array.from(categoryStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [category, count] of topCategories) {
    console.log(`  ${category.padEnd(20)} ${count.toLocaleString()}`);
  }
  console.log('='.repeat(70));
}

// ============================================================================
// Unit Tests
// ============================================================================

interface TestCase {
  question: string;
  existingTags: string[];
  expectedHas: string[];
  expectedNot: string[];
  description: string;
}

const UNIT_TESTS: TestCase[] = [
  {
    description: 'OpenAI vs US Open',
    question: 'Will OpenAI release GPT-5 in 2025?',
    existingTags: [],
    expectedHas: ['Technology'],
    expectedNot: ['Sports']
  },
  {
    description: 'US Open (Sports)',
    question: 'Who will win the US Open golf tournament?',
    existingTags: [],
    expectedHas: ['Sports'],
    expectedNot: ['Technology']
  },
  {
    description: 'Brooklyn Nets (team)',
    question: 'Will the Brooklyn Nets make the playoffs?',
    existingTags: [],
    expectedHas: ['Sports'],
    expectedNot: ['Business']
  },
  {
    description: 'Net income (business)',
    question: "Will Apple's net income exceed $100B?",
    existingTags: [],
    expectedHas: ['Business'],
    expectedNot: ['Sports']
  },
  {
    description: 'Hierarchy expansion - NBA',
    question: 'Lakers vs Celtics',
    existingTags: ['NBA'],
    expectedHas: ['Sports', 'NBA'],
    expectedNot: []
  },
  {
    description: 'Multi-category - Crypto + Politics',
    question: 'Will the SEC approve a Bitcoin ETF?',
    existingTags: [],
    expectedHas: ['Crypto', 'Politics'],
    expectedNot: []
  },
  {
    description: 'Labor strike (politics)',
    question: 'Will there be a major labor strike in 2025?',
    existingTags: [],
    expectedHas: ['Politics'],
    expectedNot: ['Sports']
  },
  {
    description: 'Bear market (business)',
    question: 'Will we enter a bear market in 2025?',
    existingTags: [],
    expectedHas: ['Business'],
    expectedNot: ['Sports']
  },
  {
    description: 'Chicago Bears (sports)',
    question: 'Will the Chicago Bears make the playoffs?',
    existingTags: [],
    expectedHas: ['Sports'],
    expectedNot: ['Business']
  },
];

function runUnitTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 UNIT TESTS: Tag Enrichment');
  console.log('='.repeat(70));
  console.log('');

  let passed = 0;
  let failed = 0;

  for (const test of UNIT_TESTS) {
    const result = enrichMarketTags(test.question, test.existingTags);
    const resultTags = result.enrichedTags;

    // Check expectedHas
    const missingTags = test.expectedHas.filter(tag => !resultTags.includes(tag));

    // Check expectedNot
    const unwantedTags = test.expectedNot.filter(tag => resultTags.includes(tag));

    if (missingTags.length === 0 && unwantedTags.length === 0) {
      console.log(`✅ PASS: ${test.description}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${test.description}`);
      console.log(`   Question: ${test.question}`);
      console.log(`   Result: [${resultTags.join(', ')}]`);
      if (missingTags.length > 0) {
        console.log(`   Missing: [${missingTags.join(', ')}]`);
      }
      if (unwantedTags.length > 0) {
        console.log(`   Unwanted: [${unwantedTags.join(', ')}]`);
      }
      console.log('');
      failed++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`✅ Passed: ${passed}/${UNIT_TESTS.length}`);
  console.log(`❌ Failed: ${failed}/${UNIT_TESTS.length}`);
  console.log('='.repeat(70));

  if (failed > 0) {
    process.exit(1);
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    runUnitTests();
  } else if (args.includes('--dry-run')) {
    await enrichAllMarkets(true);
  } else {
    await enrichAllMarkets(false);
  }
}

main().catch(console.error);
