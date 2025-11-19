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

(async () => {
  console.log('\n🔍 Analyzing Outcome Mismatch Patterns...\n');

  // Get all candidates that don't match
  const candidatesResult = await ch.query({
    query: `
      SELECT
        rc.condition_id_norm,
        rc.outcome as winning_text,
        m.outcomes as outcome_array,
        m.question
      FROM default.resolution_candidates rc
      INNER JOIN (
        SELECT
          lower(replaceAll(condition_id, '0x', '')) as condition_id,
          outcomes,
          question
        FROM default.api_markets_staging
        WHERE length(outcomes) > 0
      ) m ON rc.condition_id_norm = m.condition_id
      WHERE rc.confidence >= 0.9
        AND rc.condition_id_norm NOT IN (
          SELECT condition_id FROM default.resolutions_external_ingest
        )
      LIMIT 5000
    `,
    format: 'JSONEachRow',
  });

  const mismatches = await candidatesResult.json();
  console.log(`📊 Analyzing ${mismatches.length} mismatch samples...\n`);

  // Pattern analysis
  const patterns: Record<string, { count: number; examples: any[] }> = {};

  for (const m of mismatches) {
    const winning = (m.winning_text || '').toLowerCase().trim();
    const outcomes = m.outcome_array || [];
    
    // Skip if no outcomes
    if (outcomes.length === 0) continue;

    // Pattern 1: Yes/No → binary outcomes
    if ((winning === 'yes' || winning === 'no') && outcomes.length === 2) {
      const key = `YES/NO → [${outcomes.join(', ')}]`;
      if (!patterns[key]) patterns[key] = { count: 0, examples: [] };
      patterns[key].count++;
      if (patterns[key].examples.length < 3) {
        patterns[key].examples.push({
          winning,
          outcomes,
          question: m.question.substring(0, 60)
        });
      }
    }

    // Pattern 2: Team names (detect if winning text not in outcomes at all)
    const inOutcomes = outcomes.some((o: string) => 
      o.toLowerCase().includes(winning) || winning.includes(o.toLowerCase())
    );
    
    if (!inOutcomes && outcomes.length === 2) {
      const key = `TEAM_MISMATCH → [${outcomes.join(', ')}]`;
      if (!patterns[key]) patterns[key] = { count: 0, examples: [] };
      patterns[key].count++;
      if (patterns[key].examples.length < 3) {
        patterns[key].examples.push({
          winning,
          outcomes,
          question: m.question.substring(0, 60)
        });
      }
    }

    // Pattern 3: Multi-outcome markets
    if (outcomes.length > 2) {
      const key = `MULTI_OUTCOME (${outcomes.length} options)`;
      if (!patterns[key]) patterns[key] = { count: 0, examples: [] };
      patterns[key].count++;
      if (patterns[key].examples.length < 3) {
        patterns[key].examples.push({
          winning,
          outcomes: outcomes.slice(0, 3), // First 3 only
          question: m.question.substring(0, 60)
        });
      }
    }
  }

  // Sort patterns by count
  const sortedPatterns = Object.entries(patterns)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15);

  console.log('📊 Top Mismatch Patterns:\n');
  sortedPatterns.forEach(([pattern, data], i) => {
    console.log(`${i + 1}. ${pattern}: ${data.count} occurrences`);
    data.examples.forEach((ex, j) => {
      console.log(`   ${j + 1}) Winning: "${ex.winning}" | Outcomes: [${ex.outcomes.join(', ')}]`);
      console.log(`      Question: ${ex.question}...`);
    });
    console.log('');
  });

  // Check specific binary pattern frequencies
  console.log('\n📊 Binary Outcome Pattern Analysis:\n');
  
  const binaryPatterns = await ch.query({
    query: `
      WITH mismatches AS (
        SELECT
          rc.outcome as winning_text,
          m.outcomes as outcome_array,
          m.question
        FROM default.resolution_candidates rc
        INNER JOIN (
          SELECT
            lower(replaceAll(condition_id, '0x', '')) as condition_id,
            outcomes,
            question
          FROM default.api_markets_staging
          WHERE length(outcomes) > 0 AND length(outcomes) = 2
        ) m ON rc.condition_id_norm = m.condition_id
        WHERE rc.confidence >= 0.9
          AND rc.condition_id_norm NOT IN (
            SELECT condition_id FROM default.resolutions_external_ingest
          )
      )
      SELECT
        outcome_array,
        COUNT(*) as count
      FROM mismatches
      GROUP BY outcome_array
      ORDER BY count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const binaries = await binaryPatterns.json();
  console.log('Most common binary outcome arrays:');
  binaries.forEach((b: any, i: number) => {
    console.log(`  ${i + 1}. [${b.outcome_array.join(', ')}]: ${b.count} markets`);
  });

  await ch.close();
})();
