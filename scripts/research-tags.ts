/**
 * Tag Research Script - The "Hidden Tag" Hunt
 *
 * Purpose: Forensically investigate the Gamma API response structure to find
 * hidden categorization data in legacy markets (2021-2023).
 *
 * Goal: Increase tag coverage from ~2% to 50%+ by discovering non-standard
 * metadata fields that contain category/tag information.
 */

import 'dotenv/config';

const API_URL = 'https://gamma-api.polymarket.com/markets';

interface TagResearchReport {
  year: number;
  marketId: string;
  question: string;
  createdAt: string;
  findings: {
    hasStandardTags: boolean;
    standardTagsFound: string[];
    potentialTagFields: Array<{
      field: string;
      value: any;
      confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      reason: string;
    }>;
  };
  rawJson: any;
}

/**
 * Fetch random markets from a specific year using offset
 */
async function fetchMarketsFromYear(year: number, count: number = 5): Promise<any[]> {
  console.log(`\n📡 Fetching ${count} markets from ${year}...`);

  const markets: any[] = [];
  const targetDate = new Date(`${year}-06-01`); // Mid-year

  // Strategy: Fetch recent markets and filter by year
  // (API doesn't have date filtering, so we'll fetch a larger batch and filter)
  const response = await fetch(`${API_URL}?limit=100&offset=${year === 2021 ? 15000 : year === 2022 ? 10000 : 5000}`);
  const data = await response.json();

  if (!Array.isArray(data)) {
    console.warn('⚠️  API returned non-array response');
    return [];
  }

  // Filter markets by creation year
  const yearMarkets = data.filter((m: any) => {
    const created = new Date(m.createdAt || m.created_at || '');
    return created.getFullYear() === year;
  });

  console.log(`   Found ${yearMarkets.length} markets from ${year}`);
  return yearMarkets.slice(0, count);
}

/**
 * Analyze a market object for potential tag fields
 */
