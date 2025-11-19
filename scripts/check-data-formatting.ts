#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('DATA FORMATTING VERIFICATION');
  console.log('═'.repeat(80));
  console.log();

  // Check blockchain data formatting
  console.log('1. BLOCKCHAIN DATA - Sample 5 recent records');
  console.log('─'.repeat(80));
  
  const blockchain = await client.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index,
        outcome_count,
        version,
        source,
        length(condition_id_norm) as id_length
      FROM default.market_resolutions_final
      WHERE source = 'blockchain'
      ORDER BY updated_at DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const bcData = await blockchain.json<any[]>();
  bcData.forEach((row, idx) => {
    console.log(`Record ${idx + 1}:`);
    console.log(`  condition_id: ${row.condition_id_norm} (length: ${row.id_length})`);
    console.log(`  payout_numerators: [${row.payout_numerators.join(', ')}]`);
    console.log(`  payout_denominator: ${row.payout_denominator}`);
    console.log(`  winning_index: ${row.winning_index}`);
    console.log(`  outcome_count: ${row.outcome_count}`);
    console.log(`  version: ${row.version}`);
    console.log(`  source: ${row.source}`);
    console.log();
  });

  // Check API data formatting (if exists)
  console.log('2. API BACKFILL DATA - Sample 5 records');
  console.log('─'.repeat(80));
  
  try {
    const api = await client.query({
      query: `
        SELECT
          condition_id,
          question,
          outcomes_json,
          winning_outcome,
          resolved,
          category,
          length(condition_id) as id_length,
          length(outcomes_json) as outcomes_length
        FROM default.api_market_backfill
        ORDER BY fetched_at DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });

    const apiData = await api.json<any[]>();
    if (apiData.length > 0) {
      apiData.forEach((row, idx) => {
        console.log(`Record ${idx + 1}:`);
        console.log(`  condition_id: ${row.condition_id} (length: ${row.id_length})`);
        console.log(`  question: ${row.question.substring(0, 50)}...`);
        console.log(`  outcomes: ${row.outcomes_json}`);
        console.log(`  winning_outcome: ${row.winning_outcome}`);
        console.log(`  resolved: ${row.resolved}`);
        console.log(`  category: ${row.category}`);
        console.log();
      });
    } else {
      console.log('No API data yet (still fetching)');
      console.log();
    }
  } catch (error: any) {
    console.log('API backfill table not populated yet');
    console.log();
  }

  // Validate data quality
  console.log('3. DATA QUALITY CHECKS');
  console.log('─'.repeat(80));
  
  const quality = await client.query({
    query: `
      SELECT
        source,
        count(*) as total_records,
        countIf(length(condition_id_norm) = 64) as valid_id_length,
        countIf(payout_denominator > 0) as valid_denominator,
        countIf(length(payout_numerators) > 0) as has_numerators,
        countIf(winning_index >= 0 AND winning_index < 100) as valid_winning_index
      FROM default.market_resolutions_final
      GROUP BY source
    `,
    format: 'JSONEachRow',
  });

  const qData = await quality.json<any[]>();
  qData.forEach(row => {
    console.log(`Source: ${row.source}`);
    console.log(`  Total records: ${row.total_records.toLocaleString()}`);
    console.log(`  Valid ID length (64 chars): ${row.valid_id_length.toLocaleString()} (${(100*row.valid_id_length/row.total_records).toFixed(1)}%)`);
    console.log(`  Valid denominator (> 0): ${row.valid_denominator.toLocaleString()} (${(100*row.valid_denominator/row.total_records).toFixed(1)}%)`);
    console.log(`  Has payout numerators: ${row.has_numerators.toLocaleString()} (${(100*row.has_numerators/row.total_records).toFixed(1)}%)`);
    console.log(`  Valid winning index: ${row.valid_winning_index.toLocaleString()} (${(100*row.valid_winning_index/row.total_records).toFixed(1)}%)`);
    console.log();
  });

  console.log('═'.repeat(80));
  await client.close();
}

main().catch(console.error);
