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
  const result = await client.query({
    query: `
      SELECT count(DISTINCT t.condition_id_norm) as matched_markets
      FROM default.vw_trades_canonical t
      INNER JOIN default.market_resolutions_final r
        ON t.condition_id_norm = concat('0x', r.condition_id_norm)
      WHERE r.payout_denominator > 0
        AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });

  const matched = (await result.json<any[]>())[0].matched_markets;

  const total = await client.query({
    query: `SELECT count(DISTINCT condition_id_norm) as total FROM default.vw_trades_canonical WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'`,
    format: 'JSONEachRow',
  });

  const totalMarkets = (await total.json<any[]>())[0].total;
  const coverage = (100 * matched / totalMarkets).toFixed(1);

  console.log('ACTUAL COVERAGE WITH ALL SOURCES:');
  console.log('═'.repeat(60));
  console.log(`Total traded markets:     ${totalMarkets.toLocaleString()}`);
  console.log(`Markets with resolutions: ${matched.toLocaleString()}`);
  console.log(`Coverage:                 ${coverage}%`);
  console.log('═'.repeat(60));

  if (parseFloat(coverage) >= 60) {
    console.log(`✅ Coverage ${coverage}% - Ready for P&L!`);
  } else {
    console.log(`⚠️  Coverage ${coverage}% - More data needed`);
  }

  await client.close();
}

main().catch(console.error);
