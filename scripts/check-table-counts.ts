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
  console.log('\n📊 Market count comparison across ALL tables:\n');

  const counts = await ch.query({
    query: `
      SELECT 'fact_trades_clean (all wallets)' as source, COUNT(DISTINCT lower(replaceAll(cid, '0x', ''))) as count
      FROM default.fact_trades_clean

      UNION ALL

      SELECT 'api_markets_staging', COUNT(DISTINCT lower(replaceAll(condition_id, '0x', '')))
      FROM default.api_markets_staging

      UNION ALL

      SELECT 'market_resolutions_final', COUNT(DISTINCT condition_id_norm)
      FROM default.market_resolutions_final

      UNION ALL

      SELECT 'resolutions_external_ingest', COUNT(DISTINCT condition_id)
      FROM default.resolutions_external_ingest
    `,
    format: 'JSONEachRow',
  });

  const data = await counts.json();
  for (const row of data) {
    console.log(`  ${row.source.padEnd(40)} ${parseInt(row.count).toLocaleString()} markets`);
  }

  await ch.close();
})();
