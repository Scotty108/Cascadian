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
  console.log('Finding a market that exists in BOTH tables...\n');

  // Get a market_id from market_resolutions_final
  const resResult = await client.query({
    query: 'SELECT market_id, condition_id_norm FROM default.market_resolutions_final LIMIT 10',
    format: 'JSONEachRow',
  });
  const resMarkets = await resResult.json<Array<{ market_id: string; condition_id_norm: string }>>();

  console.log('Sample markets from market_resolutions_final:');
  resMarkets.forEach((m, i) => console.log(`  ${i + 1}. market_id=${m.market_id}, cid_norm=${m.condition_id_norm}`));
  console.log();

  // Check if this market_id exists in vw_trades_canonical
  for (const market of resMarkets) {
    const checkResult = await client.query({
      query: `
        SELECT
          market_id_norm,
          condition_id_norm
        FROM default.vw_trades_canonical
        WHERE market_id_norm = '${market.market_id}'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });

    const matches = await checkResult.json<Array<{ market_id_norm: string; condition_id_norm: string }>>();
    if (matches.length > 0) {
      console.log('✅ FOUND OVERLAP!');
      console.log(`Market ID: ${market.market_id}`);
      console.log();
      console.log('In market_resolutions_final:');
      console.log(`  condition_id_norm: ${market.condition_id_norm} (len: ${market.condition_id_norm.length})`);
      console.log();
      console.log('In vw_trades_canonical:');
      console.log(`  condition_id_norm: ${matches[0].condition_id_norm} (len: ${matches[0].condition_id_norm.length})`);
      console.log();

      // Check what they would normalize to
      console.log('Normalization comparison:');
      const resCidNormalized = `0x${market.condition_id_norm}`.toLowerCase();
      const vwcCidNormalized = matches[0].condition_id_norm.toLowerCase();

      console.log(`  Resolution normalized: ${resCidNormalized}`);
      console.log(`  VWC normalized:        ${vwcCidNormalized}`);
      console.log(`  Match: ${resCidNormalized === vwcCidNormalized ? '✅ YES' : '❌ NO'}`);

      break;
    }
  }

  await client.close();
}

main().catch(console.error);
