/**
 * Build FPMM Pool → Condition ID mapping from Gamma API
 *
 * This creates the mapping table needed to link FPMM trades to markets
 * for PnL calculation.
 *
 * Terminal: Claude 3
 * Date: 2025-11-25
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const BATCH_SIZE = 500; // Gamma API max is 500
const MAX_PAGES = 500; // Safety limit (500 * 500 = 250k markets max)

interface GammaMarket {
  conditionId: string;
  marketMakerAddress: string;
  question: string;
  slug?: string;
}

async function fetchMarkets(offset: number): Promise<GammaMarket[]> {
  const url = `${GAMMA_API_BASE}/markets?offset=${offset}&limit=${BATCH_SIZE}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Gamma API error: ${response.status}`);
  }
  return response.json();
}

async function buildMapping() {
  console.log('\n🔧 Building FPMM Pool → Condition ID Mapping\n');
  console.log('='.repeat(80));

  // Step 1: Create the mapping table
  console.log('\n📊 Step 1: Creating pm_fpmm_pool_map table\n');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_fpmm_pool_map (
        fpmm_pool_address String,
        condition_id String,
        question String,
        created_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(created_at)
      ORDER BY (fpmm_pool_address)
    `
  });
  console.log('   ✅ Table created');

  // Step 2: Fetch all markets from Gamma API
  console.log('\n📊 Step 2: Fetching markets from Gamma API\n');

  let page = 0;
  let totalFetched = 0;
  let totalWithFPMM = 0;
  let consecutiveEmpty = 0;
  const mappings: Array<{ pool: string; condition: string; question: string }> = [];

  while (page < MAX_PAGES) {
    const offset = page * BATCH_SIZE;
    process.stdout.write(`   Page ${page + 1} (offset ${offset})...`);

    try {
      const markets = await fetchMarkets(offset);
      totalFetched += markets.length;

      if (markets.length === 0) {
        consecutiveEmpty++;
        console.log(' empty');
        if (consecutiveEmpty >= 3) {
          console.log('   (3 consecutive empty pages, stopping)');
          break;
        }
        page++;
        continue;
      }

      consecutiveEmpty = 0; // Reset on non-empty

      // Extract mappings where marketMakerAddress exists
      let pageWithFPMM = 0;
      for (const market of markets) {
        if (market.marketMakerAddress && market.conditionId) {
          totalWithFPMM++;
          pageWithFPMM++;
          mappings.push({
            pool: market.marketMakerAddress.toLowerCase(),
            condition: market.conditionId.toLowerCase().replace('0x', ''),
            question: (market.question || '').slice(0, 500) // Truncate long questions
          });
        }
      }

      console.log(` got ${markets.length} (${pageWithFPMM} with FPMM, total: ${totalWithFPMM})`);

      if (markets.length < BATCH_SIZE) {
        console.log('   (last page - fewer than batch size)');
        break;
      }

      page++;

      // Rate limiting - be nice to the API
      await new Promise(resolve => setTimeout(resolve, 150));

    } catch (error) {
      console.log(` error: ${error}`);
      // Retry once after a delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }
  }

  console.log(`\n   Total markets fetched: ${totalFetched.toLocaleString()}`);
  console.log(`   Markets with FPMM address: ${totalWithFPMM.toLocaleString()}`);

  // Step 3: Insert mappings into ClickHouse
  console.log('\n📊 Step 3: Inserting mappings into ClickHouse\n');

  if (mappings.length > 0) {
    // Truncate and rebuild
    await clickhouse.command({ query: 'TRUNCATE TABLE pm_fpmm_pool_map' });
    console.log('   Truncated existing data');

    // Insert in batches
    const INSERT_BATCH = 5000;
    for (let i = 0; i < mappings.length; i += INSERT_BATCH) {
      const batch = mappings.slice(i, i + INSERT_BATCH);

      await clickhouse.insert({
        table: 'pm_fpmm_pool_map',
        values: batch.map(m => ({
          fpmm_pool_address: m.pool,
          condition_id: m.condition,
          question: m.question
        })),
        format: 'JSONEachRow'
      });

      console.log(`   Inserted ${Math.min(i + INSERT_BATCH, mappings.length).toLocaleString()} / ${mappings.length.toLocaleString()}`);
    }
    console.log(`   ✅ Inserted ${mappings.length.toLocaleString()} mappings`);
  } else {
    console.log('   ⚠️ No mappings to insert!');
  }

  // Step 4: Verify
  console.log('\n📊 Step 4: Verifying mapping table\n');

  const countResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_fpmm_pool_map',
    format: 'JSONEachRow'
  });
  const count = await countResult.json<{ cnt: string }>();
  console.log(`   Total mappings in table: ${parseInt(count[0]?.cnt || '0').toLocaleString()}`);

  // Sample
  const sampleResult = await clickhouse.query({
    query: `
      SELECT fpmm_pool_address, condition_id, substring(question, 1, 50) as question_preview
      FROM pm_fpmm_pool_map
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json();
  console.log('\n   Sample mappings:');
  samples.forEach((s: any) => {
    console.log(`   - ${s.fpmm_pool_address.slice(0, 20)}... → ${s.condition_id.slice(0, 16)}... "${s.question_preview}..."`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ FPMM POOL MAPPING COMPLETE\n');

  await clickhouse.close();
}

buildMapping()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
