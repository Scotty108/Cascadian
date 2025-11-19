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

async function main() {
  const result = await ch.query({
    query: `
      SELECT
        count() as total_markets,
        countIf(active = true) as active_markets,
        countIf(closed = true) as closed_markets,
        count(DISTINCT condition_id) as unique_conditions,
        min(timestamp) as first_inserted,
        max(timestamp) as last_inserted
      FROM default.api_markets_staging
    `,
    format: 'JSONEachRow',
  });

  const stats = await result.json();
  console.log('\n📊 Market Universe Statistics:\n');
  console.log(JSON.stringify(stats[0], null, 2));

  // Sample a few markets
  const sample = await ch.query({
    query: 'SELECT condition_id, question, market_slug, active, closed, arrayLength(outcomes) as num_outcomes FROM default.api_markets_staging LIMIT 5',
    format: 'JSONEachRow',
  });

  console.log('\n📝 Sample Markets:\n');
  const markets = await sample.json();
  markets.forEach((m: any, i: number) => {
    console.log(`${i + 1}. ${m.question}`);
    console.log(`   CID: ${m.condition_id.substring(0, 16)}...`);
    console.log(`   Slug: ${m.market_slug}`);
    console.log(`   Status: Active=${m.active}, Closed=${m.closed}, Outcomes=${m.num_outcomes}`);
  });

  await ch.close();
}

main().catch(console.error);
