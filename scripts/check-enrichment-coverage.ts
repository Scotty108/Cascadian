#!/usr/bin/env npx tsx

/**
 * Check Enrichment Coverage in dim_markets
 *
 * Validates that MKM and CMM enrichment fields are populated correctly.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('🔍 Checking enrichment coverage in dim_markets\n');

  // Step 1: Overall field coverage
  console.log('Step 1: Overall field coverage...');

  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(market_id != '') as with_market_id,
        countIf(question != '') as with_question,
        countIf(category != '') as with_category,
        countIf(resolved_at IS NOT NULL) as with_resolved_at,
        countIf(event_id != '' AND event_id IS NOT NULL) as with_event_id,
        countIf(length(outcomes) > 0) as with_outcomes,
        countIf(description != '') as with_description
      FROM default.dim_markets
    `,
    format: 'JSONEachRow'
  });

  const coverage = await coverageResult.json<Array<any>>();
  const c = coverage[0];
  const total = parseInt(c.total);

  console.log(`  Total markets: ${total.toLocaleString()}`);
  console.log(`  With market_id: ${parseInt(c.with_market_id).toLocaleString()} (${(parseInt(c.with_market_id)/total*100).toFixed(1)}%)`);
  console.log(`  With question: ${parseInt(c.with_question).toLocaleString()} (${(parseInt(c.with_question)/total*100).toFixed(1)}%)`);
  console.log(`  With category: ${parseInt(c.with_category).toLocaleString()} (${(parseInt(c.with_category)/total*100).toFixed(1)}%)`);
  console.log(`  With resolved_at: ${parseInt(c.with_resolved_at).toLocaleString()} (${(parseInt(c.with_resolved_at)/total*100).toFixed(1)}%)`);
  console.log(`  With event_id: ${parseInt(c.with_event_id).toLocaleString()} (${(parseInt(c.with_event_id)/total*100).toFixed(1)}%)`);
  console.log(`  With outcomes: ${parseInt(c.with_outcomes).toLocaleString()} (${(parseInt(c.with_outcomes)/total*100).toFixed(1)}%)`);
  console.log(`  With description: ${parseInt(c.with_description).toLocaleString()} (${(parseInt(c.with_description)/total*100).toFixed(1)}%)\n`);

  // Step 2: Sample markets with resolved_at
  console.log('Step 2: Sample markets with resolved_at (MKM enrichment)...');

  const resolvedResult = await clickhouse.query({
    query: `
      SELECT
        substring(condition_id_norm, 1, 12) as cid_preview,
        market_id,
        substring(question, 1, 50) as question_preview,
        resolved_at
      FROM default.dim_markets
      WHERE resolved_at IS NOT NULL
      ORDER BY resolved_at DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const resolvedRows = await resolvedResult.json<Array<any>>();

  resolvedRows.forEach((r, i) => {
    console.log(`\n  ${i + 1}. ${r.question_preview}...`);
    console.log(`     Condition: ${r.cid_preview}...`);
    console.log(`     Market ID: ${r.market_id.substring(0, 20)}...`);
    console.log(`     Resolved: ${r.resolved_at}`);
  });

  // Step 3: Sample markets with event_id
  console.log('\n\nStep 3: Sample markets with event_id (CMM enrichment)...');

  const eventResult = await clickhouse.query({
    query: `
      SELECT
        substring(condition_id_norm, 1, 12) as cid_preview,
        market_id,
        substring(question, 1, 50) as question_preview,
        event_id,
        category
      FROM default.dim_markets
      WHERE event_id != '' AND event_id IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const eventRows = await eventResult.json<Array<any>>();

  if (eventRows.length > 0) {
    eventRows.forEach((r, i) => {
      console.log(`\n  ${i + 1}. ${r.question_preview}...`);
      console.log(`     Condition: ${r.cid_preview}...`);
      console.log(`     Event ID: ${r.event_id}`);
      console.log(`     Category: ${r.category || 'N/A'}`);
    });
  } else {
    console.log('  ⚠️  No markets with event_id found');
  }

  console.log('\n\n✅ Enrichment coverage check complete!\n');
}

main().catch(console.error);
