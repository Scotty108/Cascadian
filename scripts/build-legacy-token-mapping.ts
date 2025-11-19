#!/usr/bin/env npx tsx
/**
 * BUILD LEGACY TOKEN→CONDITION ID MAPPING FROM POLYMARKET API
 *
 * Phase 1: Extract wallet 0x9155e8cf's condition IDs and map them to canonical IDs
 *
 * Estimated time: 30-60 minutes (17,137 API calls + processing)
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';
const BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 100; // 10 requests/second to avoid rate limits

interface TokenMapping {
  token_id: string;
  condition_id: string;
  market_slug?: string;
  question?: string;
  source: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMarketByConditionId(conditionId: string): Promise<TokenMapping | null> {
  try {
    // Try Polymarket Markets API
    const url = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Market not found
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      const market = data[0];
      return {
        token_id: conditionId,
        condition_id: market.condition_id || conditionId,
        market_slug: market.market_slug,
        question: market.question,
        source: 'gamma_api',
      };
    }

    return null;
  } catch (error) {
    console.error(`Error fetching ${conditionId}:`, error);
    return null;
  }
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('PHASE 1: BUILD LEGACY TOKEN→CONDITION ID MAPPING');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Extract unique condition IDs from wallet
  console.log('Step 1: Extracting unique condition IDs from wallet...\n');

  const conditionIds = await ch.query({
    query: `
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as condition_id
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${WALLET}')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ORDER BY condition_id
    `,
    format: 'JSONEachRow',
  });
  const ids = await conditionIds.json<{ condition_id: string }[]>();

  console.log(`✓ Found ${ids.length.toLocaleString()} unique condition IDs\n`);

  // Step 2: Create mapping table
  console.log('Step 2: Creating legacy_token_condition_map table...\n');

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS default.legacy_token_condition_map (
        token_id String,
        condition_id String,
        market_slug Nullable(String),
        question Nullable(String),
        source String,
        created_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(created_at)
      ORDER BY (token_id)
    `
  });

  console.log('✓ Table created\n');

  // Step 3: Fetch mappings from API in batches
  console.log(`Step 3: Fetching mappings from Polymarket API (${ids.length.toLocaleString()} requests)...\n`);
  console.log(`Batch size: ${BATCH_SIZE} | Delay: ${REQUEST_DELAY_MS}ms between requests\n`);

  const mappings: TokenMapping[] = [];
  let successCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i].condition_id;

    // Progress indicator
    if (i % 100 === 0) {
      console.log(`Progress: ${i}/${ids.length} (${((i/ids.length)*100).toFixed(1)}%) | Success: ${successCount} | Not Found: ${notFoundCount} | Errors: ${errorCount}`);
    }

    const mapping = await fetchMarketByConditionId(id);

    if (mapping) {
      mappings.push(mapping);
      successCount++;
    } else {
      notFoundCount++;
    }

    // Rate limit delay
    if (i % 10 === 0) {
      await sleep(REQUEST_DELAY_MS);
    }

    // Batch insert every BATCH_SIZE records
    if (mappings.length >= BATCH_SIZE) {
      await ch.insert({
        table: 'default.legacy_token_condition_map',
        values: mappings,
        format: 'JSONEachRow',
      });
      mappings.length = 0; // Clear array
    }
  }

  // Insert remaining mappings
  if (mappings.length > 0) {
    await ch.insert({
      table: 'default.legacy_token_condition_map',
      values: mappings,
      format: 'JSONEachRow',
    });
  }

  console.log(`\n✓ API fetch complete\n`);
  console.log(`Results:`);
  console.log(`  Success: ${successCount.toLocaleString()}`);
  console.log(`  Not Found: ${notFoundCount.toLocaleString()}`);
  console.log(`  Errors: ${errorCount.toLocaleString()}`);
  console.log(`  Total: ${ids.length.toLocaleString()}\n`);

  // Step 4: Verify mapping table
  console.log('Step 4: Verifying mapping table...\n');

  const verification = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_mappings,
        COUNT(DISTINCT token_id) as unique_tokens,
        COUNT(DISTINCT condition_id) as unique_conditions
      FROM default.legacy_token_condition_map
    `,
    format: 'JSONEachRow',
  });
  const verif = await verification.json<any[]>();

  console.log(`Total mappings: ${parseInt(verif[0].total_mappings).toLocaleString()}`);
  console.log(`Unique token IDs: ${parseInt(verif[0].unique_tokens).toLocaleString()}`);
  console.log(`Unique condition IDs: ${parseInt(verif[0].unique_conditions).toLocaleString()}\n`);

  // Sample data
  const sample = await ch.query({
    query: `SELECT * FROM default.legacy_token_condition_map LIMIT 3`,
    format: 'JSONEachRow',
  });
  const sampleData = await sample.json<any[]>();

  console.log('Sample mappings:');
  sampleData.forEach((row, i) => {
    console.log(`\n${i+1}.`);
    console.log(`   Token ID:     ${row.token_id}`);
    console.log(`   Condition ID: ${row.condition_id}`);
    console.log(`   Market:       ${row.market_slug || 'N/A'}`);
    console.log(`   Question:     ${row.question?.substring(0, 60) || 'N/A'}...`);
  });

  console.log('\n═'.repeat(80));
  console.log('PHASE 1 COMPLETE');
  console.log('═'.repeat(80));
  console.log(`\n✅ Successfully created ${successCount.toLocaleString()} token→condition mappings`);
  console.log(`⚠️  ${notFoundCount.toLocaleString()} condition IDs not found in API (may be archived/delisted)\n`);
  console.log('Next step: Run Phase 2 (Update P&L views)\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
