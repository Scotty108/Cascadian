/**
 * Universal Token Mapping Fix
 *
 * This script:
 * 1. Identifies all unmapped tokens in pm_trader_events_v3
 * 2. Fetches condition_id from Gamma API for each token
 * 3. Inserts new mappings directly into pm_token_to_condition_map_v5
 * 4. Verifies 100% coverage after completion
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

interface TokenInfo {
  token_id: string;
  condition_id: string;
  outcome_index: number;
  question: string;
}

async function fetchTokenFromGamma(tokenId: string): Promise<TokenInfo | null> {
  try {
    const url = `${GAMMA_API_BASE}/markets?token_id=${tokenId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as any[];

    if (!data || data.length === 0) {
      return null;
    }

    const market = data[0];
    const tokenIds = market.tokens?.map((t: any) => t.token_id) || [];
    const outcomeIndex = tokenIds.indexOf(tokenId);

    if (outcomeIndex === -1) {
      return null;
    }

    return {
      token_id: tokenId,
      condition_id: market.condition_id,
      outcome_index: outcomeIndex,
      question: market.question || 'Unknown market',
    };
  } catch (error) {
    console.error(`Error fetching token ${tokenId}:`, error);
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(80));
  console.log('UNIVERSAL TOKEN MAPPING FIX');
  console.log('='.repeat(80));

  // Step 1: Get all unmapped tokens
  console.log('\nStep 1: Finding unmapped tokens in pm_trader_events_v3...');

  const unmappedResult = await clickhouse.query({
    query: `
      SELECT DISTINCT t.token_id
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE m.condition_id IS NULL OR m.condition_id = ''
    `,
    format: 'JSONEachRow',
  });

  const unmappedTokens = await unmappedResult.json() as { token_id: string }[];
  console.log(`Found ${unmappedTokens.length} unmapped tokens`);

  if (unmappedTokens.length === 0) {
    console.log('\n✅ All tokens are already mapped!');
    return;
  }

  // Step 2: Fetch condition_id from Gamma API for each token
  console.log('\nStep 2: Fetching token info from Gamma API...');

  const newMappings: TokenInfo[] = [];
  const failedTokens: string[] = [];
  let processed = 0;

  for (const row of unmappedTokens) {
    const tokenId = row.token_id;
    const info = await fetchTokenFromGamma(tokenId);

    if (info) {
      newMappings.push(info);
    } else {
      failedTokens.push(tokenId);
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(`  Processed ${processed}/${unmappedTokens.length} tokens (${newMappings.length} found, ${failedTokens.length} failed)`);
    }

    // Rate limit: 10 requests per second
    await sleep(100);
  }

  console.log(`\nFetched ${newMappings.length} tokens successfully`);
  console.log(`Failed to fetch ${failedTokens.length} tokens`);

  if (newMappings.length === 0) {
    console.log('\n❌ No new mappings found. Cannot proceed.');
    return;
  }

  // Step 3: Insert new mappings into pm_token_to_condition_map_v5
  console.log('\nStep 3: Inserting new mappings into pm_token_to_condition_map_v5...');

  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < newMappings.length; i += batchSize) {
    const batch = newMappings.slice(i, i + batchSize);

    const values = batch.map(m => {
      // Escape single quotes in question
      const escapedQuestion = m.question.replace(/'/g, "''");
      return `('${m.token_id}', '${m.condition_id}', ${m.outcome_index}, '${escapedQuestion}', 'gamma-backfill')`;
    }).join(',');

    await clickhouse.command({
      query: `
        INSERT INTO pm_token_to_condition_map_v5
        (token_id_dec, condition_id, outcome_index, question, category)
        VALUES ${values}
      `,
    });

    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${newMappings.length}...`);
  }

  console.log(`\n✅ Inserted ${inserted} new mappings`);

  // Step 4: Verify coverage
  console.log('\nStep 4: Verifying coverage...');

  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        count(DISTINCT t.token_id) as total_tokens,
        countIf(m.condition_id IS NOT NULL AND m.condition_id != '') as mapped_tokens,
        countIf(m.condition_id IS NULL OR m.condition_id = '') as unmapped_tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    `,
    format: 'JSONEachRow',
  });

  const coverage = (await coverageResult.json() as any[])[0];
  console.log('\nCoverage Results:');
  console.log(`  Total tokens: ${coverage.total_tokens}`);
  console.log(`  Mapped tokens: ${coverage.mapped_tokens}`);
  console.log(`  Unmapped tokens: ${coverage.unmapped_tokens}`);
  console.log(`  Coverage: ${((coverage.mapped_tokens / coverage.total_tokens) * 100).toFixed(2)}%`);

  if (coverage.unmapped_tokens === 0) {
    console.log('\n✅ 100% token coverage achieved!');
  } else {
    console.log(`\n⚠️ Still have ${coverage.unmapped_tokens} unmapped tokens`);
    if (failedTokens.length > 0) {
      console.log('\nFailed tokens (first 20):');
      failedTokens.slice(0, 20).forEach(t => console.log(`  ${t}`));
    }
  }

  console.log('\n✅ Token mapping fix complete!');
}

main().catch(console.error);
