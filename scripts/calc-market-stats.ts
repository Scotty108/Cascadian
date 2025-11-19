#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const client = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const resolutionSubquery = `
  SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) AS cid
  FROM default.market_resolutions_final
  UNION ALL
  SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) AS cid
  FROM default.resolutions_external_ingest
`;

async function runQuery(query: string) {
  const res = await client.query({ query, format: 'JSONEachRow' });
  return await res.json();
}

async function main() {
  const total = await runQuery(`SELECT count(DISTINCT condition_id_norm) AS markets FROM default.vw_trades_canonical`);
  const matched = await runQuery(`
    SELECT count(DISTINCT t.cid) AS markets
    FROM (
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) AS cid
      FROM default.vw_trades_canonical
    ) t
    INNER JOIN (
      ${resolutionSubquery}
    ) r ON t.cid = r.cid
  `);
  const missing = await runQuery(`
    SELECT count() AS missing
    FROM (
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) AS cid
      FROM default.vw_trades_canonical
    ) t
    LEFT JOIN (
      ${resolutionSubquery}
    ) r ON t.cid = r.cid
    WHERE r.cid IS NULL
  `);
  console.log({ total: total[0].markets, matched: matched[0].markets, missing: missing[0].missing });
  await client.close();
}

main().catch(async (err) => {
  console.error(err);
  await client.close();
  process.exit(1);
});
