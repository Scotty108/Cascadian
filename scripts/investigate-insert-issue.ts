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
  console.log('\n🔍 Investigating Insert Issue...\n');

  // 1. Check for empty or malformed condition_ids
  const malformed = await ch.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN length(condition_id) = 0 THEN 1 ELSE 0 END) as empty,
        SUM(CASE WHEN length(condition_id) != 64 THEN 1 ELSE 0 END) as wrong_length,
        SUM(CASE WHEN condition_id LIKE '%0x%' THEN 1 ELSE 0 END) as has_0x_prefix
      FROM default.resolutions_external_ingest
    `,
    format: 'JSONEachRow',
  });
  const mal = await malformed.json();
  console.log('1. Data quality check:');
  console.log(`   Total rows: ${mal[0].total}`);
  console.log(`   Empty condition_ids: ${mal[0].empty}`);
  console.log(`   Wrong length (!= 64): ${mal[0].wrong_length}`);
  console.log(`   Has 0x prefix: ${mal[0].has_0x_prefix}`);

  // 2. Check how many resolution_candidates actually had unique condition_ids
  const candidateStats = await ch.query({
    query: `
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT condition_id_norm) as unique_cids
      FROM default.resolution_candidates
      WHERE confidence >= 0.9
    `,
    format: 'JSONEachRow',
  });
  const candStats = await candidateStats.json();
  console.log('\n2. Resolution candidates stats:');
  console.log(`   Total high-confidence candidates: ${candStats[0].total}`);
  console.log(`   Unique condition_ids: ${candStats[0].unique_cids}`);

  // 3. Check how many of those matched api_markets_staging
  const matchStats = await ch.query({
    query: `
      WITH candidates AS (
        SELECT DISTINCT condition_id_norm
        FROM default.resolution_candidates
        WHERE confidence >= 0.9
      )
      SELECT
        COUNT(*) as total_unique_candidates,
        SUM(CASE WHEN m.condition_id IS NOT NULL THEN 1 ELSE 0 END) as matched_in_api_markets
      FROM candidates c
      LEFT JOIN default.api_markets_staging m
        ON c.condition_id_norm = lower(replaceAll(m.condition_id, '0x', ''))
    `,
    format: 'JSONEachRow',
  });
  const matchStat = await matchStats.json();
  console.log('\n3. Match with api_markets_staging:');
  console.log(`   Unique candidates: ${matchStat[0].total_unique_candidates}`);
  console.log(`   Matched in api_markets_staging: ${matchStat[0].matched_in_api_markets}`);

  // 4. Check if api_markets_staging condition_ids are normalized properly
  const apiNorm = await ch.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id LIKE '0x%' THEN 1 ELSE 0 END) as has_0x,
        SUM(CASE WHEN length(condition_id) = 64 THEN 1 ELSE 0 END) as len_64,
        SUM(CASE WHEN length(condition_id) = 66 THEN 1 ELSE 0 END) as len_66
      FROM default.api_markets_staging
      LIMIT 1000
    `,
    format: 'JSONEachRow',
  });
  const apiN = await apiNorm.json();
  console.log('\n4. api_markets_staging condition_id format:');
  console.log(`   Sample size: ${apiN[0].total}`);
  console.log(`   Has 0x prefix: ${apiN[0].has_0x}`);
  console.log(`   Length 64 (normalized): ${apiN[0].len_64}`);
  console.log(`   Length 66 (with 0x): ${apiN[0].len_66}`);

  await ch.close();
})();
