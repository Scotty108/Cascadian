#!/usr/bin/env tsx
/**
 * Re-enrich Existing Markets (NO API CALLS)
 *
 * Reads markets from ClickHouse, applies V3 enrichment (context-aware + domain filtering), updates in-place
 * Uses ReplacingMergeTree idempotency - just insert with new ingested_at timestamp
 *
 * V3 Enrichment Features:
 * - Context-aware category priority (Sports > Politics in sports context)
 * - Domain filtering (skip political keywords in sports markets)
 * - Whole-word matching for "vance" and "mcconnell"
 * - Fixes false matches: "To Advance" → vance, "T.J. McConnell" → McConnell
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { enrichMarketTags } from './enrich-market-tags-v2';

async function reEnrichMarkets() {
  console.log('\n🔄 RE-ENRICHING EXISTING MARKETS (NO API CALLS)\n');
  console.log('='.repeat(80));

  // Step 1: Count total markets
  const countResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM pm_market_metadata',
    format: 'JSONEachRow',
  });
  const countData = await countResult.json<{ count: string }>();
  const totalMarkets = parseInt(countData[0].count);
  console.log(`📊 Total markets to re-enrich: ${totalMarkets.toLocaleString()}\n`);

  // Step 2: Process in batches
  const BATCH_SIZE = 1000;
  let processed = 0;

  console.log('🔧 Processing batches...\n');

  while (processed < totalMarkets) {
    // Fetch batch
    const batchResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          market_id,
          slug,
          question,
          tags,
          category
        FROM pm_market_metadata
        ORDER BY condition_id
        LIMIT ${BATCH_SIZE} OFFSET ${processed}
      `,
      format: 'JSONEachRow',
    });
    const batch = await batchResult.json<any>();

    if (batch.length === 0) break;

    // Re-enrich each market
    const updates: any[] = [];
    for (const market of batch) {
      // Apply V3 enrichment (context-aware + domain filtering + whole-word matching)
      // START FRESH: Don't use canonical_tags (they're corrupted with V2 enrichment)
      // Let the enrichment function rebuild tags from scratch based on question + slug
      const enrichmentResult = enrichMarketTags(
        market.question || '',
        [],  // START FRESH with empty tags - let enrichment rebuild everything
        market.slug || ''
      );

      updates.push({
        condition_id: market.condition_id,
        enriched_category: enrichmentResult.category,
        enriched_tags: enrichmentResult.enrichedTags,
        enrichment_version: 3,  // V3 FIXED: context-aware + domain filtering (politics AND tech) + improved context detection
        ingested_at: Date.now(),
      });
    }

    // Bulk update via ReplacingMergeTree (insert with new timestamp)
    await bulkUpdate(updates);

    processed += batch.length;
    console.log(`   ✅ Processed ${processed.toLocaleString()} / ${totalMarkets.toLocaleString()} markets`);

    // Rate limiting (be gentle on ClickHouse)
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Re-enrichment complete!\n');
}

/**
 * Bulk update markets by inserting with new ingested_at
 * ReplacingMergeTree will keep the latest version
 */
async function bulkUpdate(updates: any[]) {
  if (updates.length === 0) return;

  const values = updates.map(u => {
    const tagsArray = `[${u.enriched_tags.map((t: string) => `'${t.replace(/'/g, "\\'")}'`).join(', ')}]`;
    return `('${u.condition_id}', '${u.enriched_category}', ${tagsArray}, ${u.enrichment_version}, ${u.ingested_at})`;
  }).join(',\n');

  const query = `
    INSERT INTO pm_market_metadata (condition_id, enriched_category, enriched_tags, enrichment_version, ingested_at)
    VALUES ${values}
  `;

  await clickhouse.command({ query });
}

reEnrichMarkets()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  });
