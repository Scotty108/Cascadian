#!/usr/bin/env tsx
/**
 * Extract Token Test Fixtures
 *
 * Purpose: Get known-good token ID pairs from gamma_markets
 * for testing hex↔decimal conversion
 *
 * Output: __tests__/fixtures/token-pairs.json
 */

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

interface TokenPair {
  token_id_decimal: string;
  condition_id: string;
  market_slug: string;
  outcome_index: number;
  outcome_name: string;
}

async function main() {
  console.log('🔍 Extracting token test fixtures from gamma_markets...\n');

  // Get sample token pairs from gamma_markets
  const query = `
    SELECT
      arrayElement(tokens, idx) as token_id_decimal,
      condition_id,
      market_slug,
      idx - 1 as outcome_index,
      arrayElement(outcomes, idx) as outcome_name
    FROM gamma_markets
    ARRAY JOIN arrayEnumerate(tokens) as idx
    WHERE tokens IS NOT NULL
      AND length(tokens) > 0
      AND market_slug IS NOT NULL
    ORDER BY RAND()
    LIMIT 100
  `;

  console.log('Running query to extract 100 random token pairs...');

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const pairs = await result.json<TokenPair[]>();

  console.log(`\n✅ Extracted ${pairs.length} token pairs\n`);

  // Show sample
  console.log('Sample fixtures:');
  pairs.slice(0, 3).forEach((pair, i) => {
    console.log(`\n${i + 1}. ${pair.market_slug}`);
    console.log(`   Outcome: ${pair.outcome_name} (index ${pair.outcome_index})`);
    console.log(`   Token ID (decimal): ${pair.token_id_decimal.substring(0, 30)}...`);
    console.log(`   Condition ID: ${pair.condition_id.substring(0, 20)}...`);
  });

  // Create fixtures directory if it doesn't exist
  const fixturesDir = path.join(process.cwd(), '__tests__', 'fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  // Write to file
  const outputPath = path.join(fixturesDir, 'token-pairs.json');
  fs.writeFileSync(outputPath, JSON.stringify(pairs, null, 2));

  console.log(`\n📝 Wrote fixtures to: ${outputPath}`);
  console.log(`\nStatistics:`);
  console.log(`  Total pairs: ${pairs.length}`);
  console.log(`  Unique conditions: ${new Set(pairs.map(p => p.condition_id)).size}`);
  console.log(`  Unique markets: ${new Set(pairs.map(p => p.market_slug)).size}`);

  // Extract one sample for manual verification
  const sample = pairs[0];
  console.log(`\n🔬 Sample for manual testing:`);
  console.log(`   Decimal: ${sample.token_id_decimal}`);
  console.log(`   Market: ${sample.market_slug}`);
  console.log(`   Outcome: ${sample.outcome_name}`);
}

main().catch(console.error);
