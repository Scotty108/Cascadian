#!/usr/bin/env tsx
/**
 * Convert TEXT Resolutions → Numeric Payout Vectors
 *
 * Problem: 424K markets in resolution_candidates have TEXT outcomes ("Yes"/"No")
 *          but P&L calculation needs numeric payout vectors ([1,0])
 *
 * Solution: Join with api_markets_staging to get outcome arrays,
 *           map TEXT outcome to position, generate payout vector
 *
 * Expected: 27% → 90% P&L coverage (56K → 180K+ markets)
 * Runtime: ~30 minutes
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

// Normalize text for comparison (handles case, whitespace, punctuation)
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')  // Remove punctuation
    .replace(/\s+/g, ' ');     // Normalize whitespace
}

// Find matching outcome index with fuzzy matching
function findOutcomeIndex(winningOutcome: string, outcomes: string[]): number {
  const normalizedWinner = normalizeText(winningOutcome);

  // Try exact match first
  for (let i = 0; i < outcomes.length; i++) {
    if (normalizeText(outcomes[i]) === normalizedWinner) {
      return i;
    }
  }

  // Try partial match (e.g., "Trump" matches "Donald Trump")
  for (let i = 0; i < outcomes.length; i++) {
    const normalizedOutcome = normalizeText(outcomes[i]);
    if (normalizedOutcome.includes(normalizedWinner) || normalizedWinner.includes(normalizedOutcome)) {
      return i;
    }
  }

  return -1; // No match found
}

// Convert TEXT outcome to payout vector
function textToPayoutVector(
  conditionId: string,
  winningOutcome: string,
  outcomes: string[],
  source: string
): PayoutVector | null {
  const winnerIndex = findOutcomeIndex(winningOutcome, outcomes);

  if (winnerIndex === -1) {
    return null; // Couldn't match outcome
  }

  // Generate payout vector: 1 for winner, 0 for losers
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
  console.log('🔄 CONVERTING TEXT RESOLUTIONS → PAYOUT VECTORS');
  console.log('   Goal: 27% → 90% P&L coverage');
  console.log('═'.repeat(80));

  // Step 1: Get resolution candidates with TEXT outcomes
  console.log('\n📊 Step 1: Loading resolution candidates (424K TEXT outcomes)...');

  const candidatesResult = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        outcome,
        source,
        confidence
      FROM default.resolution_candidates
      WHERE confidence >= 0.9  -- Only high-confidence resolutions
      ORDER BY confidence DESC, fetched_at DESC
    `,
    format: 'JSONEachRow',
  });

  const candidates: ResolutionCandidate[] = await candidatesResult.json();
  console.log(`  ✅ Loaded ${candidates.length} resolution candidates`);

  // Step 2: Get market outcome arrays from api_markets_staging
  console.log('\n📊 Step 2: Loading market outcome arrays (161K markets)...');

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

  // Step 3: Convert TEXT → Payout vectors
  console.log('\n📊 Step 3: Converting TEXT outcomes to payout vectors...');

  const payoutVectors: PayoutVector[] = [];
  const stats = {
    totalCandidates: candidates.length,
    noMarketData: 0,
    noOutcomeMatch: 0,
    successfulConversion: 0,
    duplicates: 0
  };

  const seenConditionIds = new Set<string>();

  for (const candidate of candidates) {
    // Skip duplicates (take highest confidence)
    if (seenConditionIds.has(candidate.condition_id_norm)) {
      stats.duplicates++;
      continue;
    }

    const market = marketMap.get(candidate.condition_id_norm);

    if (!market) {
      stats.noMarketData++;
      continue;
    }

    const payoutVector = textToPayoutVector(
      candidate.condition_id_norm,
      candidate.outcome,
      market.outcomes,
      candidate.source
    );

    if (!payoutVector) {
      stats.noOutcomeMatch++;
      if (stats.noOutcomeMatch <= 10) {
        console.log(`  ⚠️  No match: "${candidate.outcome}" not in [${market.outcomes.join(', ')}]`);
        console.log(`      Market: ${market.question.substring(0, 60)}...`);
      }
      continue;
    }

    payoutVectors.push(payoutVector);
    seenConditionIds.add(candidate.condition_id_norm);
    stats.successfulConversion++;

    // Progress update every 10K
    if (stats.successfulConversion % 10000 === 0) {
      console.log(`  Progress: ${stats.successfulConversion.toLocaleString()} converted...`);
    }
  }

  console.log('\n  ✅ Conversion complete!');
  console.log(`\n  Statistics:`);
  console.log(`    Total candidates: ${stats.totalCandidates.toLocaleString()}`);
  console.log(`    Successful conversions: ${stats.successfulConversion.toLocaleString()} ✅`);
  console.log(`    Missing market data: ${stats.noMarketData.toLocaleString()}`);
  console.log(`    Outcome mismatch: ${stats.noOutcomeMatch.toLocaleString()}`);
  console.log(`    Duplicates skipped: ${stats.duplicates.toLocaleString()}`);
  console.log(`    Conversion rate: ${((stats.successfulConversion / stats.totalCandidates) * 100).toFixed(1)}%`);

  // Step 4: Insert into resolutions_external_ingest
  if (payoutVectors.length === 0) {
    console.log('\n  ⚠️  No payout vectors to insert');
    await ch.close();
    return;
  }

  console.log(`\n📊 Step 4: Inserting ${payoutVectors.length.toLocaleString()} payout vectors into resolutions_external_ingest...`);

  const rows = payoutVectors.map(pv => {
    // Find winning index (the index with value 1)
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

  // Insert in batches of 10K
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

  // Step 5: Verify coverage improvement
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
  console.log('✅ CONVERSION COMPLETE');
  console.log('═'.repeat(80));
  console.log('\nNext steps:');
  console.log('  1. Refresh market_resolutions_final view to include new data');
  console.log('  2. P&L views will automatically pick up new payout vectors');
  console.log('  3. Expected: 75%+ positions now have calculated P&L');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