function analyzeMarket(market: any): TagResearchReport['findings'] {
  const findings: TagResearchReport['findings'] = {
    hasStandardTags: false,
    standardTagsFound: [],
    potentialTagFields: [],
  };

  // Check standard tag sources
  if (market.category) {
    findings.hasStandardTags = true;
    findings.standardTagsFound.push(`category: ${market.category}`);
  }
  if (market.mailchimpTag) {
    findings.hasStandardTags = true;
    findings.standardTagsFound.push(`mailchimpTag: ${market.mailchimpTag}`);
  }

  // HUNT 1: Look for array fields that might contain tags
  const arrayFields = [
    'keywords', 'tags', 'aliases', 'topics', 'sections', 'categories',
    'labels', 'classifiers', 'segments', 'themes'
  ];

  for (const field of arrayFields) {
    if (market[field] && Array.isArray(market[field]) && market[field].length > 0) {
      findings.potentialTagFields.push({
        field,
        value: market[field],
        confidence: 'HIGH',
        reason: `Array field '${field}' contains ${market[field].length} items`
      });
    }
  }

  // HUNT 2: Check events array for nested tags
  if (market.events && Array.isArray(market.events) && market.events.length > 0) {
    const event = market.events[0];

    // Check event.tags
    if (event.tags && Array.isArray(event.tags) && event.tags.length > 0) {
      findings.potentialTagFields.push({
        field: 'events[0].tags',
        value: event.tags,
        confidence: 'HIGH',
        reason: `Event has ${event.tags.length} tags`
      });
    }

    // Check event.category
    if (event.category && event.category !== market.category) {
      findings.potentialTagFields.push({
        field: 'events[0].category',
        value: event.category,
        confidence: 'MEDIUM',
        reason: 'Event category differs from market category'
      });
    }

    // Check event.title for hashtags
    if (event.title && event.title.includes('#')) {
      const hashtags = event.title.match(/#\w+/g) || [];
      if (hashtags.length > 0) {
        findings.potentialTagFields.push({
          field: 'events[0].title (hashtags)',
          value: hashtags,
          confidence: 'MEDIUM',
          reason: `Found ${hashtags.length} hashtags in event title`
        });
      }
    }

    // Check event.series for grouping
    if (event.series && Array.isArray(event.series) && event.series.length > 0) {
      findings.potentialTagFields.push({
        field: 'events[0].series',
        value: event.series.map((s: any) => s.title || s.name || s.slug),
        confidence: 'HIGH',
        reason: 'Series data could indicate topic grouping'
      });
    }
  }

  // HUNT 3: Analyze slug for embedded categories
  if (market.slug) {
    const slugParts = market.slug.split('-');
    const potentialCategories = [
      'politics', 'sports', 'crypto', 'finance', 'tech', 'entertainment',
      'election', 'nba', 'nfl', 'bitcoin', 'ethereum', 'trump', 'biden'
    ];

    const foundInSlug = slugParts.filter(part =>
      potentialCategories.includes(part.toLowerCase())
    );

    if (foundInSlug.length > 0) {
      findings.potentialTagFields.push({
        field: 'slug (parsed)',
        value: foundInSlug,
        confidence: 'LOW',
        reason: `Slug contains potential category keywords: ${foundInSlug.join(', ')}`
      });
    }
  }

  // HUNT 4: Check for search-related fields
  const searchFields = ['search_vector', 'elastic', 'searchTerms', 'searchData'];
  for (const field of searchFields) {
    if (market[field]) {
      findings.potentialTagFields.push({
        field,
        value: typeof market[field] === 'string' ? market[field].substring(0, 100) : market[field],
        confidence: 'LOW',
        reason: 'Search metadata field exists'
      });
    }
  }

  // HUNT 5: Check description for category hints
  if (market.description && market.description.length > 0) {
    const categoryPatterns = [
      /\bcategory[:\s]+(\w+)/i,
      /\btopic[:\s]+(\w+)/i,
      /\btagged as[:\s]+([^.]+)/i
    ];

    for (const pattern of categoryPatterns) {
      const match = market.description.match(pattern);
      if (match) {
        findings.potentialTagFields.push({
          field: 'description (parsed)',
          value: match[1],
          confidence: 'LOW',
          reason: `Description contains category hint: "${match[0]}"`
        });
      }
    }
  }

  return findings;
}

/**
 * Generate a comprehensive research report
 */
async function generateResearchReport(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TAG RESEARCH REPORT - The "Hidden Tag" Hunt');
  console.log('='.repeat(80));

  const reports: TagResearchReport[] = [];

  // Research markets from different years
  for (const year of [2021, 2022, 2023]) {
    const markets = await fetchMarketsFromYear(year, 5);

    for (const market of markets) {
      const findings = analyzeMarket(market);

      reports.push({
        year,
        marketId: market.id,
        question: market.question,
        createdAt: market.createdAt || market.created_at,
        findings,
        rawJson: market
      });
    }
  }

  // Print detailed findings
  console.log('\n📊 DETAILED FINDINGS\n');

  for (const report of reports) {
    console.log('─'.repeat(80));
    console.log(`Market ID: ${report.marketId} (${report.year})`);
    console.log(`Question: ${report.question.substring(0, 80)}...`);
    console.log(`Created: ${report.createdAt}`);
    console.log();

    if (report.findings.hasStandardTags) {
      console.log(`✅ Standard Tags Found: ${report.findings.standardTagsFound.join(', ')}`);
    } else {
      console.log('❌ No standard tags (category, mailchimpTag)');
    }

    if (report.findings.potentialTagFields.length > 0) {
      console.log(`\n🔍 POTENTIAL TAG FIELDS (${report.findings.potentialTagFields.length} found):`);
      for (const field of report.findings.potentialTagFields) {
        console.log(`   [${field.confidence}] ${field.field}`);
        console.log(`      Value: ${JSON.stringify(field.value).substring(0, 100)}`);
        console.log(`      Reason: ${field.reason}`);
      }
    } else {
      console.log('\n⚠️  No potential tag fields found');
    }

    console.log();
  }

  // Print summary statistics
  console.log('\n' + '='.repeat(80));
  console.log('📈 SUMMARY STATISTICS');
  console.log('='.repeat(80));

  const totalMarkets = reports.length;
  const marketsWithStandardTags = reports.filter(r => r.findings.hasStandardTags).length;
  const marketsWithPotentialTags = reports.filter(r => r.findings.potentialTagFields.length > 0).length;

  console.log(`Total markets analyzed: ${totalMarkets}`);
  console.log(`Markets with standard tags: ${marketsWithStandardTags} (${(marketsWithStandardTags / totalMarkets * 100).toFixed(1)}%)`);
  console.log(`Markets with potential hidden tags: ${marketsWithPotentialTags} (${(marketsWithPotentialTags / totalMarkets * 100).toFixed(1)}%)`);

  // Aggregate field frequency
  const fieldFrequency: Map<string, number> = new Map();
  for (const report of reports) {
    for (const field of report.findings.potentialTagFields) {
      fieldFrequency.set(field.field, (fieldFrequency.get(field.field) || 0) + 1);
    }
  }

  if (fieldFrequency.size > 0) {
    console.log('\n🎯 Most Common Potential Tag Fields:');
    const sorted = Array.from(fieldFrequency.entries())
      .sort((a, b) => b[1] - a[1]);

    for (const [field, count] of sorted) {
      console.log(`   ${field}: ${count} markets (${(count / totalMarkets * 100).toFixed(1)}%)`);
    }
  }

  // Print full JSON for first 2 markets of each year (for manual inspection)
  console.log('\n' + '='.repeat(80));
  console.log('📄 RAW JSON SAMPLES (First market from each year)');
  console.log('='.repeat(80));

  for (const year of [2021, 2022, 2023]) {
    const yearReport = reports.find(r => r.year === year);
    if (yearReport) {
      console.log(`\n### ${year} Market (ID: ${yearReport.marketId}) ###\n`);
      console.log(JSON.stringify(yearReport.rawJson, null, 2));
      console.log('\n');
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Research complete! Review findings above.');
  console.log('='.repeat(80));
}

// Run the research
generateResearchReport().catch(error => {
  console.error('❌ Research failed:', error);
  process.exit(1);
});
