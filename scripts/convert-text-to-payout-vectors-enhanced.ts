#!/usr/bin/env tsx
/**
 * Enhanced TEXT → Payout Vector Converter
 *
 * Adds smart binary outcome mapping for:
 * - YES/NO → Up/Down (11,107 markets)
 * - YES/NO → Over/Under (907 markets)
 * - YES/NO → Team names (via question context)
 * - Favorite/Underdog, Home/Away patterns
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface ResolutionCandidate {
  condition_id_norm: string;
  outcome: string;
  source: string;
  confidence: number;
}

interface Market {
  condition_id: string;
  outcomes: string[];
  question: string;
}

interface PayoutVector {
  condition_id_norm: string;
  payout_numerators: number[];
  payout_denominator: number;
  winning_outcome: string;
  source: string;
}

// Binary outcome mapping rules
const BINARY_MAPPINGS: Record<string, { yes: string[]; no: string[] }> = {
  // Up/Down patterns
  updown: {
    yes: ['up', 'higher', 'increase', 'rise', 'gain', 'positive'],
    no: ['down', 'lower', 'decrease', 'fall', 'drop', 'negative']
  },
  // Over/Under patterns
  overunder: {
    yes: ['over', 'above', 'more'],
    no: ['under', 'below', 'less', 'fewer']
  },
  // Favorite/Underdog patterns
  favdog: {
    yes: ['favorite', 'fav', 'favored', '-'],
    no: ['underdog', 'dog', '+']
  },
  // Home/Away patterns
  homeaway: {
    yes: ['home'],
    no: ['away', 'visitor']
  },
  // Even/Odd patterns
  evenodd: {
    yes: ['even'],
    no: ['odd']
  }
};

// Normalize text for comparison
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

// Find binary pattern match
function findBinaryPattern(outcomes: string[]): string | null {
  if (outcomes.length !== 2) return null;

  const normalized = outcomes.map(normalizeText);

  for (const [pattern, mapping] of Object.entries(BINARY_MAPPINGS)) {
    const hasYes = mapping.yes.some(y => normalized[0].includes(y) || normalized[1].includes(y));
    const hasNo = mapping.no.some(n => normalized[0].includes(n) || normalized[1].includes(n));

    if (hasYes && hasNo) {
      return pattern;
    }
  }

  return null;
}

// Map YES/NO to binary outcome index using pattern detection
function mapBinaryOutcome(
  winningText: string,
  outcomes: string[],
  question: string
): number {
  if (outcomes.length !== 2) return -1;

  const normalized = winningText.toLowerCase().trim();
  const isYes = normalized === 'yes' || normalized === 'y';
  const isNo = normalized === 'no' || normalized === 'n';

  if (!isYes && !isNo) return -1;

  // Detect pattern in outcomes
  const pattern = findBinaryPattern(outcomes);

  if (pattern) {
    const mapping = BINARY_MAPPINGS[pattern];
    const normalizedOutcomes = outcomes.map(normalizeText);

    // Find which index matches YES pattern
    const yesIndex = normalizedOutcomes.findIndex(o =>
      mapping.yes.some(y => o.includes(y))
    );

    if (yesIndex !== -1) {
      return isYes ? yesIndex : (yesIndex === 0 ? 1 : 0);
    }
  }

  // Fallback: Use question context for team names
  // If question mentions one team more prominently, assume YES = that team
  const normalizedQ = normalizeText(question);
  const outcome0 = normalizeText(outcomes[0]);
  const outcome1 = normalizeText(outcomes[1]);

  // Check if question starts with team name (e.g., "Dodgers vs. Rockies")
  if (normalizedQ.startsWith(outcome0)) {
    return isYes ? 0 : 1;
  }
  if (normalizedQ.startsWith(outcome1)) {
    return isYes ? 1 : 0;
  }

  // Check which team appears first in question
  const index0 = normalizedQ.indexOf(outcome0);
  const index1 = normalizedQ.indexOf(outcome1);

  if (index0 !== -1 && index1 !== -1) {
    return isYes ? (index0 < index1 ? 0 : 1) : (index0 < index1 ? 1 : 0);
  }

  return -1;
}

// Find matching outcome index with enhanced fuzzy matching
function findOutcomeIndex(
  winningOutcome: string,
  outcomes: string[],
  question: string
): number {
  const normalizedWinner = normalizeText(winningOutcome);

  // Try exact match first
  for (let i = 0; i < outcomes.length; i++) {
    if (normalizeText(outcomes[i]) === normalizedWinner) {
      return i;
    }
  }

  // Try binary YES/NO mapping for binary markets
  if (outcomes.length === 2) {
    const binaryIndex = mapBinaryOutcome(winningOutcome, outcomes, question);
    if (binaryIndex !== -1) {
      return binaryIndex;
    }
  }

  // Try partial match
  for (let i = 0; i < outcomes.length; i++) {
    const normalizedOutcome = normalizeText(outcomes[i]);
    if (normalizedOutcome.includes(normalizedWinner) ||
        normalizedWinner.includes(normalizedOutcome)) {
      return i;
    }
  }

  return -1;
}

// Convert TEXT outcome to payout vector
function textToPayoutVector(
  conditionId: string,
  winningOutcome: string,
  outcomes: string[],
  source: string,
  question: string
): PayoutVector | null {
  const winnerIndex = findOutcomeIndex(winningOutcome, outcomes, question);

  if (winnerIndex === -1) {
    return null;
  }

  const payoutNumerators = outcomes.map((_, i) => i === winnerIndex ? 1 : 0);

  return {
    condition_id_norm: conditionId,
    payout_numerators: payoutNumerators,
    payout_denominator: 1,
    winning_outcome: winningOutcome,
    source: `converted_from_${source}`
  };
}

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔄 ENHANCED TEXT→PAYOUT CONVERTER');
  console.log('   Now with binary outcome mapping (Up/Down, Over/Under, etc.)');
  console.log('═'.repeat(80));

  // Step 1: Get resolution candidates
  console.log('\n📊 Step 1: Loading resolution candidates...');

  const candidatesResult = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        outcome,
        source,
        confidence
      FROM default.resolution_candidates
      WHERE confidence >= 0.9
        AND outcome != 'INVALID'
      ORDER BY confidence DESC, fetched_at DESC
    `,
    format: 'JSONEachRow',
  });

  const candidates: ResolutionCandidate[] = await candidatesResult.json();
  console.log(`  ✅ Loaded ${candidates.length} candidates (excluding INVALID)`);

  // Step 2: Get market outcome arrays
  console.log('\n📊 Step 2: Loading market outcome arrays...');

  const marketsResult = await ch.query({
    query: `
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as condition_id,
        outcomes,
        question
      FROM default.api_markets_staging
      WHERE length(outcomes) > 0
    `,
    format: 'JSONEachRow',
  });

  const markets: Market[] = await marketsResult.json();
  const marketMap = new Map<string, Market>();
  markets.forEach(m => marketMap.set(m.condition_id, m));

  console.log(`  ✅ Loaded ${markets.length} market outcome arrays`);

  // Step 3: Convert with enhanced matching
  console.log('\n📊 Step 3: Converting with enhanced binary mapping...');

  const payoutVectors: PayoutVector[] = [];
  const stats = {
    totalCandidates: candidates.length,
    noMarketData: 0,
    noOutcomeMatch: 0,
    successfulConversion: 0,
    binaryMapped: 0,
    exactMatched: 0,
    partialMatched: 0,
    duplicates: 0
  };

  const seenConditionIds = new Set<string>();

  for (const candidate of candidates) {
    if (seenConditionIds.has(candidate.condition_id_norm)) {
      stats.duplicates++;
      continue;
    }

    const market = marketMap.get(candidate.condition_id_norm);

    if (!market) {
      stats.noMarketData++;
      continue;
    }

    // Track matching method
    const normalizedWinner = normalizeText(candidate.outcome);
    const exactMatch = market.outcomes.some(o => normalizeText(o) === normalizedWinner);
    const isBinaryYesNo = (normalizedWinner === 'yes' || normalizedWinner === 'no') &&
                          market.outcomes.length === 2;

    const payoutVector = textToPayoutVector(
      candidate.condition_id_norm,
      candidate.outcome,
      market.outcomes,
      candidate.source,
      market.question
    );

    if (!payoutVector) {
      stats.noOutcomeMatch++;
      if (stats.noOutcomeMatch <= 10) {
        console.log(`  ⚠️  No match: "${candidate.outcome}" not in [${market.outcomes.join(', ')}]`);
        console.log(`      Market: ${market.question.substring(0, 60)}...`);
      }
      continue;
    }

    // Track matching method
    if (isBinaryYesNo) stats.binaryMapped++;
    else if (exactMatch) stats.exactMatched++;
    else stats.partialMatched++;

    payoutVectors.push(payoutVector);
    seenConditionIds.add(candidate.condition_id_norm);
    stats.successfulConversion++;

    if (stats.successfulConversion % 10000 === 0) {
      console.log(`  Progress: ${stats.successfulConversion.toLocaleString()} converted...`);
    }
  }

  console.log('\n  ✅ Conversion complete!');
  console.log(`\n  Statistics:`);
  console.log(`    Total candidates: ${stats.totalCandidates.toLocaleString()}`);
  console.log(`    Successful conversions: ${stats.successfulConversion.toLocaleString()} ✅`);
  console.log(`      - Binary YES/NO mapped: ${stats.binaryMapped.toLocaleString()}`);
  console.log(`      - Exact matches: ${stats.exactMatched.toLocaleString()}`);
  console.log(`      - Partial matches: ${stats.partialMatched.toLocaleString()}`);
  console.log(`    Missing market data: ${stats.noMarketData.toLocaleString()}`);
  console.log(`    Outcome mismatch: ${stats.noOutcomeMatch.toLocaleString()}`);
  console.log(`    Duplicates skipped: ${stats.duplicates.toLocaleString()}`);
  console.log(`    Conversion rate: ${((stats.successfulConversion / stats.totalCandidates) * 100).toFixed(1)}%`);

  // Step 4: Insert into DB
  if (payoutVectors.length === 0) {
    console.log('\n  ⚠️  No payout vectors to insert');
    await ch.close();
    return;
  }

  console.log(`\n📊 Step 4: Inserting ${payoutVectors.length.toLocaleString()} payout vectors...`);

  const rows = payoutVectors.map(pv => {
    const winningIndex = pv.payout_numerators.findIndex(n => n === 1);

    return {
      condition_id: pv.condition_id_norm,
      payout_numerators: pv.payout_numerators,
      payout_denominator: pv.payout_denominator,
      winning_index: winningIndex,
      resolved_at: new Date(),
      source: pv.source,
      fetched_at: new Date()
    };
  });

  const batchSize = 10000;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    await ch.insert({
      table: 'default.resolutions_external_ingest',
      values: batch,
      format: 'JSONEachRow',
    });

    inserted += batch.length;
    console.log(`  Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)} (${inserted.toLocaleString()} total)`);
  }

  console.log(`  ✅ Inserted ${inserted.toLocaleString()} payout vectors`);

  // Step 5: Verify coverage
  console.log('\n📊 Step 5: Verifying coverage improvement...');

  const beforeCoverage = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      )
      SELECT
        COUNT(*) as total_traded,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout_before
      FROM traded_markets tm
      LEFT JOIN default.market_resolutions_final r
        ON tm.condition_id = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const afterCoverage = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm, payout_denominator
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator
        FROM default.resolutions_external_ingest
      )
      SELECT
        COUNT(*) as total_traded,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout_after
      FROM traded_markets tm
      LEFT JOIN all_resolutions r
        ON tm.condition_id = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const beforeStats = await beforeCoverage.json();
  const afterStats = await afterCoverage.json();

  const totalTraded = parseInt(beforeStats[0].total_traded);
  const beforePayout = parseInt(beforeStats[0].has_payout_before);
  const afterPayout = parseInt(afterStats[0].has_payout_after);

  const beforePct = (beforePayout / totalTraded) * 100;
  const afterPct = (afterPayout / totalTraded) * 100;
  const improvement = afterPayout - beforePayout;

  console.log('\n  📈 Coverage Improvement:');
  console.log(`    Total traded markets: ${totalTraded.toLocaleString()}`);
  console.log(`    Before: ${beforePayout.toLocaleString()} markets (${beforePct.toFixed(1)}%)`);
  console.log(`    After:  ${afterPayout.toLocaleString()} markets (${afterPct.toFixed(1)}%)`);
  console.log(`    Improvement: +${improvement.toLocaleString()} markets (+${(afterPct - beforePct).toFixed(1)}%)`);

  console.log('\n' + '═'.repeat(80));
  console.log('✅ ENHANCED CONVERSION COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
