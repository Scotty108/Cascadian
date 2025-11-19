#!/usr/bin/env tsx
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

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function findOutcomeIndex(winningOutcome: string, outcomes: string[]): number {
  const normalizedWinner = normalizeText(winningOutcome);

  for (let i = 0; i < outcomes.length; i++) {
    if (normalizeText(outcomes[i]) === normalizedWinner) {
      return i;
    }
  }

  for (let i = 0; i < outcomes.length; i++) {
    const normalizedOutcome = normalizeText(outcomes[i]);
    if (normalizedOutcome.includes(normalizedWinner) || normalizedWinner.includes(normalizedOutcome)) {
      return i;
    }
  }

  return -1;
}

(async () => {
  console.log('\n🔍 Full Mismatch Breakdown Analysis...\n');

  // Load all candidates
  const candidatesResult = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        outcome,
        source,
        confidence
      FROM default.resolution_candidates
      WHERE confidence >= 0.9
      ORDER BY confidence DESC, fetched_at DESC
    `,
    format: 'JSONEachRow',
  });

  const candidates: ResolutionCandidate[] = await candidatesResult.json();
  console.log(`Loaded ${candidates.length} candidates\n`);

  // Load markets
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
  console.log(`Loaded ${markets.length} markets\n`);

  // Analyze mismatches
  const mismatchPatterns: Record<string, number> = {};
  const seenConditionIds = new Set<string>();
  let totalMismatches = 0;

  for (const candidate of candidates) {
    if (seenConditionIds.has(candidate.condition_id_norm)) continue;
    seenConditionIds.add(candidate.condition_id_norm);

    const market = marketMap.get(candidate.condition_id_norm);
    if (!market) continue;

    const matchIndex = findOutcomeIndex(candidate.outcome, market.outcomes);
    if (matchIndex === -1) {
      totalMismatches++;
      const key = `"${candidate.outcome}" → [${market.outcomes.join(', ')}]`;
      mismatchPatterns[key] = (mismatchPatterns[key] || 0) + 1;
    }
  }

  console.log(`📊 Total mismatches: ${totalMismatches}\n`);
  console.log('Top 30 mismatch patterns:\n');

  Object.entries(mismatchPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([pattern, count], i) => {
      console.log(`${i + 1}. ${pattern}: ${count}`);
    });

  await ch.close();
})();
