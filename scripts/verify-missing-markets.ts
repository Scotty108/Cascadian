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
  console.log('\n🔍 Investigating the 13,033 "missing" markets...\n');

  // Check api_markets_staging row count
  const totalMarkets = await ch.query({
    query: 'SELECT COUNT(*) as count FROM default.api_markets_staging',
    format: 'JSONEachRow',
  });
  const total = await totalMarkets.json();
  console.log(`Total markets in api_markets_staging: ${total[0].count}`);

  // Check how many have outcomes
  const withOutcomes = await ch.query({
    query: 'SELECT COUNT(*) as count FROM default.api_markets_staging WHERE length(outcomes) > 0',
    format: 'JSONEachRow',
  });
  const withO = await withOutcomes.json();
  console.log(`Markets with outcomes: ${withO[0].count}`);

  // Get sample of the 13,033 missing condition_ids
  const missingIds = await ch.query({
    query: `
      SELECT
        rc.condition_id_norm
      FROM default.resolution_candidates rc
      WHERE rc.confidence >= 0.9
        AND rc.outcome != 'INVALID'
        AND rc.condition_id_norm NOT IN (
          SELECT lower(replaceAll(condition_id, '0x', ''))
          FROM default.api_markets_staging
          WHERE length(outcomes) > 0
        )
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const missing = await missingIds.json();
  console.log(`\nSample of ${missing.length} "missing" condition_ids:\n`);

  // For each missing ID, check if it exists in api_markets_staging at all
  for (const m of missing) {
    const cid = m.condition_id_norm;
    
    // Check if exists in api_markets_staging
    const exists = await ch.query({
      query: `
        SELECT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as normalized,
          outcomes,
          question
        FROM default.api_markets_staging
        WHERE lower(replaceAll(condition_id, '0x', '')) = '${cid}'
      `,
      format: 'JSONEachRow',
    });

    const result = await exists.json();
    
    if (result.length > 0) {
      console.log(`✅ Found ${cid.substring(0, 16)}... in api_markets_staging`);
      console.log(`   Outcomes: [${result[0].outcomes?.join(', ') || 'EMPTY'}]`);
      console.log(`   Question: ${result[0].question?.substring(0, 60)}...`);
    } else {
      console.log(`❌ NOT found ${cid.substring(0, 16)}... in api_markets_staging`);
    }
  }

  // Check if these markets are traded
  console.log(`\n📊 Checking if these missing markets have trades...\n`);
  
  const tradedCheck = await ch.query({
    query: `
      WITH missing_markets AS (
        SELECT rc.condition_id_norm
        FROM default.resolution_candidates rc
        WHERE rc.confidence >= 0.9
          AND rc.outcome != 'INVALID'
          AND rc.condition_id_norm NOT IN (
            SELECT lower(replaceAll(condition_id, '0x', ''))
            FROM default.api_markets_staging
            WHERE length(outcomes) > 0
          )
      )
      SELECT
        COUNT(DISTINCT mm.condition_id_norm) as missing_count,
        SUM(CASE WHEN t.cid IS NOT NULL THEN 1 ELSE 0 END) as traded_count
      FROM missing_markets mm
      LEFT JOIN (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid
        FROM default.fact_trades_clean
      ) t ON mm.condition_id_norm = t.cid
    `,
    format: 'JSONEachRow',
  });

  const traded = await tradedCheck.json();
  console.log(`Missing markets: ${traded[0].missing_count}`);
  console.log(`Of those, traded: ${traded[0].traded_count}`);
  console.log(`Not traded: ${traded[0].missing_count - traded[0].traded_count}`);

  await ch.close();
})();
