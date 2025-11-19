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
  console.log('WHY THE MISMATCH IN RESOLUTION COUNTS?\n');

  // Check vw_resolutions_all
  const viewCount = await client.query({
    query: 'SELECT count(DISTINCT cid_hex) AS cnt FROM cascadian_clean.vw_resolutions_all',
    format: 'JSONEachRow',
  });
  const v = (await viewCount.json<Array<any>>())[0];
  console.log(`vw_resolutions_all: ${v.cnt.toLocaleString()} unique markets`);

  // Check market_resolutions_final source
  const sourceCount = await client.query({
    query: 'SELECT count(DISTINCT condition_id_norm) AS cnt FROM default.market_resolutions_final WHERE payout_denominator > 0',
    format: 'JSONEachRow',
  });
  const s = (await sourceCount.json<Array<any>>())[0];
  console.log(`market_resolutions_final: ${s.cnt.toLocaleString()} unique markets`);

  // Check gamma_markets with outcome data
  const gammaResolved = await client.query({
    query: `
      SELECT count(DISTINCT condition_id) AS cnt
      FROM default.gamma_markets
      WHERE length(outcome) > 0 AND closed = 1
    `,
    format: 'JSONEachRow',
  });
  const g = (await gammaResolved.json<Array<any>>())[0];
  console.log(`gamma_markets (closed with outcome): ${g.cnt.toLocaleString()} unique markets`);

  // Check ALL resolution sources combined
  const allResolutions = await client.query({
    query: `
      SELECT count(DISTINCT cid) AS cnt
      FROM (
        SELECT DISTINCT lower(concat('0x', condition_id_norm)) AS cid
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
        
        UNION DISTINCT
        
        SELECT DISTINCT lower(concat('0x', replaceAll(condition_id, '0x', ''))) AS cid
        FROM default.gamma_markets
        WHERE length(outcome) > 0 AND closed = 1
      )
    `,
    format: 'JSONEachRow',
  });
  const a = (await allResolutions.json<Array<any>>())[0];
  console.log(`\nALL SOURCES COMBINED: ${a.cnt.toLocaleString()} unique markets`);
  console.log();

  if (a.cnt > 100000) {
    console.log('🎯🎯🎯 BREAKTHROUGH!!!');
    console.log();
    console.log(`We have ${a.cnt.toLocaleString()} resolved markets, NOT 56K!`);
    console.log();
    console.log('The issue: vw_resolutions_all is using ONLY market_resolutions_final');
    console.log('But gamma_markets has ADDITIONAL resolution data!');
    console.log();
    console.log('Next step: Rebuild vw_resolutions_all to UNION both sources!');
  }

  await client.close();
}

main().catch(console.error);
