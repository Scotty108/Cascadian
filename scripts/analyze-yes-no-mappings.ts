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
  console.log('\n🔍 Analyzing YES/NO → Binary Outcome Mappings...\n');

  // Get YES/NO outcomes that didn't match
  const yesNoMarkets = await ch.query({
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
        AND lower(rc.outcome) IN ('yes', 'no')
        AND length(m.outcomes) = 2
      LIMIT 200
    `,
    format: 'JSONEachRow',
  });

  const markets = await yesNoMarkets.json();
  
  console.log(`Found ${markets.length} YES/NO mismatches with binary outcomes\n`);

  // Group by outcome array
  const outcomeArrays: Record<string, { count: number; examples: any[] }> = {};
  
  markets.forEach((m: any) => {
    const key = JSON.stringify(m.outcome_array);
    if (!outcomeArrays[key]) outcomeArrays[key] = { count: 0, examples: [] };
    outcomeArrays[key].count++;
    if (outcomeArrays[key].examples.length < 3) {
      outcomeArrays[key].examples.push({
        winning: m.winning_text,
        question: m.question.substring(0, 70)
      });
    }
  });

  // Sort by frequency
  const sorted = Object.entries(outcomeArrays)
    .sort((a, b) => b[1].count - a[1].count);

  console.log('📊 YES/NO outcomes by target array:\n');
  sorted.forEach(([arrayJson, data], i) => {
    const array = JSON.parse(arrayJson);
    console.log(`${i + 1}. [${array.join(', ')}]: ${data.count} markets`);
    data.examples.forEach((ex, j) => {
      console.log(`   ${j + 1}) Winning: "${ex.winning}" | Question: ${ex.question}...`);
    });
    console.log('');
  });

  await ch.close();
})();
