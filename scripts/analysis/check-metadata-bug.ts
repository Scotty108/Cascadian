#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function checkMetadataBug() {
  console.log('=== Checking Metadata Bug ===\n');

  // Check Trump election condition
  const trumpResult = await clickhouse.query({
    query: `
      SELECT condition_id, question, tags
      FROM pm_market_metadata
      WHERE condition_id = 'dd22472e552920b8438158ea7238bfad83e97f5abffbf0c77f9469cf0cb030b0'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const trumpRows = (await trumpResult.json()) as any[];
  console.log('Trump election market metadata:');
  console.log(JSON.stringify(trumpRows, null, 2));
  console.log();

  // Check how many rows match bitcoin
  const btcCountResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id) as total
      FROM pm_market_metadata
      WHERE (question ILIKE '%bitcoin%' OR question ILIKE '%btc%')
        AND NOT (question ILIKE '%dota%')
        AND volume_usdc > 1000
    `,
    format: 'JSONEachRow'
  });

  const btcCount = (await btcCountResult.json()) as any[];
  console.log(`Bitcoin markets in metadata: ${btcCount[0].total}`);

  // Sample some "Bitcoin" markets
  const sampleResult = await clickhouse.query({
    query: `
      SELECT condition_id, question
      FROM (
        SELECT condition_id, any(question) as question
        FROM pm_market_metadata
        WHERE (question ILIKE '%bitcoin%' OR question ILIKE '%btc%')
          AND NOT (question ILIKE '%dota%')
          AND volume_usdc > 1000
        GROUP BY condition_id
      )
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = (await sampleResult.json()) as any[];
  console.log('\nSample "Bitcoin" markets:');
  samples.forEach((s, i) => {
    console.log(`${i + 1}. ${s.question.slice(0, 100)}`);
  });
}

checkMetadataBug().catch(console.error);
