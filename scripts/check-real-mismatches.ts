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
  console.log('\n🔍 Checking Real Outcome Mismatches...\n');

  // Get sample of resolution_candidates that weren't converted
  const sample = await ch.query({
    query: `
      SELECT
        rc.condition_id_norm,
        rc.outcome as winning_text,
        rc.source,
        rc.confidence
      FROM default.resolution_candidates rc
      WHERE rc.confidence >= 0.9
        AND rc.condition_id_norm NOT IN (
          SELECT condition_id FROM default.resolutions_external_ingest
        )
        AND rc.outcome != 'invalid'
      LIMIT 100
    `,
    format: 'JSONEachRow',
  });

  const candidates = await sample.json();
  console.log(`Found ${candidates.length} non-invalid candidates without payouts\n`);

  // Group by outcome text
  const outcomeFreq: Record<string, number> = {};
  candidates.forEach((c: any) => {
    const outcome = c.winning_text?.toLowerCase() || 'null';
    outcomeFreq[outcome] = (outcomeFreq[outcome] || 0) + 1;
  });

  console.log('📊 Outcome text frequency:\n');
  Object.entries(outcomeFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([outcome, count]) => {
      console.log(`  ${outcome}: ${count}`);
    });

  // Now join with api_markets_staging to see the actual mismatches
  console.log('\n📊 Sample mismatches with market context:\n');
  
  const detailed = await ch.query({
    query: `
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
        WHERE length(outcomes) > 0
      ) m ON rc.condition_id_norm = m.condition_id
      WHERE rc.confidence >= 0.9
        AND rc.condition_id_norm NOT IN (
          SELECT condition_id FROM default.resolutions_external_ingest
        )
        AND rc.outcome != 'invalid'
        AND length(m.outcomes) = 2
      LIMIT 50
    `,
    format: 'JSONEachRow',
  });

  const details = await detailed.json();
  
  console.log(`Found ${details.length} binary market mismatches:\n`);
  
  details.slice(0, 20).forEach((d: any, i: number) => {
    console.log(`${i + 1}. Winning: "${d.winning_text}" | Outcomes: [${d.outcome_array.join(', ')}]`);
    console.log(`   Market: ${d.question.substring(0, 70)}...`);
  });

  await ch.close();
})();
