#!/usr/bin/env npx tsx
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
  console.log('\n🔍 DIAGNOSING JOIN MISMATCH\n');

  // Check resolution table counts
  const resCounts = await ch.query({
    query: `
      SELECT
        (SELECT COUNT(*) FROM default.market_resolutions_final WHERE payout_denominator > 0) as mrf_count,
        (SELECT COUNT(*) FROM default.resolutions_external_ingest WHERE payout_denominator > 0) as rei_count
    `,
    format: 'JSONEachRow'
  });
  const counts = await resCounts.json();
  console.log('Resolution table counts:');
  console.log(`  market_resolutions_final: ${parseInt(counts[0].mrf_count).toLocaleString()}`);
  console.log(`  resolutions_external_ingest: ${parseInt(counts[0].rei_count).toLocaleString()}\n`);

  // Sample IDs from each table
  const tradeSample = await ch.query({
    query: `SELECT DISTINCT cid FROM default.fact_trades_clean LIMIT 5`,
    format: 'JSONEachRow'
  });
  const trades = await tradeSample.json();

  const mrfSample = await ch.query({
    query: `SELECT DISTINCT condition_id_norm FROM default.market_resolutions_final WHERE payout_denominator > 0 LIMIT 5`,
    format: 'JSONEachRow'
  });
  const mrfs = await mrfSample.json();

  const reiSample = await ch.query({
    query: `SELECT DISTINCT condition_id FROM default.resolutions_external_ingest WHERE payout_denominator > 0 LIMIT 5`,
    format: 'JSONEachRow'
  });
  const reis = await reiSample.json();

  console.log('Sample IDs from each table:\n');
  console.log('fact_trades_clean.cid:');
  trades.forEach((t: any) => console.log(`  ${t.cid}`));

  console.log('\nmarket_resolutions_final.condition_id_norm:');
  mrfs.forEach((m: any) => console.log(`  ${m.condition_id_norm}`));

  console.log('\nresolutions_external_ingest.condition_id:');
  reis.forEach((r: any) => console.log(`  ${r.condition_id}`));

  // Test direct join
  const joinTest = await ch.query({
    query: `
      SELECT COUNT(*) as match_count
      FROM (SELECT DISTINCT cid FROM default.fact_trades_clean LIMIT 1000) t
      INNER JOIN (
        SELECT DISTINCT condition_id_norm as cid FROM default.market_resolutions_final WHERE payout_denominator > 0
        UNION ALL
        SELECT DISTINCT condition_id as cid FROM default.resolutions_external_ingest WHERE payout_denominator > 0
      ) r ON lower(t.cid) = lower(r.cid)
    `,
    format: 'JSONEachRow'
  });
  const joinResult = await joinTest.json();
  console.log(`\n\nDirect join test (1000 trades):`);
  console.log(`  Matches: ${joinResult[0].match_count}\n`);

  await ch.close();
})();
